from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

from app.preprocessing.image_preprocessor import detect_and_correct_perspective
from app.utils.logger import get_logger
from configs.config import DOC_DETECTION

logger = get_logger(__name__)


@dataclass
class DocumentDetectionResult:
    image: np.ndarray
    detected: bool
    confidence: float
    bbox: Optional[Tuple[int, int, int, int]] = None


def detect_document(image: np.ndarray) -> DocumentDetectionResult:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return DocumentDetectionResult(image=image, detected=False, confidence=0.0, bbox=None)

    largest = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(largest))
    img_area = float(image.shape[0] * image.shape[1])
    ratio = area / img_area if img_area else 0.0

    x, y, w, h = cv2.boundingRect(largest)
    detected = ratio >= DOC_DETECTION.min_area_ratio
    confidence = min(1.0, ratio / max(DOC_DETECTION.target_area_ratio, 1e-6))
    corrected = detect_and_correct_perspective(image) if DOC_DETECTION.correct_perspective else image

    logger.info(f"Document detection: detected={detected}, confidence={confidence:.3f}, ratio={ratio:.3f}")

    return DocumentDetectionResult(
        image=corrected,
        detected=detected,
        confidence=round(confidence, 3),
        bbox=(x, y, w, h),
    )