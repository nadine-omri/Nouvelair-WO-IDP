"""
Reconnaissance du type de document.

Approche : regles/mots-cles sur le texte OCR de la page entiere. Suffisant et
plus fiable qu'un classifieur ML tant qu'un seul type de document est traite
(cf. §12 du cahier des charges : pas de ML gratuit). L'interface est isolee
dans sa propre classe pour pouvoir la remplacer plus tard par un classifieur
(ex. embeddings de mise en page + regression logistique) sans toucher au
reste du pipeline.
"""
import re
import unicodedata
from dataclasses import dataclass

from app.ocr.ocr_engine import OCRResult
from app.utils.logger import get_logger
from configs.config import CLASSIFICATION

logger = get_logger(__name__)


@dataclass
class ClassificationResult:
    document_type: str
    is_expected_type: bool
    match_score: float          # proportion de mots-cles trouves
    matched_keywords: list


def _normalize(text: str) -> str:
    text = text.lower()
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"\s+", " ", text)
    return text


class DocumentClassifier:
    def __init__(self, keywords=None, threshold: float = None):
        self.keywords = keywords or list(CLASSIFICATION.keywords)
        self.threshold = threshold if threshold is not None else CLASSIFICATION.keyword_match_threshold

    def classify(self, ocr_result: OCRResult) -> ClassificationResult:
        normalized = _normalize(ocr_result.text)
        matched = [kw for kw in self.keywords if _normalize(kw) in normalized]
        score = len(matched) / len(self.keywords) if self.keywords else 0.0
        is_expected = score >= self.threshold

        doc_type = CLASSIFICATION.expected_type if is_expected else "unknown"
        logger.info(
            f"Classification : {doc_type} (score={score:.2f}, mots-cles trouves={matched})"
        )
        return ClassificationResult(
            document_type=doc_type,
            is_expected_type=is_expected,
            match_score=round(score, 3),
            matched_keywords=matched,
        )
