import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.extraction.information_extractor import ExtractionResult, FieldValue
from app.extraction.validators import validate


def _make_result(**field_values) -> ExtractionResult:
    result = ExtractionResult()
    for name, value in field_values.items():
        result.fields[name] = FieldValue(raw_text=str(value) if value is not None else "",
                                          value=value, confidence=90.0, needs_review=False)
    return result


def test_missing_required_field_flagged():
    result = _make_result(date="17/07/2023", ac_type="A320")  # manque registration, airline
    issues = validate(result)
    error_fields = {i.field for i in issues if i.level == "error"}
    assert "ac_registration" in error_fields
    assert "airline_customer" in error_fields


def test_valid_document_no_errors():
    result = _make_result(
        date="17/07/2023", ac_type="A320", ac_registration="TS-INQ", airline_customer="Nouvelair",
    )
    issues = validate(result)
    errors = [i for i in issues if i.level == "error"]
    assert errors == []


def test_unexpected_ac_type_warns():
    result = _make_result(
        date="17/07/2023", ac_type="B747", ac_registration="TS-INQ", airline_customer="Nouvelair",
    )
    issues = validate(result)
    assert any(i.field == "ac_type" and i.level == "warning" for i in issues)


def test_wrong_registration_prefix_warns():
    result = _make_result(
        date="17/07/2023", ac_type="A320", ac_registration="FR-ABC", airline_customer="Nouvelair",
    )
    issues = validate(result)
    assert any(i.field == "ac_registration" and i.level == "warning" for i in issues)


def test_invalid_date_format_errors():
    result = _make_result(
        date="not-a-date", ac_type="A320", ac_registration="TS-INQ", airline_customer="Nouvelair",
    )
    issues = validate(result)
    assert any(i.field == "date" and i.level == "error" for i in issues)


def test_suspicious_mh_warns():
    result = _make_result(
        date="17/07/2023", ac_type="A320", ac_registration="TS-INQ", airline_customer="Nouvelair",
        required_mh=5000.0,
    )
    issues = validate(result)
    assert any(i.field == "required_mh" for i in issues)
