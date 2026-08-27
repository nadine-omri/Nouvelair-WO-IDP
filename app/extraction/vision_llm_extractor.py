"""
Extraction "intelligente" du formulaire Ordre Client via un modele de vision
(Claude), en alternative au pipeline OCR+ROI+calibration (app.extraction.
information_extractor.InformationExtractor).

Pourquoi un module separe plutot qu'un simple nouveau OCREngine :
contrairement a Tesseract/TrOCR, le modele de vision ne fait pas de
"reconnaissance de zone" — on lui donne l'image entiere et il comprend
directement la mise en page, le contexte et l'ecriture manuscrite en un seul
appel. Cela veut dire :
  - Pas de calibration de zones (tools/calibrate_roi.py) necessaire.
  - Pas d'alignement de template (app.preprocessing.template_alignment)
    necessaire : le modele localise les champs lui-meme, meme si le scan est
    legerement different en taille/rotation/cadrage.
  - Un seul appel API traite tous les champs + le tableau "materiel vendu"
    en meme temps.

Contrepartie : necessite une cle API Anthropic (configs.config.VISION) et a
un cout par document traite (facturation a l'usage de l'API).
"""
import base64
import json
import os
import re
from typing import Any, Dict, Optional

import cv2
import numpy as np

from app.extraction.information_extractor import ExtractionResult, FieldValue, MaterialRow
from app.postprocessing.text_cleaner import normalize_amount, normalize_date, normalize_registration
from app.utils.logger import get_logger
from configs.config import OCR, VISION

logger = get_logger(__name__)

# Description de chaque champ attendu, utilisee pour construire le prompt.
# Garder ces descriptions alignees avec la mise en page reelle du formulaire
# (cf. configs/roi_template.json pour les memes noms de champs, cote OCR).
_FIELD_DESCRIPTIONS = {
    "order_number": "Numero de commande imprime en haut a droite, apres 'N°' (ex: 00004193)",
    "date": "Date manuscrite dans le cadre 'Date :' en haut du formulaire, format JJ/MM/AAAA",
    "lieu_place": "Lieu manuscrit dans le cadre 'Lieu / Place'",
    "ac_type": "Type d'avion manuscrit dans 'Type Avion / A/C Type' (ex: A320, A330, B737)",
    "ac_registration": "Immatriculation avion manuscrite dans 'Immatriculation Avion / A/C Registration' "
                        "(ex: TS-INQ)",
    "airline_customer": "Nom de la compagnie cliente, cadre 'Compagnie / Client / Airline / Customer'",
    "required_mh": "Temps forfaitaire requis, cadre 'Temps forfaitaire / M/H required' (ex: 52 MH)",
    "work_required": "Texte manuscrit (souvent plusieurs lignes) dans le grand cadre "
                      "'Travaux demandes / work required'",
    "customer_rep_name": "Nom manuscrit dans 'Nom du Representant CLIENT / CUSTOMER Representative'",
    "customer_rep_date": "Date manuscrite associee a la signature du representant client",
    "acceptance_client": "Contenu (texte, coche, tampon) du cadre 'Acceptation Client / Customer acceptance'",
    "work_summary": "Texte manuscrit dans 'Resume des travaux effectues / Summary of performed'",
    "observation": "Texte dans la zone 'Observation / Remarks' en bas du formulaire",
    "inspection_visa": "Contenu du cachet 'Visa Inspection / Insp. Stamp'",
}

_SYSTEM_PROMPT = """Tu es un systeme d'extraction de donnees pour des bons de travail \
"Ordre Client / Customer Work Order" de Sabena Technics. Tu recois une image scannee \
d'un formulaire rempli a la main et imprime, et tu dois en extraire les champs demandes \
avec precision, y compris l'ecriture manuscrite cursive en francais.

Regles :
- Renvoie UNIQUEMENT du JSON valide, sans texte avant ou apres, sans balises markdown.
- Pour chaque champ, donne "value" (texte lu, ou null si le champ est vide/illisible) et \
"confidence" (ton estime de confiance 0-100 sur la lecture, pas sur autre chose).
- Ne jamais inventer une valeur pour un champ vide ou illisible : mets value=null et \
confidence=0 plutot que de deviner.
- Pour le tableau "MATERIEL VENDU / MATERIAL SOLD", ne renvoie que les lignes reellement \
remplies (ignore les lignes vides du tableau), avec qty, designation, reference, price_raw \
(texte du prix tel qu'ecrit, avec devise si visible)."""


def _build_user_prompt() -> str:
    fields_desc = "\n".join(f"- {name}: {desc}" for name, desc in _FIELD_DESCRIPTIONS.items())
    schema_fields = ",\n".join(f'    "{name}": {{"value": "...", "confidence": 0}}' for name in _FIELD_DESCRIPTIONS)
    return f"""Voici l'image d'un "Ordre Client / Customer Work Order" Sabena Technics. \
Extrais les champs suivants :

{fields_desc}

Renvoie exactement ce format JSON (rien d'autre) :
{{
{schema_fields},
  "material_sold": [
    {{"qty": "...", "designation": "...", "reference": "...", "price_raw": "..."}}
  ]
}}"""


def _extract_json(text: str) -> Dict[str, Any]:
    """Parse le JSON renvoye par le modele, avec un repli tolerant si jamais
    il a quand meme entoure la reponse de ```json ... ``` malgre la consigne."""
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        text = match.group(1)
    return json.loads(text)


def _encode_image(image_bgr: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", image_bgr)
    if not ok:
        raise ValueError("Echec de l'encodage de l'image en PNG")
    return base64.standard_b64encode(buf.tobytes()).decode("utf-8")


def _parsed_json_to_extraction_result(parsed: Dict[str, Any]) -> ExtractionResult:
    """Convertit le JSON renvoye par un modele de vision (Claude, Gemini, ...)
    en ExtractionResult. Factorise ici pour etre reutilisable par tout
    extracteur vision qui respecte le meme schema JSON (cf. _build_user_prompt)."""
    result = ExtractionResult()

    for field_name in _FIELD_DESCRIPTIONS:
        entry = parsed.get(field_name) or {}
        raw_value = entry.get("value") if isinstance(entry, dict) else entry
        confidence = float(entry.get("confidence", 0)) if isinstance(entry, dict) else 0.0
        raw_text = str(raw_value).strip() if raw_value else ""

        value: Any = raw_text or None
        if field_name in ("date", "customer_rep_date") and raw_text:
            value = normalize_date(raw_text)
        elif field_name == "ac_registration" and raw_text:
            value = normalize_registration(raw_text)

        result.fields[field_name] = FieldValue(
            raw_text=raw_text,
            value=value,
            confidence=round(confidence, 1),
            needs_review=confidence < OCR.min_confidence_review or value is None,
        )

    for row in parsed.get("material_sold", []):
        price_raw = row.get("price_raw") or ""
        result.material_sold.append(MaterialRow(
            qty=row.get("qty") or None,
            designation=row.get("designation") or None,
            reference=row.get("reference") or None,
            price=normalize_amount(price_raw),
            price_raw=price_raw or None,
        ))

    return result


class VisionLLMExtractor:
    """Extraction de bout en bout via un modele de vision Claude. Pas de
    dependance a l'alignement de template ni aux zones ROI calibrees."""

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        self.model = model or VISION.model
        self.api_key = api_key or os.environ.get(VISION.api_key_env)
        self._client = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        if not self.api_key:
            raise RuntimeError(
                f"Cle API Anthropic manquante. Definissez la variable d'environnement "
                f"'{VISION.api_key_env}' (cf. https://docs.claude.com/en/api/overview)."
            )
        import anthropic  # import differe : dependance optionnelle
        self._client = anthropic.Anthropic(api_key=self.api_key)
        return self._client

    def extract(self, image_bgr: np.ndarray) -> ExtractionResult:
        client = self._get_client()
        image_b64 = _encode_image(image_bgr)

        logger.info(f"Extraction vision via {self.model}")
        response = client.messages.create(
            model=self.model,
            max_tokens=VISION.max_tokens,
            system=_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_b64}},
                    {"type": "text", "text": _build_user_prompt()},
                ],
            }],
        )
        raw_text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")

        try:
            parsed = _extract_json(raw_text)
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Reponse du modele non parsable en JSON : {e}\nReponse brute : {raw_text[:500]}")
            raise ValueError(f"Le modele de vision n'a pas renvoye de JSON valide : {e}") from e

        return self._to_extraction_result(parsed)

    def _to_extraction_result(self, parsed: Dict[str, Any]) -> ExtractionResult:
        return _parsed_json_to_extraction_result(parsed)
