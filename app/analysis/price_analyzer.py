"""
Analyse statistique + rapport LLM sur les prix des matériaux vendus,
filtrable par intervalle de dates.

Deux couches bien séparées :
- `compute_price_stats` : agrégations pures Python/SQL (rapides, fiables,
  utilisées telles quelles pour les diagrammes du frontend) ;
- `generate_price_report` : un résumé en langage naturel produit par un LLM
  à partir de ces stats déjà calculées (le LLM ne voit jamais les prix bruts
  un par un, seulement les agrégats -> réponse rapide, peu coûteuse, et pas
  de risque qu'il "invente" un total en recomptant lui-même).

Même chaîne de providers que llm_validator.py (repli automatique, jamais
d'erreur bloquante) mais adaptée à une tâche texte seul (pas d'image) :
Hugging Face Inference API par défaut (modèle instruct léger, largement
suffisant pour résumer des statistiques déjà calculées), repli Ollama
local, et repli final sur un résumé généré par template si aucun LLM n'est
joignable (honnête sur le fait qu'il ne s'agit pas d'un texte LLM).
"""
import json
import os
import re
from typing import Any, Dict, List, Optional

from app.utils.logger import get_logger
from configs.config import OLLAMA_VISION, PRICE_ANALYSIS_LLM

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Statistiques pures (pas de LLM)
# ---------------------------------------------------------------------------

def compute_price_stats(materials: List[Dict[str, Any]]) -> Dict[str, Any]:
    """`materials` = sortie de db.get_materials_in_range()."""
    n = len(materials)
    prices = [m["price"] for m in materials if isinstance(m.get("price"), (int, float))]
    total_value = round(sum(prices), 2)
    avg_price = round(total_value / n, 2) if n else 0.0
    max_item = max(materials, key=lambda m: m["price"], default=None)
    min_item = min(materials, key=lambda m: m["price"], default=None)

    by_month: Dict[str, Dict[str, float]] = {}
    for m in materials:
        iso = m.get("iso_date")
        ym = iso[:7] if iso else "Date inconnue"
        b = by_month.setdefault(ym, {"count": 0, "total": 0.0})
        b["count"] += 1
        b["total"] += m["price"]
    by_month_list = [
        {"month": ym, "count": v["count"], "total": round(v["total"], 2)}
        for ym, v in sorted(by_month.items())
    ]

    by_designation: Dict[str, Dict[str, float]] = {}
    for m in materials:
        d = m.get("designation") or "Non désigné"
        b = by_designation.setdefault(d, {"count": 0, "total": 0.0})
        b["count"] += 1
        b["total"] += m["price"]
    top_designations = sorted(
        (
            {"designation": d, "count": v["count"], "total": round(v["total"], 2)}
            for d, v in by_designation.items()
        ),
        key=lambda x: -x["total"],
    )[:10]

    by_ac_type: Dict[str, float] = {}
    for m in materials:
        t = (m.get("ac_type") or "Inconnu").strip() or "Inconnu"
        by_ac_type[t] = by_ac_type.get(t, 0.0) + m["price"]
    by_ac_type_list = sorted(
        ({"ac_type": t, "total": round(v, 2)} for t, v in by_ac_type.items()),
        key=lambda x: -x["total"],
    )

    # Évolution mois-sur-mois du prix moyen, pour repérer une dérive de coûts.
    month_avg = [
        {"month": b["month"], "avg": round(b["total"] / b["count"], 2) if b["count"] else 0.0}
        for b in by_month_list
    ]
    trend_pct: Optional[float] = None
    if len(month_avg) >= 2 and month_avg[0]["avg"]:
        trend_pct = round(
            (month_avg[-1]["avg"] - month_avg[0]["avg"]) / month_avg[0]["avg"] * 100, 1
        )

    return {
        "n_items": n,
        "total_value": total_value,
        "avg_price": avg_price,
        "max_item": max_item,
        "min_item": min_item,
        "by_month": by_month_list,
        "top_designations": top_designations,
        "by_ac_type": by_ac_type_list,
        "month_avg_trend": month_avg,
        "trend_pct": trend_pct,
    }


# ---------------------------------------------------------------------------
# Rapport en langage naturel (LLM)
# ---------------------------------------------------------------------------

_PROMPT = """Tu es analyste financier pour un atelier de maintenance aéronautique (Sabena \
Technics). On te donne des statistiques déjà calculées (pas les données brutes) sur les \
matériaux vendus/facturés sur une période donnée, dans le cadre d'ordres de travail (bons \
de commande client). Rédige un rapport court et utile en FRANÇAIS, en Markdown, à \
destination d'un responsable qui doit prendre des décisions rapides.

Structure attendue (utilise ces titres) :
## Résumé
2-3 phrases sur le volume et la valeur totale de la période.
## Tendances
Évolution dans le temps (mois par mois), postes qui pèsent le plus, avion(s) concerné(s).
## Points d'attention
Anomalies ou éléments à vérifier (ex: un item anormalement cher, une hausse brutale) --\
 uniquement si les chiffres le justifient, ne pas inventer.
## Recommandations
2-3 actions concrètes et réalistes pour un gestionnaire (négociation fournisseur, \
vérification d'un poste, suivi d'un avion...).

Reste factuel, base-toi uniquement sur les chiffres fournis, pas de blabla générique. \
Sois concis (250 mots maximum au total).

Statistiques (JSON) :
{stats_json}
"""


def _extract_text(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"^```(markdown|md)?|```$", "", text, flags=re.MULTILINE).strip()
    return text


def _fallback_report(stats: Dict[str, Any]) -> str:
    """Résumé sans LLM (toujours disponible), honnête sur son origine."""
    n = stats["n_items"]
    total = stats["total_value"]
    lines = [
        "## Résumé",
        f"{n} pièce(s) facturée(s) sur la période, pour une valeur totale de "
        f"{total:.2f} TND (moyenne {stats['avg_price']:.2f} TND/pièce).",
        "",
        "## Tendances",
    ]
    if stats["top_designations"]:
        top = stats["top_designations"][0]
        lines.append(
            f"Le poste le plus coûteux est **{top['designation']}** "
            f"({top['total']:.2f} TND sur {top['count']} occurrence(s))."
        )
    if stats["trend_pct"] is not None:
        sens = "hausse" if stats["trend_pct"] > 0 else "baisse"
        lines.append(f"Le prix moyen mensuel est en {sens} de {abs(stats['trend_pct'])}% sur la période.")
    lines += [
        "",
        "## Points d'attention",
        "_(analyse automatique non disponible — LLM non joignable ; vérifiez manuellement "
        "les postes les plus élevés ci-dessous)_",
        "",
        "## Recommandations",
        "Configurez une clé HF_TOKEN (https://huggingface.co/settings/tokens, gratuite) — "
        "ou lancez Ollama en local — pour obtenir une analyse qualitative complète générée par IA.",
    ]
    return "\n".join(lines)


def _try_huggingface(prompt: str) -> Optional[str]:
    api_key = os.environ.get(PRICE_ANALYSIS_LLM.api_key_env)
    if not api_key:
        logger.warning(
            f"Rapport prix : variable '{PRICE_ANALYSIS_LLM.api_key_env}' absente -> "
            f"pas d'appel Hugging Face (cle gratuite: https://huggingface.co/settings/tokens)"
        )
        return None
    try:
        from huggingface_hub import InferenceClient

        client = InferenceClient(
            model=PRICE_ANALYSIS_LLM.model, token=api_key, provider="auto", timeout=20
        )
        completion = client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=PRICE_ANALYSIS_LLM.max_tokens,
            temperature=0.2,
        )
        text = completion.choices[0].message.content or ""
        return _extract_text(text)
    except ImportError:
        logger.warning(
            "Rapport prix : package 'huggingface_hub' non installe -> "
            "pip install huggingface_hub"
        )
        return None
    except Exception as e:
        logger.warning(f"Rapport prix : appel Hugging Face echoue ({e})")
        return None


def _try_ollama(prompt: str) -> Optional[str]:
    try:
        import ollama
    except ImportError:
        return None
    try:
        client = ollama.Client(host=OLLAMA_VISION.host, timeout=15)
        response = client.chat(
            model=PRICE_ANALYSIS_LLM.ollama_model,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.2},
        )
        return _extract_text(response["message"]["content"] or "")
    except Exception as e:
        logger.warning(f"Rapport prix : appel Ollama echoue ({e})")
        return None


def generate_price_report(stats: Dict[str, Any]) -> Dict[str, Any]:
    """Retourne {"report": str, "generated_by": 'huggingface'|'ollama'|'template'}."""
    if stats["n_items"] == 0:
        return {
            "report": "## Résumé\nAucune donnée facturée sur la période sélectionnée.",
            "generated_by": "template",
        }

    prompt = _PROMPT.format(stats_json=json.dumps(stats, ensure_ascii=False, default=str))

    if PRICE_ANALYSIS_LLM.provider == "huggingface":
        text = _try_huggingface(prompt)
        if text:
            return {"report": text, "generated_by": "huggingface"}

    text = _try_ollama(prompt)
    if text:
        return {"report": text, "generated_by": "ollama"}

    return {"report": _fallback_report(stats), "generated_by": "template"}


def analyze_prices(materials: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Point d'entrée unique utilisé par l'API : stats + rapport LLM."""
    stats = compute_price_stats(materials)
    report_data = generate_price_report(stats)
    return {
        "stats": stats,
        "report": report_data["report"],
        "generated_by": report_data["generated_by"],
        "items": materials,
    }
