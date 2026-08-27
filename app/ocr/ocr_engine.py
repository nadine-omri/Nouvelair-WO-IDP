"""
Module OCR indépendant du reste du pipeline.

Moteurs disponibles :
    - TesseractEngine : texte imprimé / zones simples
    - HandwritingEngine : TrOCR français pour manuscrit

Le moteur OCR est isolé derrière OCREngine afin de pouvoir changer
de modèle sans modifier le reste du pipeline.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional

import cv2
import numpy as np
import pytesseract

from app.utils.logger import get_logger
from configs.config import OCR

logger = get_logger(__name__)


@dataclass
class OCRWord:
    text: str
    confidence: float
    bbox: tuple


@dataclass
class OCRResult:
    text: str
    mean_confidence: float
    words: List[OCRWord] = field(default_factory=list)
    engine: str = "tesseract"


class OCREngine(ABC):
    @abstractmethod
    def recognize(self, image: np.ndarray, multiline: bool = False) -> OCRResult:
        ...


class TesseractEngine(OCREngine):
    def __init__(self, lang: str = OCR.tesseract_lang):
        self.lang = lang

    def recognize(self, image: np.ndarray, multiline: bool = False) -> OCRResult:
        config = OCR.tesseract_config_printed if multiline else OCR.tesseract_config_single_line
        try:
            data = pytesseract.image_to_data(
                image, lang=self.lang, config=config, output_type=pytesseract.Output.DICT
            )
        except pytesseract.TesseractError as e:
            logger.warning(f"Erreur Tesseract : {e}")
            return OCRResult(text="", mean_confidence=0.0, words=[], engine="tesseract")

        words, confs, lines = [], [], {}
        for i, txt in enumerate(data["text"]):
            txt = txt.strip()
            conf = float(data["conf"][i])
            if not txt or conf < 0:
                continue
            bbox = (data["left"][i], data["top"][i], data["width"][i], data["height"][i])
            words.append(OCRWord(text=txt, confidence=conf, bbox=bbox))
            confs.append(conf)
            line_key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            lines.setdefault(line_key, []).append(txt)

        full_text = "\n".join(" ".join(tokens) for tokens in lines.values())
        mean_conf = float(np.mean(confs)) if confs else 0.0
        return OCRResult(text=full_text, mean_confidence=mean_conf, words=words, engine="tesseract")


def segment_text_lines(gray: np.ndarray, min_line_height: int = 10,
                       row_ink_threshold: float = 0.012) -> List[tuple]:
    h, w = gray.shape[:2]
    if h < min_line_height * 2:
        return [(0, h)]

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink_ratio = binary.sum(axis=1) / 255.0 / max(w, 1)

    is_text_row = ink_ratio > row_ink_threshold
    lines = []
    start = None
    for y, is_text in enumerate(is_text_row):
        if is_text and start is None:
            start = y
        elif not is_text and start is not None:
            if y - start >= min_line_height:
                lines.append((max(0, start - 4), min(h, y + 4)))
            start = None
    if start is not None and h - start >= min_line_height:
        lines.append((max(0, start - 4), h))

    return lines if lines else [(0, h)]


def compute_ink_ratio(gray: np.ndarray) -> float:
    if gray.size == 0:
        return 0.0
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return float(binary.sum()) / 255.0 / gray.size


def has_ink(gray, min_ink_ratio=0.004):
    return compute_ink_ratio(gray) > min_ink_ratio


class HandwritingEngine(OCREngine):
    def __init__(self, model_name: str = "agomberto/trocr-large-handwritten-fr",
                 base_processor_name: str = "microsoft/trocr-large-handwritten"):
        self.model_name = model_name
        self.base_processor_name = base_processor_name
        self._model = None
        self._processor = None
        self._tokenizer = None

    def _load_model(self):
        if self._model is not None:
            return
        from transformers import AutoImageProcessor, VisionEncoderDecoderModel, AutoTokenizer

        logger.info(f"Chargement du modele manuscrit : {self.model_name}")
        try:
            self._processor = AutoImageProcessor.from_pretrained(self.base_processor_name, use_fast=False)
        except TypeError:
            self._processor = AutoImageProcessor.from_pretrained(self.base_processor_name)

        try:
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        except Exception:
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name, use_fast=False)

        self._model = VisionEncoderDecoderModel.from_pretrained(self.model_name)
        self._model.eval()

    def _recognize_line(self, line_img: np.ndarray) -> Optional[OCRWord]:
        gray_line = line_img if line_img.ndim == 2 else cv2.cvtColor(line_img, cv2.COLOR_BGR2GRAY)
        ink = compute_ink_ratio(gray_line)
        if not has_ink(gray_line):
            logger.debug(f"TrOCR skip line (ink_ratio={ink:.4f})")
            return None

        import torch
        from PIL import Image

        pil_img = Image.fromarray(cv2.cvtColor(line_img, cv2.COLOR_GRAY2RGB) if line_img.ndim == 2 else line_img)
        pixel_values = self._processor(images=pil_img, return_tensors="pt").pixel_values
        with torch.no_grad():
            out = self._model.generate(
                pixel_values,
                output_scores=True,
                return_dict_in_generate=True,
                max_new_tokens=96,
                # Beam search au lieu du greedy decoding par defaut : le greedy
                # est tres sujet aux repetitions/derives sur ecriture manuscrite
                # bruitee (cf. sorties du type "mort requisent Sute demeure...").
                # Beam search + penalites reduit nettement ce phenomene, gratuitement
                # (meme modele, juste une strategie de decodage differente).
                num_beams=5,
                early_stopping=True,
                length_penalty=1.0,
                no_repeat_ngram_size=3,
                repetition_penalty=1.3,
            )
        text = self._tokenizer.batch_decode(out.sequences, skip_special_tokens=True)[0].strip()

        if out.scores:
            # Avec num_beams>1, `scores` correspond deja au faisceau retenu ;
            # on garde la meme logique de confiance moyenne.
            probs = [torch.softmax(step, dim=-1).max().item() for step in out.scores]
            confidence = float(np.mean(probs)) * 100.0
        else:
            confidence = 0.0

        return OCRWord(text=text, confidence=confidence, bbox=(0, 0, line_img.shape[1], line_img.shape[0]))

    def recognize(self, image: np.ndarray, multiline: bool = False) -> OCRResult:
        self._load_model()
        gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        ink = compute_ink_ratio(gray)
        if not has_ink(gray):
            logger.debug(f"TrOCR skip zone (ink_ratio={ink:.4f})")
            return OCRResult(text="", mean_confidence=0.0, words=[], engine="trocr-fr-handwritten")

        line_boxes = segment_text_lines(gray) if multiline else [(0, gray.shape[0])]

        words: List[OCRWord] = []
        for y0, y1 in line_boxes:
            line_img = image[y0:y1]
            if line_img.size == 0:
                continue
            word = self._recognize_line(line_img)
            if word is not None:
                words.append(word)

        words = [w for w in words if w.text]
        full_text = "\n".join(w.text for w in words)
        mean_conf = float(np.mean([w.confidence for w in words])) if words else 0.0
        return OCRResult(text=full_text, mean_confidence=mean_conf, words=words, engine="trocr-fr-handwritten")


def get_default_engine() -> OCREngine:
    if OCR.use_handwriting_model:
        try:
            model_name = getattr(OCR, "handwriting_model_name", "agomberto/trocr-large-handwritten-fr")
            return HandwritingEngine(model_name=model_name)
        except Exception as e:
            logger.warning(f"Impossible de charger le moteur manuscrit ({e}), repli sur Tesseract")
    return TesseractEngine()


def ocr_zone(image: np.ndarray, bbox_px: tuple, engine: Optional[OCREngine] = None,
             multiline: bool = False) -> OCRResult:
    engine = engine or get_default_engine()
    x, y, w, h = bbox_px
    x, y = max(0, x), max(0, y)
    crop = image[y:y + h, x:x + w]
    if crop.size == 0:
        return OCRResult(text="", mean_confidence=0.0, words=[])

    # Padding augmenté pour manuscrit
    padded = cv2.copyMakeBorder(crop, 25, 25, 25, 25, cv2.BORDER_CONSTANT, value=255)
    return engine.recognize(padded, multiline=multiline)


def full_page_ocr(image: np.ndarray, engine: Optional[OCREngine] = None) -> OCRResult:
    engine = engine or get_default_engine()
    return engine.recognize(image, multiline=True)