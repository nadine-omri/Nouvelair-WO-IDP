from app.extraction.llm_validator import validate_with_llm
from app.extraction.information_extractor import ExtractionResult

def test_llm_validator_no_key_fallback(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = ExtractionResult()
    out = validate_with_llm(r)
    assert out.used_llm is False
    assert 0.0 <= out.confidence_score <= 1.0