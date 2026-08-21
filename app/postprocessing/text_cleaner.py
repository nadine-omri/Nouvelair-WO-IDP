import re
from datetime import datetime
from typing import Optional


def strip_noise_chars(text: str) -> str:
    if text is None:
        return ""
    # on garde les retours ligne (important pour tests)
    t = text.replace("\r", "\n")
    # caractères autorisés, sans supprimer \n
    t = re.sub(r"[^0-9A-Za-zÀ-ÖØ-öø-ÿ\s/\-:.,'\n]", " ", t)
    # normaliser espaces horizontaux uniquement
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip()


def clean_field_text(text: str) -> str:
    """
    Supprime les lignes vides, conserve les lignes non vides séparées par '\n'.
    """
    t = strip_noise_chars(text)
    if not t:
        return ""
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n")]
    lines = [ln for ln in lines if ln]  # retire lignes vides
    return "\n".join(lines)


def normalize_order_number(text: str) -> Optional[str]:
    t = clean_field_text(text).replace("\n", " ")
    if not t:
        return None
    m = re.search(r"\b(\d{3,6})\b", t)
    if not m:
        return None
    raw = m.group(1)
    return raw.zfill(6) if len(raw) <= 6 else raw


def normalize_date(text: str) -> Optional[str]:
    t = clean_field_text(text).upper().replace("\n", " ")
    if not t:
        return None

    t = t.replace("O", "0").replace("I", "1").replace("L", "1")
    t = t.replace(".", "/").replace("-", "/").replace("\\", "/")
    t = re.sub(r"[^0-9/]", "", t)

    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", t)
    if not m:
        return None

    d, mo, y = m.groups()
    d, mo, y = int(d), int(mo), int(y)
    if y < 100:
        y += 2000

    try:
        return datetime(y, mo, d).strftime("%d/%m/%Y")
    except Exception:
        return None


def normalize_registration(text: str) -> Optional[str]:
    t = clean_field_text(text).upper().replace("\n", " ")
    if not t:
        return None

    t = t.replace(" ", "").replace("_", "-")
    t = t.replace("TS/", "TS-").replace("TS:", "TS-").replace("TS.", "TS-")
    t = t.replace("T5-", "TS-").replace("75-", "TS-")
    t = re.sub(r"[^A-Z0-9-]", "", t)

    m = re.search(r"(TS-[A-Z0-9]{3,5})", t)
    if not m:
        return None

    reg = m.group(1)
    prefix, suffix = reg[:3], reg[3:]
    suffix = suffix.replace("1", "I").replace("5", "S")
    return prefix + suffix


def normalize_ac_type(text: str) -> Optional[str]:
    t = clean_field_text(text).upper().replace("\n", " ")
    if not t:
        return None
    t = t.replace(" ", "").replace("-", "")

    allowed = {"A319", "A320", "A321", "A330", "A340", "B737", "B738"}
    for a in allowed:
        if a in t:
            return a
    return None


def normalize_mh(text: str) -> Optional[float]:
    """
    Les tests attendent qu'on puisse extraire 52.0 depuis '52 MH'.
    Donc pas de borne bloquante ici (la validation métier fera les bornes).
    """
    t = clean_field_text(text).upper().replace("\n", " ")
    if not t:
        return None
    t = t.replace(",", ".").replace("MH", "").replace("M H", "")
    m = re.search(r"\d+(?:\.\d+)?", t)
    return float(m.group(0)) if m else None


def normalize_amount(text: str) -> Optional[float]:
    t = clean_field_text(text).replace("\n", " ").replace(",", ".")
    m = re.search(r"\d+(?:\.\d+)?", t)
    return float(m.group(0)) if m else None