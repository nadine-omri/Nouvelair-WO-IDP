"""
Outil interactif de calibration des zones (ROI) du template.

Usage :
    streamlit run tools/calibrate_roi.py

Charger une image de reference propre (scan bien droit), ajuster les
coordonnees (en % de la largeur/hauteur) de chaque champ avec les sliders,
visualiser immediatement le rectangle sur l'image, puis exporter le
configs/roi_template.json mis a jour.

Ceci reprend le principe de l'outil de calibration ROI deja utilise dans le
pipeline OCR local (formulaires Sabena Technics), adapte a ce document.
"""
import copy
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.preprocessing.image_preprocessor import preprocess
from configs.config import BASE_DIR

ROI_PATH = BASE_DIR / "configs" / "roi_template.json"

st.set_page_config(page_title="Calibration ROI - Sabena Work Order", layout="wide")
st.title("🎯 Calibration des zones (ROI) — Ordre Client Sabena Technics")
st.caption(
    "Charge un scan de reference bien droit et bien cadre, puis ajuste chaque zone. "
    "Exporte ensuite le JSON pour l'utiliser dans le pipeline principal."
)

if "roi_template" not in st.session_state:
    with open(ROI_PATH, "r", encoding="utf-8") as f:
        st.session_state.roi_template = json.load(f)
template = st.session_state.roi_template

if st.sidebar.button("↩️ Recharger depuis le fichier (annuler les changements non exportes)"):
    with open(ROI_PATH, "r", encoding="utf-8") as f:
        st.session_state.roi_template = json.load(f)
    st.rerun()

uploaded = st.file_uploader("Scan de reference (image)", type=["png", "jpg", "jpeg"])

if uploaded is None:
    st.info("Charge une image pour commencer la calibration.")
    st.stop()

file_bytes = np.asarray(bytearray(uploaded.read()), dtype=np.uint8)
img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
pre = preprocess(img)
base_img = cv2.cvtColor(pre.gray, cv2.COLOR_GRAY2BGR)
h, w = base_img.shape[:2]

st.sidebar.header("Champs")
zone_names = [z["field"] for z in template["zones"] if z["type"] != "table"]
selected_field = st.sidebar.selectbox("Zone a ajuster", zone_names)

zone = next(z for z in template["zones"] if z["field"] == selected_field)
x0, y0, x1, y1 = zone["bbox"]

col_a, col_b = st.sidebar.columns(2)
with col_a:
    x0 = st.slider("x0 (%)", 0.0, 1.0, x0, 0.005, key=f"x0_{selected_field}")
    y0 = st.slider("y0 (%)", 0.0, 1.0, y0, 0.005, key=f"y0_{selected_field}")
with col_b:
    x1 = st.slider("x1 (%)", 0.0, 1.0, x1, 0.005, key=f"x1_{selected_field}")
    y1 = st.slider("y1 (%)", 0.0, 1.0, y1, 0.005, key=f"y1_{selected_field}")

zone["bbox"] = [x0, y0, x1, y1]

# Dessin de toutes les zones (verte = selectionnee, bleu = autres)
preview = base_img.copy()
for z in template["zones"]:
    if z["type"] == "table":
        bx0, by0, bx1, by1 = z["bbox"]
        color = (255, 140, 0)
    else:
        bx0, by0, bx1, by1 = z["bbox"]
        color = (0, 200, 0) if z["field"] == selected_field else (200, 120, 0)
    pt1 = (int(bx0 * w), int(by0 * h))
    pt2 = (int(bx1 * w), int(by1 * h))
    thickness = 3 if z["field"] == selected_field else 1
    cv2.rectangle(preview, pt1, pt2, color, thickness)
    cv2.putText(preview, z["field"], (pt1[0], max(pt1[1] - 5, 10)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

st.image(cv2.cvtColor(preview, cv2.COLOR_BGR2RGB), use_container_width=True)

crop = base_img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
if crop.size:
    st.sidebar.image(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), caption="Apercu de la zone")

st.sidebar.divider()
if st.sidebar.button("💾 Sauvegarder comme image de reference (alignement)"):
    ref_path = BASE_DIR / "data" / "templates" / "reference_form.png"
    cv2.imwrite(str(ref_path), pre.gray)
    st.sidebar.success(f"Image de reference sauvegardee : {ref_path}")

if st.sidebar.button("💾 Exporter configs/roi_template.json"):
    with open(ROI_PATH, "w", encoding="utf-8") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    st.sidebar.success("Template ROI sauvegarde.")

st.download_button(
    "⬇️ Telecharger roi_template.json",
    data=json.dumps(template, ensure_ascii=False, indent=2),
    file_name="roi_template.json",
    mime="application/json",
)
