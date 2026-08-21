"""
Petit serveur FastAPI qui expose le pipeline IDP existant (app.main.process_document)
via une API HTTP, pour être consommé par la nouvelle interface Next.js.

Ne remplace pas streamlit_app.py : les deux peuvent coexister. Celui-ci est
uniquement le pont HTTP utilisé par le frontend Next.js.

Lancement:
    pip install fastapi uvicorn python-multipart
    uvicorn api_server:app --reload --port 8000

Le frontend Next.js doit pointer NEXT_PUBLIC_API_URL vers http://localhost:8000
(voir .env.local.example dans le projet Next.js).
"""
import inspect
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
from app.analysis.price_analyzer import analyze_prices
from app.main import process_document
from app.utils.io_utils import pdf_to_images

app = FastAPI(title="Sabena IDP API")


@app.on_event("startup")
def _startup():
    db.init_db()

# En dev, le frontend Next.js tourne sur un port différent (3000) -> CORS ouvert.
# En prod, restreindre `allow_origins` au domaine réel de l'interface.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _decode_image(data: bytes) -> np.ndarray:
    file_bytes = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Impossible de décoder l'image")
    return img


def _call_process_document(image: np.ndarray, align_template: bool, use_vision: bool):
    """Injecte uniquement les kwargs réellement supportés par la signature
    actuelle de process_document (même logique robuste que streamlit_app.py).
    Prend toujours une image déjà décodée (ndarray) — jamais un chemin."""
    sig = inspect.signature(process_document)
    kwargs = {}
    if "align_to_template" in sig.parameters:
        kwargs["align_to_template"] = align_template
    elif "align" in sig.parameters:
        kwargs["align"] = align_template
    if "use_vision" in sig.parameters:
        kwargs["use_vision"] = use_vision
    elif "vision" in sig.parameters:
        kwargs["vision"] = use_vision
    return process_document(image, **kwargs)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/process")
async def process(
    file: UploadFile = File(...),
    align_template: bool = Form(True),
    use_vision: bool = Form(True),
):
    """
    Traite un document et retourne TOUJOURS {"pages": [...]}.

    - Image (png/jpg) => 1 seule page.
    - PDF => converti en une image par page (via pdf_to_images / PyMuPDF),
      puis CHAQUE page est traitée individuellement par process_document.
      C'est ce qui corrige le bug où un PDF de plusieurs ordres de travail
      n'était traité qu'à moitié (voire pas du tout) : avant, le chemin du
      PDF était passé tel quel à process_document, qui attend une image
      déjà décodée (np.ndarray), pas un chemin de fichier.
    """
    name = file.filename or "document"
    suffix = Path(name).suffix.lower()
    data = await file.read()

    try:
        if suffix in (".png", ".jpg", ".jpeg"):
            img = _decode_image(data)
            pages = [_call_process_document(img, align_template, use_vision)]
        elif suffix == ".pdf":
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            try:
                images = pdf_to_images(tmp_path)
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"Impossible de lire le PDF {name}: {e}"
                )
            if not images:
                raise HTTPException(status_code=400, detail=f"PDF vide ou illisible: {name}")
            pages = [
                _call_process_document(img, align_template, use_vision) for img in images
            ]
        else:
            raise HTTPException(status_code=400, detail=f"Type de fichier non supporté: {name}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de traitement de {name}: {e}")

    # Persistance immédiate : chaque page du PDF représente un WO indépendant.
    persisted_pages = []
    total_pages = len(pages)
    for page_idx, page in enumerate(pages, start=1):
        pipeline_dict = page.to_dict()
        wo_id = db.create_processed_work_order(
            source_file=name,
            source_page=page_idx,
            source_total_pages=total_pages,
            pipeline=pipeline_dict,
        )
        pipeline_dict["_persisted_work_order_id"] = wo_id
        pipeline_dict["_source_file"] = name
        pipeline_dict["_source_page"] = page_idx
        pipeline_dict["_source_total_pages"] = total_pages
        persisted_pages.append(pipeline_dict)

    return {"pages": persisted_pages}


# --------------------------------------------------------------------------
# Base de données des ordres de travail (Work Orders) + matériaux vendus
# --------------------------------------------------------------------------

class MaterialIn(BaseModel):
    qty: Optional[str] = None
    designation: Optional[str] = None
    reference: Optional[str] = None
    price: Optional[float] = None
    price_raw: Optional[str] = None


class WorkOrderIn(BaseModel):
    document_name: Optional[str] = None
    order_number: Optional[str] = None
    date: Optional[str] = None
    lieu_place: Optional[str] = None
    ac_type: Optional[str] = None
    ac_registration: Optional[str] = None
    airline_customer: Optional[str] = None
    required_mh: Optional[str] = None
    customer_rep_name: Optional[str] = None
    customer_rep_date: Optional[str] = None
    work_required: Optional[str] = None
    materials: list[MaterialIn] = []


WO_FIELDS = [
    "document_name", "order_number", "date", "lieu_place", "ac_type",
    "ac_registration", "airline_customer", "required_mh",
    "customer_rep_name", "customer_rep_date", "work_required",
]


@app.post("/api/work-orders")
def create_work_order(payload: WorkOrderIn):
    fields = {k: getattr(payload, k) for k in WO_FIELDS}
    materials = [m.dict() for m in payload.materials]
    wo_id = db.create_work_order(fields, materials)
    return db.get_work_order(wo_id)


@app.get("/api/work-orders")
def list_work_orders(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    ac_registration: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 200,
):
    """Recherche par date (jj/mm/aaaa), immatriculation et/ou texte libre
    (N° d'ordre, travaux demandés, client, nom du document)."""
    return db.search_work_orders(
        date_from=date_from, date_to=date_to, ac_registration=ac_registration,
        query=q, limit=limit,
    )


@app.get("/api/work-orders/history")
def history(limit: int = 500):
    return db.search_work_orders(limit=limit)


@app.get("/api/work-orders/{wo_id}")
def get_work_order(wo_id: int):
    wo = db.get_work_order(wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Ordre de travail introuvable")
    return wo


@app.put("/api/work-orders/{wo_id}")
def update_work_order(wo_id: int, payload: WorkOrderIn):
    fields = {k: getattr(payload, k) for k in WO_FIELDS}
    materials = [m.dict() for m in payload.materials]
    ok = db.update_work_order(wo_id, fields, materials)
    if not ok:
        raise HTTPException(status_code=404, detail="Ordre de travail introuvable")
    return db.get_work_order(wo_id)


@app.delete("/api/work-orders/{wo_id}")
def delete_work_order(wo_id: int):
    ok = db.delete_work_order(wo_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Ordre de travail introuvable")
    return {"deleted": True}


@app.put("/api/work-orders/{wo_id}/materials")
def update_materials(wo_id: int, materials: list[MaterialIn]):
    """Met à jour uniquement le tableau des matériaux vendus / prix d'un WO
    déjà enregistré (écran de gestion des matériaux)."""
    ok = db.update_materials(wo_id, [m.dict() for m in materials])
    if not ok:
        raise HTTPException(status_code=404, detail="Ordre de travail introuvable")
    return db.get_work_order(wo_id)


@app.get("/api/work-orders/{wo_id}/technical")
def get_work_order_technical(wo_id: int):
    data = db.get_technical(wo_id)
    if not data:
        raise HTTPException(status_code=404, detail="Informations techniques introuvables")
    return data


@app.get("/api/dashboard")
def dashboard():
    """Statistiques agrégées sur l'ensemble des ordres de travail enregistrés
    en base (toutes sessions confondues), pour l'onglet Dashboard."""
    return db.get_dashboard_stats()


@app.get("/api/analysis/prices")
def analysis_prices(date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Analyse des prix des matériaux vendus sur une période (jj/mm/aaaa,
    bornes optionnelles et incluses) : statistiques agrégées (pour les
    diagrammes du frontend) + rapport en langage naturel généré par un LLM
    (Gemini, repli Ollama local, repli template si aucun LLM joignable)."""
    materials = db.get_materials_in_range(date_from=date_from, date_to=date_to)
    return analyze_prices(materials)
