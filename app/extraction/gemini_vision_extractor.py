"""
Extraction "intelligente" du formulaire Ordre Client via un modele de vision
Gemini (Google), en alternative gratuite a app.extraction.vision_llm_extractor
(meme principe, mais Claude/payant).

Meme philosophie que VisionLLMExtractor : un seul appel avec l'image complete
du formulaire, pas de calibration de zones (tools/calibrate_roi.py) ni
d'alignement de template necessaire. Le modele localise et lit lui-meme
chaque champ, y compris l'ecriture manuscrite cursive en francais.

Pourquoi Gemini plutot que Claude ici : Google AI Studio propose un tier
gratuit (sans carte bancaire) sur les modeles Gemini Flash / Flash-Lite,
suffisant pour un usage PFE / prototype. Verifie les quotas actuels sur
https://ai.google.dev/gemini-api/docs/rate-limits (ils evoluent souvent).

Installation :
    pip install google-genai

Cle API (gratuite) :
    https://aistudio.google.com/apikey
    export GEMINI_API_KEY=...   (ou definir configs.config.VISION.api_key_env)

A savoir : sur le tier gratuit, Google peut utiliser les images/prompts
envoyes pour ameliorer ses modeles (contrairement au tier payant / Vertex
AI). A garder en tete si les scans contiennent des donnees sensibles de
l'entreprise -- voir avec ton encadrant si besoin avant d'envoyer des scans
reels de production.
"""
import json
import os
from typing import Any, Dict, Optional

import cv2
import numpy as np

from app.extraction.information_extractor import ExtractionResult
from app.extraction.vision_llm_extractor import (
    _FIELD_DESCRIPTIONS,
    _extract_json,
    _parsed_json_to_extraction_result,
)
from app.utils.logger import get_logger
from configs.config import VISION

logger = get_logger(__name__)

_SYSTEM_PROMPT = """Tu es un systeme d'extraction de donnees pour des bons de travail \
"Ordre Client / Customer Work Order" de Sabena Technics (formulaire MRO Nouvelair). \
Tu recois l'image d'un formulaire papier scanne, rempli a la main, et tu dois en extraire \
les champs demandes avec la plus grande precision possible, y compris l'ecriture manuscrite \
cursive en francais, meme si elle est dense ou de qualite moyenne.

Regles generales :
- Renvoie UNIQUEMENT du JSON valide correspondant exactement au schema demande, sans texte \
avant/apres, sans balises markdown.
- Pour chaque champ scalaire, donne "value" (texte lu, ou null si le champ est vide/illisible) \
et "confidence" (ton estimation 0-100 sur la fiabilite de la LECTURE, pas sur autre chose).
- Ne jamais inventer une valeur pour un champ vide ou reellement illisible : value=null, \
confidence=0. Mais une ecriture difficile n'est pas la meme chose qu'un champ vide : \
donne toujours ta meilleure hypothese de lecture avec une confidence basse plutot que de \
mettre null par facilite.

Attention particuliere - deux zones sont historiquement les plus difficiles et demandent le \
plus grand soin :

1. "work_required" (Travaux demandes / work required) : c'est un bloc manuscrit dense de \
plusieurs lignes, souvent avec des tirets/puces, des abreviations techniques (FWD, AFT, CW, \
DW, NW, WCES, BTD, etc.) et des numeros de reference. Lis CHAQUE ligne independamment, du \
haut vers le bas, et conserve les sauts de ligne dans "value" (utilise \\n entre les lignes). \
Ne resume PAS le contenu, ne saute AUCUNE ligne meme partiellement illisible -- transcris ce \
que tu vois de plus probable pour cette ligne plutot que de l'omettre.

2. "material_sold" (tableau MATERIEL VENDU / MATERIAL SOLD, 4 colonnes Qte/Designation/\
Reference/Prix) : parcours le tableau ligne par ligne de haut en bas. Inclus TOUTE ligne ou \
au moins UNE des 4 colonnes contient une marque manuscrite, meme si les autres colonnes de \
cette meme ligne sont vides ou illisibles (mets alors null pour la colonne concernee). \
N'ignore une ligne que si elle est entierement vierge (aucune encre dans aucune colonne). \
Ne fusionne jamais deux lignes du tableau en une seule."""


def _build_user_prompt() -> str:
    fields_desc = "\n".join(f"- {name}: {desc}" for name, desc in _FIELD_DESCRIPTIONS.items())
    # IMPORTANT : ne jamais utiliser "..." comme exemple de valeur dans le
    # schema montre au modele -- un petit modele (ex. moondream sur Ollama)
    # peut le recopier LITTERALEMENT comme reponse au lieu de le traiter
    # comme un simple placeholder. On utilise donc une instruction explicite
    # sans ambiguite plutot qu'un symbole que le modele pourrait imiter.
    schema_fields = ",\n".join(
        f'    "{name}": {{"value": "<texte lu ou null si le champ est vide/illisible>", '
        f'"confidence": <entier 0-100>}}'
        for name in _FIELD_DESCRIPTIONS
    )
    return f"""Voici l'image d'un "Ordre Client / Customer Work Order" Sabena Technics. \
Extrais les champs suivants :

{fields_desc}

Renvoie exactement ce format JSON, en REMPLACANT chaque placeholder entre < > par la \
vraie valeur lue sur l'image (jamais le texte du placeholder lui-meme, jamais "...") :
{{
{schema_fields},
  "material_sold": [
    {{"qty": "<valeur ou null>", "designation": "<valeur ou null>", \
"reference": "<valeur ou null>", "price_raw": "<valeur ou null>"}}
  ]
}}"""


class GeminiVisionExtractor:
    """Extraction de bout en bout via un modele de vision Gemini. Meme
    interface que VisionLLMExtractor (extract(image_bgr) -> ExtractionResult),
    interchangeable dans app.main.process_document."""

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        self.model = model or VISION.model
        self.api_key = api_key or os.environ.get(VISION.api_key_env)
        self._client = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        if not self.api_key:
            raise RuntimeError(
                f"Cle API Gemini manquante. Definissez la variable d'environnement "
                f"'{VISION.api_key_env}' avec une cle gratuite obtenue sur "
                f"https://aistudio.google.com/apikey"
            )
        from google import genai  # import differe : dependance optionnelle
        self._client = genai.Client(api_key=self.api_key)
        return self._client

    def extract(self, image_bgr: np.ndarray) -> ExtractionResult:
        client = self._get_client()
        from google.genai import types
        from PIL import Image

        pil_img = Image.fromarray(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))

        logger.info(f"Extraction vision via {self.model} (Gemini)")
        try:
            response = client.models.generate_content(
                model=self.model,
                contents=[_SYSTEM_PROMPT + "\n\n" + _build_user_prompt(), pil_img],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0,
                    max_output_tokens=VISION.max_tokens,
                ),
            )
        except Exception as e:
            if "404" in str(e) or "NOT_FOUND" in str(e):
                raise RuntimeError(
                    f"Le modele Gemini '{self.model}' n'existe plus / n'est plus accessible "
                    f"(Google renomme regulierement sa gamme). Verifie le nom actuel sur "
                    f"https://ai.google.dev/gemini-api/docs/models et mets a jour "
                    f"configs.config.VISION.model. Erreur d'origine : {e}"
                ) from e
            raise
        raw_text = (response.text or "").strip()

        try:
            parsed: Dict[str, Any] = _extract_json(raw_text)
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Reponse Gemini non parsable en JSON : {e}\nReponse brute : {raw_text[:500]}")
            raise ValueError(f"Le modele Gemini n'a pas renvoye de JSON valide : {e}") from e

        return _parsed_json_to_extraction_result(parsed)
