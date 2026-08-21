from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from configs.config import TEMPLATE_MATCHING


@dataclass
class TemplateMatchResult:
    matched: bool
    score: float
    method: str = "orb_inlier_ratio"


def _orb_match_score(image: np.ndarray, template: np.ndarray) -> float:
    orb = cv2.ORB_create(nfeatures=2500)
    kp1, des1 = orb.detectAndCompute(image, None)
    kp2, des2 = orb.detectAndCompute(template, None)
    if des1 is None or des2 is None:
        return 0.0

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    matches = bf.knnMatch(des1, des2, k=2)
    good = []
    for pair in matches:
        if len(pair) != 2:
            continue
        m, n = pair
        if m.distance < 0.75 * n.distance:
            good.append(m)

    if not good:
        return 0.0
    return min(1.0, len(good) / max(TEMPLATE_MATCHING.good_matches_norm, 1))


def match_template(image_gray: np.ndarray, template_gray: Optional[np.ndarray]) -> TemplateMatchResult:
    if template_gray is None:
        return TemplateMatchResult(matched=True, score=0.5, method="no_template_neutral")
    score = _orb_match_score(image_gray, template_gray)
    return TemplateMatchResult(matched=score >= TEMPLATE_MATCHING.match_threshold, score=round(score, 3))