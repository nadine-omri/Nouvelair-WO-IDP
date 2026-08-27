import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.classification.document_classifier import DocumentClassifier
from app.ocr.ocr_engine import OCRResult


def test_matching_document_classified_correctly():
    text = "sabena technics DIRECTION INDUSTRIELLE ET COMMERCIALE ORDRE CLIENT / CUSTOMER WORK ORDER MATERIEL VENDU"
    ocr = OCRResult(text=text, mean_confidence=90.0)
    result = DocumentClassifier().classify(ocr)
    assert result.is_expected_type
    assert result.document_type == "sabena_customer_work_order"


def test_unrelated_document_not_classified():
    text = "Facture Electricite STEG reference client montant a payer"
    ocr = OCRResult(text=text, mean_confidence=90.0)
    result = DocumentClassifier().classify(ocr)
    assert not result.is_expected_type
    assert result.document_type == "unknown"


def test_accent_and_case_insensitive_matching():
    text = "SABENA TECHNICS - Ordre Client / Customer Work Order - matériel vendu"
    ocr = OCRResult(text=text, mean_confidence=90.0)
    result = DocumentClassifier().classify(ocr)
    assert result.is_expected_type
