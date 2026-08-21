# PATCH: version "plus forte" (ajoute multi-pass fallback + second opinion)

import re
import cv2
import numpy as np
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

from app.ocr.ocr_engine import OCREngine, TesseractEngine, get_default_engine, ocr_zone, compute_ink_ratio, has_ink
from app.postprocessing.text_cleaner import (
    clean_field_text, normalize_amount, normalize_date, normalize_mh,
    normalize_order_number, normalize_registration, normalize_ac_type
)
from app.utils.io_utils import load_json
from app.utils.logger import get_logger
from configs.config import BASE_DIR, OCR, VALIDATION, STRONG_MODE

logger = get_logger(__name__)
ROI_TEMPLATE_PATH = BASE_DIR / "configs" / "roi_template.json"

_FIELD_NORMALIZERS = {
    "order_number": normalize_order_number,
    "date": normalize_date,
    "ac_registration": normalize_registration,
    "ac_type": normalize_ac_type,
    "required_mh": normalize_mh,
    "customer_rep_date": normalize_date,
}
CRITICAL_FIELDS = {"order_number", "date", "ac_type", "ac_registration", "required_mh", "customer_rep_date"}

@dataclass
class FieldValue:
    raw_text: str
    value: Any
    confidence: float
    needs_review: bool
    engine: str = ""
    ink_ratio: float = 0.0
    bbox_px: tuple = (0, 0, 0, 0)

@dataclass
class MaterialRow:
    qty: Optional[str]
    designation: Optional[str]
    reference: Optional[str]
    price: Optional[float]
    price_raw: Optional[str]

@dataclass
class ExtractionResult:
    document_type: str = "sabena_customer_work_order"
    fields: Dict[str, FieldValue] = field(default_factory=dict)
    material_sold: List[MaterialRow] = field(default_factory=list)
    def to_dict(self) -> dict:
        return asdict(self)

def _is_missing(v: Any) -> bool:
    return v is None or str(v).strip() == ""

def _invalid_critical(field_name: str, value: Any) -> bool:
    if _is_missing(value):
        return True
    s = str(value).strip()
    if field_name == "order_number":
        return not re.match(r"^\d{3,6}$", s)
    if field_name == "ac_type":
        return s.upper() not in set(VALIDATION.valid_ac_types)
    if field_name == "ac_registration":
        return not re.match(r"^TS-[A-Z0-9]{3,5}$", s.upper())
    if field_name == "required_mh":
        try:
            v = float(s)
            return not (0.5 <= v <= 50.0)
        except Exception:
            return True
    return False

class InformationExtractor:
    def __init__(self, roi_template_path=ROI_TEMPLATE_PATH, engine: Optional[OCREngine] = None):
        self.template = load_json(str(roi_template_path))
        self._forced_engine = engine
        self._tesseract = TesseractEngine()
        self._hw = get_default_engine() if OCR.use_handwriting_model else None

    def _engine_for_zone(self, zone: dict) -> OCREngine:
        if self._forced_engine:
            return self._forced_engine
        if STRONG_MODE.enabled and STRONG_MODE.force_trocr_all_zones and self._hw:
            return self._hw
        if getattr(OCR, "force_trocr_all_zones", False) and self._hw:
            return self._hw
        if zone.get("type") in ("handwritten", "table") and self._hw:
            return self._hw
        return self._tesseract

    def _bbox_px(self, b, w, h):
        x0, y0, x1, y1 = b
        return (int(x0*w), int(y0*h), int((x1-x0)*w), int((y1-y0)*h))

    def _expand_bbox(self, bbox, img_w, img_h, s=0.2):
        x, y, w, h = bbox
        dx, dy = int(w*s), int(h*s)
        nx, ny = max(0, x-dx), max(0, y-dy)
        nw, nh = min(img_w-nx, w+2*dx), min(img_h-ny, h+2*dy)
        return (nx, ny, nw, nh)

    def _run_ocr(self, img, bbox, engine, multiline, field):
        o = ocr_zone(img, bbox, engine=engine, multiline=multiline)
        raw = clean_field_text(o.text)
        norm = _FIELD_NORMALIZERS.get(field, lambda x: x if x else None)(raw)
        conf = round(float(o.mean_confidence), 1)
        return raw, norm, conf, o.engine

    def _score_candidate(self, field, value, conf):
        invalid = _invalid_critical(field, value) if field in CRITICAL_FIELDS else False
        penalty = 40 if invalid else 0
        return conf - penalty

    def _extract_table(self, aligned_gray, zone, page_w, page_h) -> List[MaterialRow]:
        """Decoupe la zone tableau en n_rows lignes x colonnes (definies dans
        roi_template.json), OCRise chaque cellule, et ignore les lignes sans
        encre (lignes du tableau non remplies sur le formulaire)."""
        tx, ty, tw, th = self._bbox_px(zone["bbox"], page_w, page_h)
        n_rows = zone.get("n_rows", 1)
        row_h = th / n_rows
        engine = self._engine_for_zone(zone)

        rows: List[MaterialRow] = []
        for i in range(n_rows):
            ry0 = int(ty + i * row_h)
            ry1 = int(ty + (i + 1) * row_h)
            row_crop = aligned_gray[ry0:ry1, tx:tx + tw]
            if row_crop.size == 0 or not has_ink(row_crop, min_ink_ratio=0.006):
                continue  # ligne vide du tableau -> on l'ignore, ce n'est pas un echec

            cells: Dict[str, str] = {}
            cell_confs: Dict[str, float] = {}
            for col in zone.get("columns", []):
                cx0, cy0, cx1, cy1 = col["bbox"]
                cbbox = (int(tx + cx0 * tw), ry0, int((cx1 - cx0) * tw), ry1 - ry0)

                o = ocr_zone(aligned_gray, cbbox, engine=engine, multiline=False)
                text = clean_field_text(o.text).replace("\n", " ").strip()
                conf = float(o.mean_confidence)

                # Deuxieme avis Tesseract (gratuit) si la cellule est vide ou peu sure
                if STRONG_MODE.enabled and STRONG_MODE.use_tesseract_second_opinion and \
                        (not text or conf < OCR.min_confidence_review):
                    o2 = ocr_zone(aligned_gray, cbbox, engine=self._tesseract, multiline=False)
                    text2 = clean_field_text(o2.text).replace("\n", " ").strip()
                    if text2 and (not text or o2.mean_confidence > conf):
                        text, conf = text2, float(o2.mean_confidence)

                cells[col["name"]] = text
                cell_confs[col["name"]] = round(conf, 1)

            price_raw = cells.get("price", "")
            rows.append(MaterialRow(
                qty=cells.get("qty") or None,
                designation=cells.get("designation") or None,
                reference=cells.get("reference") or None,
                price=normalize_amount(price_raw),
                price_raw=price_raw or None,
            ))
            logger.info(f"[TABLE] row {i}: {cells} confs={cell_confs}")

        return rows

    def extract(self, aligned_gray):
        h, w = aligned_gray.shape[:2]
        res = ExtractionResult()

        for zone in self.template["zones"]:
            field = zone["field"]
            if zone["type"] == "table":
                res.material_sold = self._extract_table(aligned_gray, zone, w, h)
                continue

            engine = self._engine_for_zone(zone)
            bbox0 = self._bbox_px(zone["bbox"], w, h)
            multiline = zone.get("multiline", False)

            x, y, bw, bh = bbox0
            crop = aligned_gray[y:y+bh, x:x+bw]
            ink = compute_ink_ratio(crop) if crop.size else 0.0

            candidates = []
            candidates.append((*self._run_ocr(aligned_gray, bbox0, engine, multiline, field), bbox0))

            # multi-pass fallback (STRONG)
            if STRONG_MODE.enabled and field in CRITICAL_FIELDS:
                for s in STRONG_MODE.fallback_expand_steps[:STRONG_MODE.critical_fallback_passes]:
                    b = self._expand_bbox(bbox0, w, h, s=s)
                    candidates.append((*self._run_ocr(aligned_gray, b, engine, multiline, field), b))

                # second opinion tesseract
                if STRONG_MODE.use_tesseract_second_opinion:
                    for s in (0.0, 0.22):
                        b = bbox0 if s == 0 else self._expand_bbox(bbox0, w, h, s=s)
                        candidates.append((*self._run_ocr(aligned_gray, b, self._tesseract, multiline, field), b))

            best = max(candidates, key=lambda c: self._score_candidate(field, c[1], c[2]))
            raw, val, conf, eng, bbox = best

            if STRONG_MODE.enabled and field in CRITICAL_FIELDS and _invalid_critical(field, val):
                conf = min(conf, STRONG_MODE.confidence_cap_if_invalid)

            needs_review = (conf < OCR.min_confidence_review) or _is_missing(val)

            res.fields[field] = FieldValue(
                raw_text=raw, value=val, confidence=conf, needs_review=needs_review,
                engine=eng, ink_ratio=round(ink, 4), bbox_px=bbox
            )

            logger.info(f"[STRONG={STRONG_MODE.enabled}] {field} -> val={val} conf={conf} eng={eng} bbox={bbox}")

        return res