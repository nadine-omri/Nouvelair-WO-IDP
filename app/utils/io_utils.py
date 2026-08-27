"""Utilitaires d'entree/sortie : chargement d'images/PDF, sauvegarde JSON."""
import json
from pathlib import Path
from typing import List

import cv2
import numpy as np

from app.utils.logger import get_logger

logger = get_logger(__name__)


def load_image(path: str) -> np.ndarray:
    """Charge une image (jpg/png/...) en array BGR (OpenCV)."""
    img = cv2.imread(str(path))
    if img is None:
        raise ValueError(f"Impossible de charger l'image : {path}")
    return img


def pdf_to_images(pdf_path: str, dpi: int = 300) -> List[np.ndarray]:
    """Convertit chaque page d'un PDF (scan) en image BGR OpenCV.

    Necessite PyMuPDF (fitz). Import differe pour ne pas rendre le module
    obligatoire si l'utilisateur ne travaille qu'avec des images.
    """
    import fitz  # PyMuPDF

    images = []
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    with fitz.open(pdf_path) as doc:
        for page_index, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix)
            img_array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            if pix.n == 4:
                img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
            else:
                img_bgr = cv2.cvtColor(img_array, cv2.COLOR_GRAY2BGR)
            images.append(img_bgr)
            logger.info(f"Page {page_index + 1} extraite de {pdf_path} ({img_bgr.shape})")
    return images


def save_json(data: dict, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)
    logger.info(f"JSON sauvegarde : {path}")


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
