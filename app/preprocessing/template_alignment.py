"""
Alignement d'un scan sur une image de reference (template) via mise en
correspondance de points d'interet ORB + homographie.

Necessaire car les zones (ROI) du formulaire sont definies une fois pour une
image de reference : chaque nouveau scan doit d'abord etre "recale" sur cette
reference pour que les coordonnees normalisees des zones restent valables,
meme si le scan est legerement decale, tourne ou d'une taille differente.
"""
from typing import Optional

import cv2
import numpy as np

from app.utils.logger import get_logger

logger = get_logger(__name__)

MIN_GOOD_MATCHES = 15


def align_to_template(image: np.ndarray, template: np.ndarray) -> Optional[np.ndarray]:
    """Recale `image` (niveaux de gris) sur `template` (niveaux de gris) et
    renvoie l'image alignee a la taille du template, ou None si
    l'alignement echoue (pas assez de correspondances fiables)."""
    orb = cv2.ORB_create(nfeatures=3000)
    kp1, des1 = orb.detectAndCompute(image, None)
    kp2, des2 = orb.detectAndCompute(template, None)

    if des1 is None or des2 is None:
        logger.warning("Pas assez de descripteurs pour l'alignement ORB")
        return None

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    matches = matcher.knnMatch(des1, des2, k=2)

    good = []
    for pair in matches:
        if len(pair) != 2:
            continue
        m, n = pair
        if m.distance < 0.75 * n.distance:
            good.append(m)

    if len(good) < MIN_GOOD_MATCHES:
        logger.warning(f"Alignement ORB : seulement {len(good)} bonnes correspondances (< {MIN_GOOD_MATCHES})")
        return None

    src_pts = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

    homography, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    if homography is None:
        logger.warning("Homographie non trouvee")
        return None

    h, w = template.shape[:2]
    aligned = cv2.warpPerspective(image, homography, (w, h))
    inliers = int(mask.sum()) if mask is not None else 0
    logger.info(f"Alignement ORB reussi : {inliers}/{len(good)} inliers")
    return aligned
