import numpy as np
from app.preprocessing.document_detector import detect_document

def test_detect_document_returns_dataclass():
    img = np.full((600, 800, 3), 255, dtype=np.uint8)
    res = detect_document(img)
    assert hasattr(res, "detected")
    assert hasattr(res, "confidence")
    assert 0.0 <= res.confidence <= 1.0