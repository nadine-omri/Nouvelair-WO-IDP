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

Persistance : chaque page traitée par /api/process est automatiquement
enregistrée dans la base SQLite (data/sabena_wo.db) dès la fin du
traitement — l'utilisateur n'a rien à cliquer pour que ce soit sauvegardé,
et les données restent accessibles après fermeture de l'application. Les
onglets "Correction manuelle" / "Export" mettent ensuite à jour (UPDATE) la
même ligne plutôt que d'en créer une nouvelle.
"""
import inspect
import tempfile
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
from app.analysis.document_report import generate_document_report
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


# --------------------------------------------------------------------------
# Auto-persistance : conversion d'un PipelineResult -> lignes DB
# --------------------------------------------------------------------------

def _business_fields_from_result(result_dict: dict, document_name: str) -> dict:
    """Extrait les champs 'métier' (ordre de travail) depuis le dict d'un
    PipelineResult, pour peuplement automatique des colonnes work_orders."""
    fields = result_dict.get("extraction", {}).get("fields", {}) or {}

    def val(key: str) -> Optional[str]:
        fv = fields.get(key) or {}
        v = fv.get("value")
        return v if v not in (None, "") else None

    return {
        "document_name": document_name,
        "order_number": val("order_number"),
        "date": val("date"),
        "lieu_place": val("lieu_place"),
        "ac_type": val("ac_type"),
        "ac_registration": val("ac_registration"),
        "airline_customer": val("airline_customer"),
        "required_mh": val("required_mh"),
        "customer_rep_name": val("customer_rep_name"),
        "customer_rep_date": val("customer_rep_date"),
        "work_required": val("work_required"),
    }


def _technical_fields_from_result(result_dict: dict) -> dict:
    """Extrait toutes les métadonnées techniques d'extraction depuis le dict
    d'un PipelineResult, pour peuplement automatique de l'onglet
    "Informations techniques" (persistant, même après fermeture de l'appli)."""
    cc = result_dict.get("confidence_components") or {}
    llm = result_dict.get("llm_validation") or {}
    return {
        "engine_used": result_dict.get("engine_used"),
        "requires_review": result_dict.get("requires_review"),
        "review_reasons": result_dict.get("review_reasons") or [],
        "document_type": result_dict.get("document_type"),
        "classification_score": result_dict.get("classification_score"),
        "document_detected": result_dict.get("document_detected"),
        "document_detection_confidence": result_dict.get("document_detection_confidence"),
        "template_aligned": result_dict.get("template_aligned"),
        "template_matched": result_dict.get("template_matched"),
        "template_match_score": result_dict.get("template_match_score"),
        "deskew_angle": result_dict.get("deskew_angle"),
        "processing_time_s": result_dict.get("processing_time_s"),
        "confidence_ocr": cc.get("ocr"),
        "confidence_template": cc.get("template"),
        "confidence_rules": cc.get("rules"),
        "confidence_llm": cc.get("llm"),
        "confidence_llm_used": cc.get("llm_used"),
        "global_confidence_score": result_dict.get("global_confidence_score"),
        "validation_issues": result_dict.get("validation_issues") or [],
        "llm_validation": llm,
        "extraction_fields": result_dict.get("extraction", {}).get("fields") or {},
    }


def _auto_save_page(
    result_dict: dict,
    document_name: str,
    source_file: str,
    page_index: int,
    page_count: int,
) -> int:
    """Enregistre automatiquement une page traitée comme un nouveau WO en
    base, avec ses matériaux vendus et ses métadonnées techniques. Retourne
    l'id du WO créé."""
    fields = _business_fields_from_result(result_dict, document_name)
    fields.update(_technical_fields_from_result(result_dict))
    fields["source_file"] = source_file
    fields["page_index"] = page_index
    fields["page_count"] = page_count
    fields["auto_saved"] = True

    materials = result_dict.get("extraction", {}).get("material_sold") or []
    return db.create_work_order(fields, materials)


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

    - Image (png/jpg) => 1 seule page => 1 WO.
    - PDF => converti en une image par page (via pdf_to_images / PyMuPDF),
      puis CHAQUE page est traitée individuellement par process_document et
      devient un WO séparé, identifiable par son fichier source
      (`source_file`) et son numéro de page (`page_index`/`page_count`).
      C'est ce qui corrige le bug où un PDF de plusieurs ordres de travail
      n'était traité qu'à moitié (voire pas du tout) : avant, le chemin du
      PDF était passé tel quel à process_document, qui attend une image
      déjà décodée (np.ndarray), pas un chemin de fichier.

    Chaque page traitée est automatiquement enregistrée dans la base
    (persistance immédiate, sans action de l'utilisateur) : l'id du WO créé
    est renvoyé dans chaque page sous la clé "db_id", pour que le frontend
    puisse ensuite la mettre à jour (plutôt que d'en recréer une) lors
    d'une correction manuelle ou d'un export.
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

    page_count = len(pages)
    out_pages = []
    for idx, p in enumerate(pages, start=1):
        result_dict = p.to_dict()
        document_name = name if page_count == 1 else f"{name} — page {idx}/{page_count}"
        try:
            db_id = _auto_save_page(result_dict, document_name, name, idx, page_count)
        except Exception:
            # La persistance ne doit jamais faire échouer l'affichage du
            # résultat déjà calculé côté utilisateur.
            db_id = None
        result_dict["db_id"] = db_id
        result_dict["source_file"] = name
        result_dict["page_index"] = idx
        result_dict["page_count"] = page_count
        out_pages.append(result_dict)

    return {"pages": out_pages}


# --------------------------------------------------------------------------
# Base de données des ordres de travail (Work Orders) + matériaux vendus
# --------------------------------------------------------------------------

class MaterialIn(BaseModel):
    qty: Optional[str] = None
    designation: Optional[str] = None
    reference: Optional[str] = None
    price: Optional[float] = None
    price_raw: Optional[str] = None


class ConfidenceComponentsIn(BaseModel):
    ocr: Optional[float] = None
    template: Optional[float] = None
    rules: Optional[float] = None
    llm: Optional[float] = None
    llm_used: Optional[bool] = None
    global_: Optional[float] = None


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

    # Origine (facultatif : renseigné automatiquement par /api/process, mais
    # peut être renvoyé tel quel lors d'une mise à jour depuis le frontend).
    source_file: Optional[str] = None
    page_index: Optional[int] = None
    page_count: Optional[int] = None

    # Informations techniques (facultatives, envoyées par le frontend pour
    # préserver l'instantané d'extraction lors d'une correction manuelle).
    engine_used: Optional[str] = None
    requires_review: Optional[bool] = None
    review_reasons: Optional[list[str]] = None
    document_type: Optional[str] = None
    classification_score: Optional[float] = None
    document_detected: Optional[bool] = None
    document_detection_confidence: Optional[float] = None
    template_aligned: Optional[bool] = None
    template_matched: Optional[bool] = None
    template_match_score: Optional[float] = None
    deskew_angle: Optional[float] = None
    processing_time_s: Optional[float] = None
    confidence_ocr: Optional[float] = None
    confidence_template: Optional[float] = None
    confidence_rules: Optional[float] = None
    confidence_llm: Optional[float] = None
    confidence_llm_used: Optional[bool] = None
    global_confidence_score: Optional[float] = None
    validation_issues: Optional[list[dict]] = None
    llm_validation: Optional[dict] = None
    extraction_fields: Optional[dict] = None


WO_FIELDS = [
    "document_name", "order_number", "date", "lieu_place", "ac_type",
    "ac_registration", "airline_customer", "required_mh",
    "customer_rep_name", "customer_rep_date", "work_required",
    "source_file", "page_index", "page_count",
    "engine_used", "requires_review", "review_reasons", "document_type",
    "classification_score", "document_detected", "document_detection_confidence",
    "template_aligned", "template_matched", "template_match_score", "deskew_angle",
    "processing_time_s", "confidence_ocr", "confidence_template", "confidence_rules",
    "confidence_llm", "confidence_llm_used", "global_confidence_score",
    "validation_issues", "llm_validation", "extraction_fields",
]


def _payload_to_fields(payload: WorkOrderIn) -> dict:
    return {k: getattr(payload, k) for k in WO_FIELDS}


@app.post("/api/work-orders")
def create_work_order(payload: WorkOrderIn):
    fields = _payload_to_fields(payload)
    materials = [m.dict() for m in payload.materials]
    wo_id = db.create_work_order(fields, materials)
    return db.get_work_order(wo_id)


@app.get("/api/work-orders")
def list_work_orders(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    ac_registration: Optional[str] = None,
    q: Optional[str] = None,
    source_file: Optional[str] = None,
    order_by: str = "created_at",
    order_dir: str = "desc",
    limit: int = 200,
):
    """Recherche par date (jj/mm/aaaa), immatriculation, texte libre (N°
    d'ordre, travaux demandés, client, nom du document, fichier source) ou
    fichier source (pour retrouver toutes les pages d'un même PDF
    multi-scans). Triable (order_by: created_at | date | order_number |
    ac_registration | global_confidence_score) et ascendant/descendant."""
    return db.search_work_orders(
        date_from=date_from, date_to=date_to, ac_registration=ac_registration,
        query=q, source_file=source_file, limit=limit,
        order_by=order_by, order_dir=order_dir,
    )


@app.get("/api/work-orders/{wo_id}")
def get_work_order(wo_id: int):
    wo = db.get_work_order(wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Ordre de travail introuvable")
    return wo


@app.put("/api/work-orders/{wo_id}")
def update_work_order(wo_id: int, payload: WorkOrderIn):
    fields = _payload_to_fields(payload)
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


@app.get("/api/dashboard")
def dashboard():
    """Statistiques agrégées sur l'ensemble des ordres de travail enregistrés
    en base (toutes sessions confondues), pour l'onglet Dashboard."""
    return db.get_dashboard_stats()


@app.get("/api/stats/hours-by-work")
def hours_by_work(q: Optional[str] = None, limit: int = 100):
    """Marge des heures requises (MH) selon le travail demandé : pour
    chaque CATÉGORIE de travaux (regroupement intelligent par mots-clés
    locaux -- action + pièce/zone concernée -- via db.categorize_work, et
    non par correspondance texte stricte), le nombre de CWO concernés
    ainsi que le MH minimum, maximum et moyen observés."""
    return db.get_hours_stats_by_work(query=q, limit=limit)


@app.get("/api/stats/anomalies")
def hours_anomalies(min_group_size: int = 3, z_threshold: float = 1.8):
    """CWO dont le MH requis s'écarte fortement (z-score) de la moyenne
    observée pour leur catégorie de travaux -- utile pour repérer des
    saisies suspectes ou des cas exceptionnels à vérifier manuellement."""
    return db.get_hours_anomalies(min_group_size=min_group_size, z_threshold=z_threshold)


@app.get("/api/price-analysis")
def price_analysis(date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Statistiques + rapport IA sur les matériaux vendus/facturés (jj/mm/aaaa,
    bornes incluses), pour l'onglet "Analyse des prix"."""
    materials = db.get_materials_in_range(date_from=date_from, date_to=date_to)
    return analyze_prices(materials)


class ValidationIssueIn(BaseModel):
    field: str
    level: str
    message: str


class DocumentReportRequest(BaseModel):
    """Champs extraits d'un seul document déjà traité (fields = valeurs déjà
    résolues, pas les FieldValue complets avec bbox/confiance)."""
    fields: dict
    materials: list[MaterialIn] = []
    validation_issues: list[ValidationIssueIn] = []
    llm_issues: list[str] = []


@app.post("/api/document-report")
def document_report(payload: DocumentReportRequest):
    """Rapport IA en langage naturel pour un seul document (résumé,
    points d'attention, comparaison M/H avec la marge habituelle), pour
    l'onglet "Analyse (session)"."""
    return generate_document_report(
        fields=payload.fields,
        materials=[m.dict() for m in payload.materials],
        validation_issues=[i.dict() for i in payload.validation_issues],
        llm_issues=payload.llm_issues,
    )
