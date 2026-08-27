"""
Rapport IA par document : résumé en langage naturel d'un ordre de travail
(CWO) déjà extrait, avec points d'attention et comparaison de son M/H
(main d'oeuvre requise) avec la marge habituelle observée pour la même
catégorie de travaux sur l'ensemble de la base (voir db.get_hours_stats_by_work).

Consommé par l'onglet "Analyse (session)" du frontend (AnalysisTab.tsx),
un document à la fois -- contrairement à price_analyzer.py qui agrège
plusieurs WO sur une période.

Même chaîne de providers que price_analyzer.py / llm_validator.py (repli
automatique, jamais d'erreur bloquante) : Hugging Face Inference API par
défaut, repli Ollama local, repli final sur un résumé généré par template
si aucun LLM n'est joignable.
"""
import json
import os
import re
from typing import Any, Dict, List, Optional

import db
from app.utils.logger import get_logger
from configs.config import DOCUMENT_REPORT_LLM, OLLAMA_VISION

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Comparaison M/H (pas de LLM)
# ---------------------------------------------------------------------------

def compute_hours_comparison(work_required: Optional[str], required_mh: Optional[str]) -> Optional[Dict[str, Any]]:
    """Compare le M/H de ce document à la moyenne observée pour sa catégorie
    de travaux (regroupement par mots-clés, voir db.categorize_work). Ignore
    ce document lui-même dans la moyenne serait plus juste mais demanderait
    de connaître son id ; l'écart reste indicatif à ce niveau de précision."""
    mh = db._parse_mh(required_mh) if required_mh else None
    category = db.categorize_work(work_required)
    stats = db.get_hours_stats_by_work(query=category, limit=1)
    rows = [r for r in stats["rows"] if r["work_required"] == category]
    row = rows[0] if rows else None
    if not row or row["avg_mh"] is None:
        return None
    delta_pct = None
    if mh is not None and row["avg_mh"]:
        delta_pct = round((mh - row["avg_mh"]) / row["avg_mh"] * 100, 1)
    return {
        "category": category,
        "doc_mh": mh,
        "group_count": row["count"],
        "avg_mh": row["avg_mh"],
        "min_mh": row["min_mh"],
        "max_mh": row["max_mh"],
        "delta_pct": delta_pct,
    }


# ---------------------------------------------------------------------------
# Rapport en langage naturel (LLM)
# ---------------------------------------------------------------------------

_PROMPT = """Tu es assistant technique pour un atelier de maintenance aéronautique (Sabena \
Technics). On te donne les champs déjà extraits d'un ordre de travail client (CWO), les \
éventuels problèmes signalés par la validation automatique, et une comparaison de sa main \
d'oeuvre requise (M/H) avec la moyenne observée pour ce type de travaux. Rédige un rapport \
court et utile en FRANÇAIS, en Markdown, à destination d'un technicien ou responsable qui \
relit ce document.

Structure attendue (utilise ces titres) :
## Résumé
2-3 phrases : de quoi parle ce CWO (avion, travaux demandés, matériel utilisé).
## Points d'attention
Anomalies ou éléments à vérifier -- champs manquants/suspects, écart de M/H important -- \
uniquement si les données le justifient, ne pas inventer. Si rien à signaler, dis-le \
simplement.
## Recommandation
1-2 actions concrètes si nécessaire (vérifier un champ, valider le M/H...), ou une phrase \
confirmant que le document semble cohérent.

Reste factuel, base-toi uniquement sur les données fournies, pas de blabla générique. \
Sois concis (200 mots maximum au total).

Données (JSON) :
{data_json}
"""


def _extract_text(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"^```(markdown|md)?|```$", "", text, flags=re.MULTILINE).strip()
    return text


def _fallback_report(payload: Dict[str, Any]) -> str:
    """Résumé sans LLM (toujours disponible), honnête sur son origine."""
    fields = payload["fields"]
    lines = [
        "## Résumé",
        f"CWO {fields.get('order_number') or '—'} du {fields.get('date') or '—'} — "
        f"{fields.get('ac_type') or 'type avion inconnu'} ({fields.get('ac_registration') or '—'}), "
        f"{len(payload['materials'])} ligne(s) de matériel.",
        "",
        "## Points d'attention",
    ]
    issues = payload.get("validation_issues") or []
    if issues:
        for i in issues[:5]:
            lines.append(f"- {i.get('message', i)}")
    else:
        lines.append("_(analyse automatique non disponible — LLM non joignable ; "
                      "vérifiez manuellement les champs signalés dans l'onglet Correction manuelle)_")
    lines += [
        "",
        "## Recommandation",
        "Configurez une clé HF_TOKEN (https://huggingface.co/settings/tokens, gratuite) — "
        "ou lancez Ollama en local — pour obtenir une analyse qualitative complète générée par IA.",
    ]
    return "\n".join(lines)


def _try_huggingface(prompt: str) -> Optional[str]:
    api_key = os.environ.get(DOCUMENT_REPORT_LLM.api_key_env)
    if not api_key:
        logger.warning(
            f"Rapport document : variable '{DOCUMENT_REPORT_LLM.api_key_env}' absente -> "
            f"pas d'appel Hugging Face (cle gratuite: https://huggingface.co/settings/tokens)"
        )
        return None
    try:
        from huggingface_hub import InferenceClient

        client = InferenceClient(
            model=DOCUMENT_REPORT_LLM.model, token=api_key, provider="auto", timeout=20
        )
        completion = client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=DOCUMENT_REPORT_LLM.max_tokens,
            temperature=0.2,
        )
        text = completion.choices[0].message.content or ""
        return _extract_text(text)
    except ImportError:
        logger.warning(
            "Rapport document : package 'huggingface_hub' non installe -> "
            "pip install huggingface_hub"
        )
        return None
    except Exception as e:
        logger.warning(f"Rapport document : appel Hugging Face echoue ({e})")
        return None


def _try_ollama(prompt: str) -> Optional[str]:
    try:
        import ollama
    except ImportError:
        return None
    try:
        client = ollama.Client(host=OLLAMA_VISION.host, timeout=15)
        response = client.chat(
            model=DOCUMENT_REPORT_LLM.ollama_model,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.2},
        )
        return _extract_text(response["message"]["content"] or "")
    except Exception as e:
        logger.warning(f"Rapport document : appel Ollama echoue ({e})")
        return None


def generate_document_report(
    fields: Dict[str, Any],
    materials: List[Dict[str, Any]],
    validation_issues: Optional[List[Dict[str, Any]]] = None,
    llm_issues: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Retourne {"report": str, "generated_by": ..., "hours_comparison": ... | None}."""
    hours_comparison = compute_hours_comparison(
        fields.get("work_required"), fields.get("required_mh")
    )

    payload = {
        "fields": fields,
        "materials": materials,
        "validation_issues": validation_issues or [],
        "llm_issues": llm_issues or [],
        "hours_comparison": hours_comparison,
    }
    prompt = _PROMPT.format(data_json=json.dumps(payload, ensure_ascii=False, default=str))

    if DOCUMENT_REPORT_LLM.provider == "huggingface":
        text = _try_huggingface(prompt)
        if text:
            return {"report": text, "generated_by": "huggingface", "hours_comparison": hours_comparison}

    text = _try_ollama(prompt)
    if text:
        return {"report": text, "generated_by": "ollama", "hours_comparison": hours_comparison}

    return {
        "report": _fallback_report(payload),
        "generated_by": "template",
        "hours_comparison": hours_comparison,
    }
