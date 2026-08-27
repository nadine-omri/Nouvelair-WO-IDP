"""
Extraction "intelligente" du formulaire Ordre Client via un modele de vision
tournant EN LOCAL avec Ollama (aucune API, aucune donnee envoyee dehors).

Meme principe que gemini_vision_extractor.py / vision_llm_extractor.py (un
seul appel, image complete, pas de calibration ROI necessaire), mais le
modele tourne sur ta propre machine.

A savoir avant de choisir cette option : un modele local de quelques
milliards de parametres (3B ici) est loin d'egaler Gemini ou Claude en
qualite -- c'est un compromis qualite/confidentialite/hors-ligne, pas un
remplacement a l'identique. Sur CPU seul (pas de GPU dedie), prevoir
plusieurs dizaines de secondes par page.

Installation :
    1. Installer Ollama : https://ollama.com/download
    2. ollama pull qwen2.5vl:3b   (recommande pour documents/tableaux sur CPU ;
       moondream:1.8b en repli si trop lent, mais moins bon en lecture de
       tableaux/texte dense)
    3. pip install ollama
    Rien d'autre a configurer : pas de cle API, tourne sur localhost:11434.
"""
import json
from typing import Any, Dict, Optional

import cv2
import numpy as np

from app.extraction.information_extractor import ExtractionResult
from app.extraction.vision_llm_extractor import (
    _FIELD_DESCRIPTIONS,
    _extract_json,
    _parsed_json_to_extraction_result,
)
from app.extraction.gemini_vision_extractor import _SYSTEM_PROMPT, _build_user_prompt
from app.utils.logger import get_logger
from configs.config import OLLAMA_VISION

logger = get_logger(__name__)


def _build_json_schema() -> Dict[str, Any]:
    """Schema JSON strict pour contraindre la sortie d'Ollama. Contrairement a
    format="json" (qui demande juste 'du JSON valide', sans structure precise),
    un schema force les BONNES cles -- indispensable avec un petit modele comme
    moondream qui, sans ca, peut repondre un JSON valide mais avec une structure
    differente de celle attendue (d'ou des champs vides sans aucune erreur)."""
    field_props = {
        name: {
            "type": "object",
            "properties": {
                "value": {"type": ["string", "null"]},
                "confidence": {"type": "number"},
            },
            "required": ["value", "confidence"],
        }
        for name in _FIELD_DESCRIPTIONS
    }
    return {
        "type": "object",
        "properties": {
            **field_props,
            "material_sold": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "qty": {"type": ["string", "null"]},
                        "designation": {"type": ["string", "null"]},
                        "reference": {"type": ["string", "null"]},
                        "price_raw": {"type": ["string", "null"]},
                    },
                },
            },
        },
        "required": list(_FIELD_DESCRIPTIONS.keys()),
    }


_JSON_SCHEMA = _build_json_schema()


class OllamaVisionExtractor:
    """Extraction de bout en bout via un modele de vision local (Ollama).
    Meme interface que GeminiVisionExtractor/VisionLLMExtractor
    (extract(image_bgr) -> ExtractionResult), interchangeable dans
    app.main.process_document."""

    def __init__(self, model: Optional[str] = None, host: Optional[str] = None):
        self.model = model or OLLAMA_VISION.model
        self.host = host or OLLAMA_VISION.host

    def extract(self, image_bgr: np.ndarray) -> ExtractionResult:
        try:
            import ollama
        except ImportError as e:
            raise RuntimeError(
                "Le package 'ollama' n'est pas installe. Lance : pip install ollama "
                "(et assure-toi qu'Ollama tourne : https://ollama.com/download)"
            ) from e

        # Ollama attend soit un chemin, soit des bytes bruts (pas de PIL direct)
        ok, buf = cv2.imencode(".png", image_bgr)
        if not ok:
            raise RuntimeError("Echec d'encodage de l'image pour Ollama")
        image_bytes = buf.tobytes()

        client = ollama.Client(host=self.host)
        prompt = _SYSTEM_PROMPT + "\n\n" + _build_user_prompt()

        logger.info(f"Extraction vision via {self.model} (Ollama local, {self.host})")
        try:
            response = client.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt, "images": [image_bytes]}],
                format=_JSON_SCHEMA,   # schema strict (pas juste format="json") : force
                                       # les bonnes cles, essentiel pour un petit modele
                options={"temperature": 0.0},
            )
        except Exception as e:
            msg = str(e)
            if "not found" in msg.lower() or "404" in msg:
                raise RuntimeError(
                    f"Modele Ollama '{self.model}' introuvable en local. "
                    f"Lance d'abord : ollama pull {self.model}"
                ) from e
            if "connection" in msg.lower() or "refused" in msg.lower():
                raise RuntimeError(
                    f"Impossible de joindre Ollama sur {self.host}. Verifie qu'Ollama "
                    f"tourne (icone dans la barre des taches Windows, ou lance "
                    f"'ollama serve' dans un terminal)."
                ) from e
            raise

        raw_text = (response["message"]["content"] or "").strip()
        logger.debug(f"Reponse brute Ollama ({self.model}) : {raw_text[:1000]}")

        try:
            parsed: Dict[str, Any] = _extract_json(raw_text)
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Reponse Ollama non parsable en JSON : {e}\nReponse brute : {raw_text[:500]}")
            raise ValueError(
                f"Le modele local '{self.model}' n'a pas renvoye de JSON valide "
                f"(courant sur les petits modeles CPU) : {e}"
            ) from e

        result = _parsed_json_to_extraction_result(parsed)

        # Meme avec un schema strict, un petit modele peut renvoyer un JSON
        # "valide" mais vide, ou recopier un placeholder litteralement au lieu
        # de le remplacer. On traite les deux cas comme un echec exploitable
        # par la chaine de fallback plutot que de le faire remonter comme fiable.
        def _is_placeholder(v) -> bool:
            s = str(v).strip().strip("<>")
            return s in ("", "...", "…", "null", "none", "valeur ou null", "texte lu ou null")

        n_filled = sum(1 for fv in result.fields.values() if fv.value and not _is_placeholder(fv.value))
        if n_filled == 0:
            raise ValueError(
                f"Le modele local '{self.model}' n'a renvoye que des champs vides ou des "
                f"placeholders non remplaces (0/{len(result.fields)} champs exploitables) -- "
                f"reponse brute : {raw_text[:300]}"
            )

        return result
