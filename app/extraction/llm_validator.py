"""
Validation croisee des champs extraits via un modele de langage (Gemini,
gratuit). Contrairement a une simple regle de format (validators.py), ce
module attrape ce qu'une regle fixe ne peut pas voir : un champ qui a une
forme valide mais un contenu incoherent (ex: date grammaticalement correcte
mais totalement improbable, sigle de type avion proche d'un vrai type mais
corrompu par l'OCR, texte de work_required qui ressemble a du charabia
d'OCR plutot qu'a du francais technique).

Avant : ce module etait un placeholder qui renvoyait un score fixe (0.7)
des qu'une cle API existait, sans jamais rien verifier reellement -- ce qui
faussait silencieusement 20% du score de confiance global (voir
CONFIDENCE_WEIGHTS). Il fait maintenant un vrai appel, textuel donc rapide
et peu couteux (pas d'image), et renvoie used_llm=False honnetement des
qu'il n'a pas pu verifier quoi que ce soit -- main._compute_confidence
exclut alors sa composante du score au lieu de la faire semblant.
"""
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List

from app.extraction.information_extractor import ExtractionResult
from app.utils.logger import get_logger
from configs.config import LLM_VALIDATION

logger = get_logger(__name__)


@dataclass
class LLMValidationReport:
    issues: List[str] = field(default_factory=list)
    corrected_fields: Dict[str, Any] = field(default_factory=dict)
    confidence_score: float = 0.5
    used_llm: bool = False


_PROMPT = """Tu verifies les champs extraits (par OCR, potentiellement bruite) d'un \
bon de travail Sabena Technics "Ordre Client / Customer Work Order". On te donne les \
valeurs lues. Detecte les incoherences PLAUSIBLES, pas juste des erreurs de format \
(deja verifiees ailleurs) :
- une valeur qui ressemble a du charabia d'OCR plutot qu'a du texte reel (lettres \
aleatoires, mots tronques/repetes) ;
- une date grammaticalement valide mais absurde (ex: annee tres eloignee, jour/mois \
incoherents avec le contexte) ;
- un type avion (ac_type) proche d'un vrai type Airbus/Boeing mais visiblement corrompu \
(ex: caractere en trop/manquant par rapport a A319/A320/A321/A330/B737/B777 etc.) ;
- un nombre d'heures (required_mh) improbable pour une intervention MRO (ex: 0, negatif, \
ou trois chiffres) ;
- une incoherence entre deux champs (ex: le texte de work_required mentionne un type \
avion different de ac_type).

Champs a verifier (JSON) :
{fields_json}

Reponds UNIQUEMENT en JSON, sans texte autour :
{{"issues": ["description courte de chaque probleme trouve, vide si aucun"], \
"confidence_score": 0.0-1.0}}
confidence_score = ta confiance globale que CES VALEURS (telles que lues) sont correctes, \
pas une note de qualite d'ecriture."""


def _extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    text = re.sub(r"^```(json)?|```$", "", text, flags=re.MULTILINE).strip()
    return json.loads(text)


def validate_with_llm(result: ExtractionResult) -> LLMValidationReport:
    if not LLM_VALIDATION.enabled:
        return LLMValidationReport(confidence_score=0.5, used_llm=False)

    api_key = os.environ.get(LLM_VALIDATION.api_key_env)
    if not api_key:
        logger.warning(
            f"LLM validation: variable '{LLM_VALIDATION.api_key_env}' absente -> "
            f"pas de verification reelle effectuee (fallback neutre, exclu du score)."
        )
        return LLMValidationReport(confidence_score=0.5, used_llm=False)

    fields_payload = {
        name: fv.value for name, fv in result.fields.items() if fv.value is not None
    }
    if not fields_payload:
        return LLMValidationReport(confidence_score=0.5, used_llm=False)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=LLM_VALIDATION.model,
            contents=_PROMPT.format(fields_json=json.dumps(fields_payload, ensure_ascii=False)),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
                max_output_tokens=1024,
            ),
        )
        parsed = _extract_json(response.text or "")
        return LLMValidationReport(
            issues=list(parsed.get("issues") or []),
            corrected_fields={},
            confidence_score=float(parsed.get("confidence_score", 0.5)),
            used_llm=True,
        )
    except Exception as e:
        # On ne fait JAMAIS semblant en cas d'echec : fallback neutre honnete,
        # explicitement exclu du calcul de confiance (used_llm=False)
        logger.warning(f"LLM validation: appel echoue ({e}) -> fallback neutre exclu du score")
        return LLMValidationReport(confidence_score=0.5, used_llm=False)
