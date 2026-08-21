from app.main import _compute_confidence
from app.extraction.information_extractor import ExtractionResult, FieldValue

def test_confidence_score_range():
    r = ExtractionResult()
    r.fields["date"] = FieldValue("17/07/2023", "17/07/2023", 90.0, False)
    comp = _compute_confidence(r, template_score=0.8, issues=[], llm_score=0.7)
    assert 0.0 <= comp["global"] <= 1.0