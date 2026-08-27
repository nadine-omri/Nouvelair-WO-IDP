"""
Pipeline de pretraitement d'image pour les fiches Sabena Technics.

Philosophie : ne pas appliquer aveuglement tous les traitements. Chaque etape
est une fonction independante et testable ; `preprocess()` orchestre une
sequence raisonnable adaptee a des scans/photos de formulaires papier
remplis a la main, mais chaque etape peut etre utilisee separement ou
desactivee.
"""
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from app.utils.logger import get_logger
from configs.config import PREPROCESS

logger = get_logger(__name__)


@dataclass
class PreprocessResult:
    original: np.ndarray          # image d'entree (BGR), redimensionnee seulement
    gray: np.ndarray              # niveaux de gris, ameliore (pour OCR "printed"/zones)
    binary: np.ndarray            # binarise (pour zones tres degradees)
    deskew_angle: float           # angle de correction applique (degres)
    steps: dict                   # resultats intermediaires nommes (pour visualisation UI)


def resize_to_target_width(img: np.ndarray, target_width: int) -> np.ndarray:
    h, w = img.shape[:2]
    if w == target_width:
        return img
    scale = target_width / w
    new_size = (target_width, int(h * scale))
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(img, new_size, interpolation=interp)


def to_grayscale(img: np.ndarray) -> np.ndarray:
    if len(img.shape) == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def denoise(gray: np.ndarray, h: int = PREPROCESS.denoise_h) -> np.ndarray:
    """Debruitage non-local means : efficace sur le bruit de scan/photocopie
    sans trop lisser les traits fins de l'ecriture manuscrite."""
    return cv2.fastNlMeansDenoising(gray, None, h=h, templateWindowSize=7, searchWindowSize=21)


def enhance_contrast(gray: np.ndarray) -> np.ndarray:
    """CLAHE : ameliore le contraste local, utile pour les photocopies fanees
    (voir scans 2 et 8 de l'exemple, tres pales)."""
    clahe = cv2.createCLAHE(
        clipLimit=PREPROCESS.clahe_clip_limit, tileGridSize=PREPROCESS.clahe_tile_grid
    )
    return clahe.apply(gray)


def sharpen(gray: np.ndarray) -> np.ndarray:
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    return cv2.filter2D(gray, -1, kernel)


def estimate_skew_angle(gray: np.ndarray) -> float:
    """Estime l'angle d'inclinaison via les contours du texte/tableau (Hough)."""
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=200, minLineLength=200, maxLineGap=10)
    if lines is None:
        return 0.0
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if x2 == x1:
            continue
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(angle) < PREPROCESS.deskew_max_angle:
            angles.append(angle)
    if not angles:
        return 0.0
    return float(np.median(angles))


def deskew(gray: np.ndarray, angle: Optional[float] = None) -> tuple:
    if angle is None:
        angle = estimate_skew_angle(gray)
    if abs(angle) < 0.1:
        return gray, 0.0
    h, w = gray.shape
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(
        gray, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return rotated, angle


def adaptive_binarize(gray: np.ndarray) -> np.ndarray:
    block = PREPROCESS.adaptive_block_size
    if block % 2 == 0:
        block += 1
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY,
        block, PREPROCESS.adaptive_C,
    )


def crop_border_margin(img: np.ndarray, margin_pct: float = PREPROCESS.border_crop_margin_pct) -> np.ndarray:
    """Supprime une fine bande sur les bords, ou trainent souvent des artefacts
    de scan (bords noirs, ombres de reliure)."""
    h, w = img.shape[:2]
    my, mx = int(h * margin_pct), int(w * margin_pct)
    if my == 0 and mx == 0:
        return img
    return img[my:h - my, mx:w - mx]


def detect_and_correct_perspective(img: np.ndarray) -> np.ndarray:
    """Corrige la perspective si le document occupe un quadrilatere non
    rectangulaire dans l'image (photo prise en angle). Si aucun contour
    document plausible n'est trouve, l'image est retournee inchangee."""
    gray = to_grayscale(img)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return img

    largest = max(contours, key=cv2.contourArea)
    img_area = img.shape[0] * img.shape[1]
    if cv2.contourArea(largest) < 0.5 * img_area:
        # Le plus grand contour ne represente pas la feuille -> pas de correction
        return img

    peri = cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, 0.02 * peri, True)
    if len(approx) != 4:
        return img

    pts = approx.reshape(4, 2).astype("float32")
    rect = _order_points(pts)
    (tl, tr, br, bl) = rect
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = max(int(width_a), int(width_b))
    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = max(int(height_a), int(height_b))

    if max_width < 100 or max_height < 100:
        return img

    dst = np.array(
        [[0, 0], [max_width - 1, 0], [max_width - 1, max_height - 1], [0, max_height - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, matrix, (max_width, max_height))


def _order_points(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def preprocess(img: np.ndarray, correct_perspective: bool = False) -> PreprocessResult:
    """Pipeline complet et raisonnable pour une fiche Sabena scannee/photographiee.

    Sequence : (perspective optionnelle) -> resize -> grayscale -> denoise ->
    contraste -> deskew -> binarisation adaptative -> rognage des marges.

    `correct_perspective=True` seulement si le document est une photo (pas un
    scan a plat), car cette etape est couteuse et inutile sur un scan droit.
    """
    steps = {}
    work_img = img

    if correct_perspective:
        work_img = detect_and_correct_perspective(work_img)
        steps["perspective_corrected"] = work_img.copy()

    work_img = resize_to_target_width(work_img, PREPROCESS.target_dpi_width)
    steps["resized"] = work_img.copy()

    gray = to_grayscale(work_img)
    steps["grayscale"] = gray.copy()

    denoised = denoise(gray)
    steps["denoised"] = denoised.copy()

    contrasted = enhance_contrast(denoised)
    steps["contrast_enhanced"] = contrasted.copy()

    deskewed, angle = deskew(contrasted)
    steps["deskewed"] = deskewed.copy()
    logger.info(f"Angle de redressement applique : {angle:.2f} degres")

    sharpened = sharpen(deskewed)
    steps["sharpened"] = sharpened.copy()

    cropped_gray = crop_border_margin(sharpened)
    steps["cropped"] = cropped_gray.copy()

    binary = adaptive_binarize(cropped_gray)
    steps["binary"] = binary.copy()

    return PreprocessResult(
        original=work_img,
        gray=cropped_gray,
        binary=binary,
        deskew_angle=angle,
        steps=steps,
    )
# AJOUT dans preprocess(...) après denoise/clahe:
# (si tu as déjà une fonction preprocess, ajoute juste ce bloc)

from configs.config import STRONG_MODE
import cv2

def strong_boost(gray):
    # contraste + netteté doux
    g = cv2.GaussianBlur(gray, (0, 0), 1.2)
    sharp = cv2.addWeighted(gray, 1.6, g, -0.6, 0)
    return sharp

# dans preprocess(...):
# if STRONG_MODE.enabled and STRONG_MODE.denoise_boost:
#     gray = strong_boost(gray)