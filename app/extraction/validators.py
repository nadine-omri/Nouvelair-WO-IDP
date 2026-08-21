import re
from dataclasses import dataclass
from datetime import datetime
from typing import List

from app.extraction.information_extractor import ExtractionResult
from configs.config import VALIDATION


@dataclass
class ValidationIssue:
    field: str
    level: str  # error | warning
    message: str


def _valid_date(d: str) -> bool:
    try:
        datetime.strptime(d, "%d/%m/%Y")
        return True
    except Exception:
        return False


def validate(result: ExtractionResult) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []
    f = result.fields

    # requis selon tests actuels
    required = ["date", "ac_type", "ac_registration", "airline_customer"]
    for r in required:
        v = f.get(r)
        if not v or v.value is None or str(v.value).strip() == "":
            issues.append(ValidationIssue(r, "error", "Champ obligatoire manquant"))

    # date invalide => error
    v = f.get("date")
    if v and v.value is not None and str(v.value).strip() != "":
        if not _valid_date(str(v.value)):
            issues.append(ValidationIssue("date", "error", f"Date invalide: {v.value}"))

    # ac_type inattendu => warning
    v = f.get("ac_type")
    if v and v.value is not None and str(v.value).strip() != "":
        if str(v.value).upper() not in set(VALIDATION.valid_ac_types):
            issues.append(ValidationIssue("ac_type", "warning", f"Type avion inattendu: {v.value}"))

    # registration prefix inattendu => warning
    v = f.get("ac_registration")
    if v and v.value is not None and str(v.value).strip() != "":
        reg = str(v.value).upper().replace(" ", "")
        if not reg.startswith(VALIDATION.registration_prefix):
            issues.append(ValidationIssue("ac_registration", "warning", f"Préfixe immatriculation inattendu: {v.value}"))
        # format global (warning léger)
        elif not re.match(r"^TS-[A-Z0-9]{3,5}$", reg):
            issues.append(ValidationIssue("ac_registration", "warning", f"Format immatriculation à vérifier: {v.value}"))

    # MH (warning si incohérent)
    v = f.get("required_mh")
    if v and v.value is not None and str(v.value).strip() != "":
        try:
            mh = float(str(v.value).replace(",", "."))
            if mh <= 0 or mh > 200:
                issues.append(ValidationIssue("required_mh", "warning", f"MH hors plage: {mh}"))
        except Exception:
            issues.append(ValidationIssue("required_mh", "warning", f"MH non numérique: {v.value}"))

    return issues