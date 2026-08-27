import json
import re
import inspect
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Tuple

import cv2
import numpy as np
import streamlit as st

from app.main import process_document
from configs.config import VISION


# -----------------------------------------------------------------------------
# Page config
# -----------------------------------------------------------------------------
st.set_page_config(
    page_title="IDP — Sabena Ordre Client",
    page_icon="✈️",
    layout="wide",
)

# -----------------------------------------------------------------------------
# Style
# -----------------------------------------------------------------------------
st.markdown("""
<style>
    .block-container { padding-top: 2rem; }
    div[data-testid="stMetric"] {
        background: #f8f9fb;
        border: 1px solid #e6e8ec;
        border-radius: 10px;
        padding: 14px 16px 8px 16px;
    }
    div[data-testid="stMetricLabel"] { font-size: 0.85rem; color: #5a6472; }
    .engine-badge {
        display: inline-block; padding: 3px 10px; border-radius: 999px;
        font-size: 0.78rem; font-weight: 600; margin-left: 8px;
    }
    .engine-gemini  { background: #e7f0ff; color: #1a56db; }
    .engine-ollama  { background: #eaf7ea; color: #1e7d32; }
    .engine-claude  { background: #f3ecff; color: #6b21a8; }
    .engine-local_ocr, .engine-local_ocr_fallback { background: #fff4e5; color: #b45309; }
    .doc-card {
        border: 1px solid #e6e8ec; border-radius: 12px; padding: 16px 18px;
        margin-bottom: 10px; background: white;
    }
    div[data-testid="stTabs"] button { font-weight: 600; }
</style>
""", unsafe_allow_html=True)

_ENGINE_LABELS = {
    "gemini": "🧠 Gemini",
    "claude": "🧠 Claude",
    "ollama": "💻 Ollama (local)",
    "local_ocr": "🔧 OCR local (TrOCR/Tesseract)",
    "local_ocr_fallback": "⚠️ OCR local (repli auto — vision indisponible)",
}


def _engine_badge_html(engine_used: str) -> str:
    label = _ENGINE_LABELS.get(engine_used, engine_used)
    css_class = f"engine-{engine_used}"
    return f'<span class="engine-badge {css_class}">{label}</span>'


st.title("✈️ Intelligent Document Processing — Ordre Client Sabena Technics")
st.caption("Preprocessing → OCR par zone → Extraction → Validation → Analyse")


# -----------------------------------------------------------------------------
# Constants / helpers
# -----------------------------------------------------------------------------
AC_TYPES = ["A319", "A320", "A321", "A330", "A340", "B737", "B738"]


def _decode_uploaded_to_image(uploaded_file) -> np.ndarray:
    """
    Decode un fichier uploadé image (png/jpg/jpeg) en np.ndarray BGR (OpenCV).
    """
    file_bytes = np.frombuffer(uploaded_file.read(), dtype=np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Impossible de décoder l'image: {uploaded_file.name}")
    return img


def _is_image_file(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in [".png", ".jpg", ".jpeg"]


def _is_pdf_file(filename: str) -> bool:
    return Path(filename).suffix.lower() == ".pdf"


def _call_process_document_from_image_or_path(
    image_or_path,
    align_template: bool,
    use_vision: bool,
):
    """
    Appel robuste:
    - essaie d'abord avec l'objet fourni (image ndarray OU path)
    - injecte uniquement les kwargs supportés par la signature
    """
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

    return process_document(image_or_path, **kwargs)


def _safe_process_document(
    uploaded_file,
    align_template: bool,
    use_vision: bool,
):
    """
    Stratégie:
    1) Si image => passe ndarray directement (ton erreur venait de là)
    2) Si PDF => sauvegarde path puis passe path
    3) fallback si nécessaire
    """
    name = uploaded_file.name

    if _is_image_file(name):
        # IMPORTANT: uploaded_file.read() consomme le buffer; on remet curseur à 0 si besoin
        uploaded_file.seek(0)
        img = _decode_uploaded_to_image(uploaded_file)
        return _call_process_document_from_image_or_path(img, align_template, use_vision)

    if _is_pdf_file(name):
        uploaded_file.seek(0)
        tmp_dir = Path("data/input")
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = tmp_dir / name
        tmp_path.write_bytes(uploaded_file.read())
        return _call_process_document_from_image_or_path(str(tmp_path), align_template, use_vision)

    raise ValueError(f"Type de fichier non supporté: {name}")


def _safe_get_field_obj(result: Any, key: str):
    try:
        return result.extraction.fields.get(key)
    except Exception:
        return None


def _safe_get_field_value(result: Any, key: str) -> str:
    fv = _safe_get_field_obj(result, key)
    if fv is None or fv.value is None:
        return ""
    return str(fv.value)


def _safe_get_field_raw(result: Any, key: str) -> str:
    fv = _safe_get_field_obj(result, key)
    if fv is None:
        return ""
    return str(getattr(fv, "raw_text", "") or "")


def _safe_get_field_conf(result: Any, key: str) -> float:
    fv = _safe_get_field_obj(result, key)
    if fv is None:
        return 0.0
    try:
        return float(getattr(fv, "confidence", 0.0))
    except Exception:
        return 0.0


def _safe_get_field_review(result: Any, key: str) -> bool:
    fv = _safe_get_field_obj(result, key)
    if fv is None:
        return False
    return bool(getattr(fv, "needs_review", False))


def _is_valid_date_fr(v: str) -> bool:
    try:
        datetime.strptime(v, "%d/%m/%Y")
        return True
    except Exception:
        return False


def _validate_manual_data(data: Dict[str, str]) -> List[Tuple[str, str, str]]:
    issues: List[Tuple[str, str, str]] = []

    required_fields = ["date", "ac_type", "ac_registration", "airline_customer"]
    for f in required_fields:
        if not str(data.get(f, "")).strip():
            issues.append((f, "error", "Champ obligatoire manquant"))

    if data.get("date") and not _is_valid_date_fr(data["date"]):
        issues.append(("date", "error", "Format date attendu: jj/mm/aaaa"))

    if data.get("customer_rep_date") and not _is_valid_date_fr(data["customer_rep_date"]):
        issues.append(("customer_rep_date", "warning", "Date représentant invalide (jj/mm/aaaa)"))

    if data.get("ac_type") and data["ac_type"].upper() not in AC_TYPES:
        issues.append(("ac_type", "warning", f"Type avion inattendu: {data['ac_type']}"))

    reg = str(data.get("ac_registration", "")).upper().replace(" ", "")
    if reg and not re.match(r"^TS-[A-Z0-9]{3,5}$", reg):
        issues.append(("ac_registration", "warning", "Format recommandé: TS-XXX (3 à 5 caractères)"))

    mh = str(data.get("required_mh", "")).strip()
    if mh:
        try:
            v = float(mh.replace(",", "."))
            if v <= 0 or v > 200:
                issues.append(("required_mh", "warning", "MH hors plage raisonnable"))
        except Exception:
            issues.append(("required_mh", "warning", "MH doit être numérique"))

    return issues


def _normalize_manual_data(data: Dict[str, str]) -> Dict[str, str]:
    out = dict(data)
    out["ac_type"] = out.get("ac_type", "").upper().strip()
    out["ac_registration"] = out.get("ac_registration", "").upper().replace(" ", "").strip()
    out["required_mh"] = out.get("required_mh", "").replace(",", ".").strip()
    return out


def _result_to_table_rows(result: Any) -> List[Dict[str, Any]]:
    rows = []
    try:
        fields = result.extraction.fields
        for k, fv in fields.items():
            rows.append({
                "Champ": k,
                "Valeur": fv.value,
                "Confiance (%)": getattr(fv, "confidence", None),
                "À vérifier": "⚠️" if getattr(fv, "needs_review", False) else "",
                "Texte brut OCR": getattr(fv, "raw_text", ""),
                "Moteur": getattr(fv, "engine", ""),
            })
    except Exception:
        pass
    return rows


def _build_init_data_from_ocr(result: Any) -> Dict[str, str]:
    return {
        "order_number": _safe_get_field_value(result, "order_number"),
        "date": _safe_get_field_value(result, "date"),
        "lieu_place": _safe_get_field_value(result, "lieu_place"),
        "ac_type": _safe_get_field_value(result, "ac_type"),
        "ac_registration": _safe_get_field_value(result, "ac_registration"),
        "airline_customer": _safe_get_field_value(result, "airline_customer"),
        "required_mh": _safe_get_field_value(result, "required_mh"),
        "work_required": _safe_get_field_value(result, "work_required"),
        "customer_rep_name": _safe_get_field_value(result, "customer_rep_name"),
        "customer_rep_date": _safe_get_field_value(result, "customer_rep_date"),
    }


# -----------------------------------------------------------------------------
# Sidebar
# -----------------------------------------------------------------------------
with st.sidebar:
    st.header("📥 Upload")
    uploaded_files = st.file_uploader(
        "Image(s) ou PDF scanné(s)",
        type=["png", "jpg", "jpeg", "pdf"],
        accept_multiple_files=True
    )

    align_template = st.checkbox("Aligner sur le template de référence", value=True)
    use_vision = st.checkbox(
        f"🧠 Extraction vision ({VISION.provider} → {' → '.join(VISION.fallback_chain)} → local) "
        f"— au lieu de l'OCR par zones seul",
        value=VISION.enabled,
        help="Chaîne de secours automatique : Gemini d'abord (rapide, précis), puis Ollama"
             " (local) si indisponible, puis TrOCR/Tesseract 100% local en dernier recours."
             " Décoche pour forcer directement le pipeline 100% local."
    )

    if use_vision and not VISION.enabled:
        st.info("Le mode Vision config est désactivé dans config (VISION.enabled=False).")

    run_btn = st.button("🚀 Traiter les documents", type="primary", disabled=not uploaded_files)


# -----------------------------------------------------------------------------
# Main workflow
# -----------------------------------------------------------------------------
if not uploaded_files:
    st.info("Charge un ou plusieurs documents dans le panneau de gauche, puis clique sur **Traiter les documents**.")
    st.stop()

if run_btn:
    results = []
    progress = st.progress(0)
    status = st.empty()

    for i, f in enumerate(uploaded_files, start=1):
        status.write(f"Traitement: **{f.name}** ({i}/{len(uploaded_files)})")
        try:
            result = _safe_process_document(
                uploaded_file=f,
                align_template=align_template,
                use_vision=use_vision,
            )
            results.append((f.name, result))
        except Exception as e:
            st.error(f"Erreur sur {f.name}: {e}")
        progress.progress(i / len(uploaded_files))

    if results:
        status.success(f"{len(results)} document(s) traité(s).")
        st.session_state["last_results"] = results
    else:
        status.error("Aucun document n'a pu être traité.")

results = st.session_state.get("last_results", [])
if not results:
    st.stop()

doc_names = [x[0] for x in results]
selected_doc = st.selectbox("Document", options=doc_names, index=0)
selected_result = next(r for (n, r) in results if n == selected_doc)

tabs = st.tabs(["📄 Aperçu extraction", "✍️ Correction manuelle (Option A)", "📦 Export final", "📊 Analyse"])

with tabs[0]:
    st.markdown(_engine_badge_html(getattr(selected_result, "engine_used", "local_ocr")),
                unsafe_allow_html=True)
    if getattr(selected_result, "requires_review", True):
        st.warning("⚠️ **À vérifier manuellement avant export** — ce document ne passe pas "
                    "le seuil de confiance automatique.")
        for reason in getattr(selected_result, "review_reasons", []):
            st.caption(f"• {reason}")
    else:
        st.success(f"✅ **Fiable** — score de confiance global "
                   f"{selected_result.global_confidence_score:.0%}. Vérification rapide recommandée quand même.")

    st.subheader("Informations extraites (OCR)")
    rows = _result_to_table_rows(selected_result)
    if rows:
        st.dataframe(rows, use_container_width=True, hide_index=True)
    else:
        st.warning("Aucune donnée d'extraction disponible.")

with tabs[1]:
    st.subheader("Correction manuelle assistée")
    st.caption("Pré-rempli avec OCR. Corrige les champs critiques, valide puis exporte.")

    init_data = _build_init_data_from_ocr(selected_result)
    session_key_data = f"manual_data::{selected_doc}"
    session_key_issues = f"manual_issues::{selected_doc}"

    if session_key_data not in st.session_state:
        st.session_state[session_key_data] = init_data.copy()

    current = st.session_state[session_key_data]

    with st.form(key=f"manual_form::{selected_doc}", clear_on_submit=False):
        c1, c2 = st.columns(2)

        with c1:
            order_number = st.text_input("order_number", value=current.get("order_number", ""))
            date = st.text_input("date (jj/mm/aaaa) *", value=current.get("date", ""))
            lieu_place = st.text_input("lieu_place", value=current.get("lieu_place", ""))
            ac_type = st.text_input("ac_type *", value=current.get("ac_type", ""))
            ac_registration = st.text_input("ac_registration *", value=current.get("ac_registration", ""))

        with c2:
            airline_customer = st.text_input("airline_customer *", value=current.get("airline_customer", ""))
            required_mh = st.text_input("required_mh", value=current.get("required_mh", ""))
            customer_rep_name = st.text_input("customer_rep_name", value=current.get("customer_rep_name", ""))
            customer_rep_date = st.text_input("customer_rep_date (jj/mm/aaaa)", value=current.get("customer_rep_date", ""))
            work_required = st.text_area("work_required", value=current.get("work_required", ""), height=140)

        col_a, col_b = st.columns([1, 1])
        submit_validate = col_a.form_submit_button("✅ Valider corrections", type="primary")
        submit_reset = col_b.form_submit_button("↺ Recharger depuis OCR")

    if submit_reset:
        st.session_state[session_key_data] = init_data.copy()
        st.session_state[session_key_issues] = []
        st.info("Valeurs rechargées depuis OCR.")
        st.rerun()

    if submit_validate:
        manual_data = {
            "order_number": order_number.strip(),
            "date": date.strip(),
            "lieu_place": lieu_place.strip(),
            "ac_type": ac_type.strip(),
            "ac_registration": ac_registration.strip(),
            "airline_customer": airline_customer.strip(),
            "required_mh": required_mh.strip(),
            "work_required": work_required.strip(),
            "customer_rep_name": customer_rep_name.strip(),
            "customer_rep_date": customer_rep_date.strip(),
        }

        manual_data = _normalize_manual_data(manual_data)
        issues = _validate_manual_data(manual_data)

        st.session_state[session_key_data] = manual_data
        st.session_state[session_key_issues] = issues

        errors = [x for x in issues if x[1] == "error"]

        if errors:
            st.error("Validation bloquante: corrige les erreurs ci-dessous.")
        else:
            st.success("Validation OK (aucune erreur bloquante).")

        for fld, lvl, msg in issues:
            if lvl == "error":
                st.error(f"**{fld}** — {msg}")
            else:
                st.warning(f"**{fld}** — {msg}")

    with st.expander("🔎 Audit OCR (brut vs corrigé)", expanded=False):
        corrected = st.session_state.get(session_key_data, init_data)
        for k in corrected.keys():
            st.markdown(f"**{k}**")
            st.write(f"- OCR valeur: `{_safe_get_field_value(selected_result, k)}`")
            st.write(f"- OCR brut  : `{_safe_get_field_raw(selected_result, k)}`")
            st.write(f"- Corrigé   : `{corrected.get(k, '')}`")
            st.write("---")

with tabs[2]:
    st.subheader("Export final")

    session_key_data = f"manual_data::{selected_doc}"
    session_key_issues = f"manual_issues::{selected_doc}"

    manual_data = st.session_state.get(session_key_data, _build_init_data_from_ocr(selected_result))
    issues = st.session_state.get(session_key_issues, [])

    payload = {
        "document_name": selected_doc,
        "mode": "option_a_human_in_the_loop",
        "final_fields": manual_data,
        "validation_issues": [{"field": f, "level": l, "message": m} for (f, l, m) in issues],
        "ocr_snapshot": {
            k: {
                "value": _safe_get_field_value(selected_result, k),
                "raw_text": _safe_get_field_raw(selected_result, k),
                "confidence": _safe_get_field_conf(selected_result, k),
                "needs_review": _safe_get_field_review(selected_result, k),
            }
            for k in manual_data.keys()
        },
        "exported_at": datetime.now().isoformat(timespec="seconds"),
    }

    st.json(payload, expanded=False)

    st.download_button(
        label="⬇️ Télécharger JSON final corrigé",
        data=json.dumps(payload, ensure_ascii=False, indent=2),
        file_name=f"{Path(selected_doc).stem}_final_corrige.json",
        mime="application/json"
    )

    n_err = len([x for x in issues if x[1] == "error"])
    n_warn = len([x for x in issues if x[1] == "warning"])
    c1, c2, c3 = st.columns(3)
    c1.metric("Erreurs", n_err)
    c2.metric("Warnings", n_warn)
    c3.metric("Champs finaux", len(payload["final_fields"]))


with tabs[3]:
    st.subheader("📊 Analyse des résultats — tous les documents traités")
    st.caption("Vue groupée de la session en cours. Traite plusieurs documents dans le "
               "panneau de gauche pour comparer.")

    all_results = [r for (_, r) in results]
    n_docs = len(all_results)
    n_review = sum(1 for r in all_results if getattr(r, "requires_review", True))
    n_fallback = sum(1 for r in all_results if getattr(r, "engine_used", "") == "local_ocr_fallback")
    avg_conf = (sum(getattr(r, "global_confidence_score", 0.0) for r in all_results) / n_docs) if n_docs else 0.0
    avg_time = (sum(getattr(r, "processing_time_s", 0.0) for r in all_results) / n_docs) if n_docs else 0.0

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Documents traités", n_docs)
    m2.metric("✅ Fiables", n_docs - n_review, delta=f"-{n_review} à vérifier" if n_review else None,
              delta_color="inverse")
    m3.metric("Confiance moyenne", f"{avg_conf:.0%}")
    m4.metric("Temps moyen / doc", f"{avg_time:.1f}s")

    if n_fallback:
        st.warning(f"⚠️ {n_fallback} document(s) traité(s) en mode dégradé (extraction vision "
                    f"indisponible, repli automatique sur l'OCR local) — à revérifier en priorité.")

    st.markdown("#### Vue d'ensemble par document")
    overview_rows = []
    for name, r in results:
        overview_rows.append({
            "Document": name,
            "Moteur": _ENGINE_LABELS.get(getattr(r, "engine_used", ""), getattr(r, "engine_used", "?")),
            "Statut": "⚠️ À vérifier" if getattr(r, "requires_review", True) else "✅ Fiable",
            "Confiance globale": f"{getattr(r, 'global_confidence_score', 0.0):.0%}",
            "Champs à revoir": sum(1 for fv in r.extraction.fields.values() if getattr(fv, "needs_review", False)),
            "Lignes tableau": len(getattr(r.extraction, "material_sold", []) or []),
            "Temps (s)": round(getattr(r, "processing_time_s", 0.0), 2),
        })
    st.dataframe(overview_rows, use_container_width=True, hide_index=True)

    st.markdown("#### Confiance moyenne par champ (tous documents confondus)")
    field_confidences: Dict[str, List[float]] = {}
    field_review_counts: Dict[str, int] = {}
    for r in all_results:
        for k, fv in r.extraction.fields.items():
            field_confidences.setdefault(k, []).append(float(getattr(fv, "confidence", 0.0)))
            if getattr(fv, "needs_review", False):
                field_review_counts[k] = field_review_counts.get(k, 0) + 1

    if field_confidences:
        field_stats_rows = [
            {
                "Champ": k,
                "Confiance moyenne (%)": round(sum(v) / len(v), 1),
                "Fois signalé ⚠️": field_review_counts.get(k, 0),
            }
            for k, v in field_confidences.items()
        ]
        field_stats_rows.sort(key=lambda x: x["Confiance moyenne (%)"])
        st.dataframe(field_stats_rows, use_container_width=True, hide_index=True)
        st.bar_chart(
            {row["Champ"]: row["Confiance moyenne (%)"] for row in field_stats_rows},
        )
    else:
        st.info("Pas encore assez de données pour une analyse par champ.")

    st.markdown("#### Export global (tous les documents de la session)")
    export_all = [
        {
            "document": name,
            "engine_used": getattr(r, "engine_used", None),
            "requires_review": getattr(r, "requires_review", None),
            "review_reasons": getattr(r, "review_reasons", []),
            "global_confidence_score": getattr(r, "global_confidence_score", None),
            "fields": {k: v.value for k, v in r.extraction.fields.items()},
            "material_sold": [
                {"qty": row.qty, "designation": row.designation, "reference": row.reference,
                 "price": row.price, "price_raw": row.price_raw}
                for row in (r.extraction.material_sold or [])
            ],
        }
        for name, r in results
    ]
    st.download_button(
        label="⬇️ Télécharger l'analyse groupée (JSON, tous les documents)",
        data=json.dumps(export_all, ensure_ascii=False, indent=2),
        file_name=f"analyse_groupee_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        mime="application/json",
    )