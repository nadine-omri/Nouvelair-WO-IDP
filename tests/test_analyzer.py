import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analysis.document_analyzer import analyze
from app.extraction.information_extractor import ExtractionResult, FieldValue, MaterialRow


def _make_result(date=None, ac_type=None, ac_reg=None, mh=None, order_number=None,
                  material=None, airline="Nouvelair"):
    r = ExtractionResult()
    def fv(v):
        return FieldValue(raw_text=str(v) if v is not None else "", value=v, confidence=90.0, needs_review=v is None)
    r.fields["date"] = fv(date)
    r.fields["ac_type"] = fv(ac_type)
    r.fields["ac_registration"] = fv(ac_reg)
    r.fields["required_mh"] = fv(mh)
    r.fields["order_number"] = fv(order_number)
    r.fields["airline_customer"] = fv(airline)
    r.material_sold = material or []
    return r


def test_analyze_empty_list():
    report = analyze([])
    assert report.n_documents == 0


def test_analyze_computes_ac_type_distribution():
    results = [
        _make_result(date="17/07/2023", ac_type="A320", ac_reg="TS-INQ", mh=52.0, order_number="1"),
        _make_result(date="05/10/2023", ac_type="A320", ac_reg="TS-INQ", mh=48.0, order_number="2"),
    ]
    report = analyze(results)
    assert report.ac_type_distribution == {"A320": 2}
    assert report.total_required_mh == 100.0
    assert report.average_required_mh == 50.0


def test_analyze_detects_duplicate_order_numbers():
    results = [
        _make_result(date="17/07/2023", ac_type="A320", ac_reg="TS-INQ", mh=52.0, order_number="005096"),
        _make_result(date="05/10/2023", ac_type="A320", ac_reg="TS-INQ", mh=48.0, order_number="005096"),
    ]
    report = analyze(results)
    assert any("double" in a.lower() for a in report.anomalies)


def test_analyze_material_value_sum():
    material = [
        MaterialRow(qty="1", designation="Piece A", reference="REF1", price=100.0, price_raw="100"),
        MaterialRow(qty="2", designation="Piece B", reference="REF2", price=50.0, price_raw="50"),
    ]
    results = [_make_result(date="17/07/2023", ac_type="A320", ac_reg="TS-INQ", mh=52.0,
                             order_number="1", material=material)]
    report = analyze(results)
    assert report.total_material_value == 150.0
    assert report.material_lines_count == 2


def test_analyze_flags_all_critical_fields_missing():
    results = [_make_result(airline=None)]  # tous les champs critiques vides
    report = analyze(results)
    assert len(report.anomalies) >= 1
