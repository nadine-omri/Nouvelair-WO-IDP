import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.postprocessing.text_cleaner import (
    clean_field_text, normalize_amount, normalize_date, normalize_mh,
    normalize_order_number, normalize_registration, strip_noise_chars,
)


def test_strip_noise_chars_collapses_spaces():
    assert strip_noise_chars("A320    A320") == "A320 A320"


def test_clean_field_text_removes_empty_lines():
    raw = "TS-INQ\n\n  \nA320"
    assert clean_field_text(raw) == "TS-INQ\nA320"


def test_normalize_date_standard_format():
    assert normalize_date("17/07/2023") == "17/07/2023"


def test_normalize_date_dot_separator():
    assert normalize_date("05.10.2023") == "05/10/2023"


def test_normalize_date_two_digit_year():
    assert normalize_date("14/03/23") == "14/03/2023"


def test_normalize_date_invalid_returns_none():
    assert normalize_date("not a date") is None


def test_normalize_date_month_day_swap():
    # jour/mois inverses par erreur -> 13 ne peut pas etre un mois, on corrige
    assert normalize_date("13/07/2023") == "13/07/2023"  # jour=13 valide, pas de swap


def test_normalize_amount_with_comma_decimal():
    assert normalize_amount("1354,293 TND") == 1354.293


def test_normalize_amount_with_euro_symbol():
    assert normalize_amount("480 €") == 480.0


def test_normalize_amount_empty():
    assert normalize_amount("") is None


def test_normalize_mh_extracts_number():
    assert normalize_mh("52 MH") == 52.0


def test_normalize_mh_none_when_no_digits():
    assert normalize_mh("MH") is None


def test_normalize_registration_adds_dash():
    assert normalize_registration("TS.INQ") == "TS-INQ"


def test_normalize_registration_lowercase():
    assert normalize_registration("ts-inq") == "TS-INQ"


def test_normalize_order_number_strips_letters():
    assert normalize_order_number("N° 005096") == "005096"


def test_normalize_order_number_empty_returns_none():
    assert normalize_order_number("") is None
