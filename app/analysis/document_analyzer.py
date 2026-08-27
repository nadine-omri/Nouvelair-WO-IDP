"""
Analyse post-extraction, adaptee au document "Ordre Client / Customer Work
Order" (§8 du cahier des charges).

Prend en entree une liste de resultats d'extraction (un ou plusieurs
documents traites) et calcule des indicateurs pertinents pour ce type de
document precis : repartition par avion/type, total heures M/H, valeur du
materiel vendu, detection d'anomalies (dates incoherentes, doublons de N°
d'ordre, MH hors norme...).
"""
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.extraction.information_extractor import ExtractionResult
from app.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class AnalysisReport:
    n_documents: int
    n_fields_extracted: int
    n_fields_missing: int
    extraction_rate: float                       # proportion de champs remplis
    date_range: Optional[Dict[str, str]]
    ac_type_distribution: Dict[str, int]
    ac_registration_distribution: Dict[str, int]
    total_required_mh: float
    average_required_mh: float
    total_material_value: float
    material_lines_count: int
    documents_with_material: int
    anomalies: List[str] = field(default_factory=list)
    summary: str = ""


def _try_parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%d/%m/%Y")
    except ValueError:
        return None


def analyze(results: List[ExtractionResult]) -> AnalysisReport:
    if not results:
        return AnalysisReport(
            n_documents=0, n_fields_extracted=0, n_fields_missing=0, extraction_rate=0.0,
            date_range=None, ac_type_distribution={}, ac_registration_distribution={},
            total_required_mh=0.0, average_required_mh=0.0, total_material_value=0.0,
            material_lines_count=0, documents_with_material=0, anomalies=[], summary="Aucun document.",
        )

    n_filled, n_missing = 0, 0
    ac_types, ac_regs = Counter(), Counter()
    dates = []
    mh_values = []
    material_total = 0.0
    material_lines = 0
    docs_with_material = 0
    order_numbers = []
    anomalies: List[str] = []

    for idx, res in enumerate(results):
        for name, fv in res.fields.items():
            if fv.value not in (None, ""):
                n_filled += 1
            else:
                n_missing += 1

        ac_type_fv = res.fields.get("ac_type")
        if ac_type_fv and ac_type_fv.value:
            ac_types[ac_type_fv.value.upper()] += 1

        reg_fv = res.fields.get("ac_registration")
        if reg_fv and reg_fv.value:
            ac_regs[reg_fv.value] += 1

        date_fv = res.fields.get("date")
        dt = _try_parse_date(date_fv.value if date_fv else None)
        if dt:
            dates.append(dt)

        mh_fv = res.fields.get("required_mh")
        if mh_fv and mh_fv.value is not None:
            mh_values.append(mh_fv.value)

        order_fv = res.fields.get("order_number")
        if order_fv and order_fv.value:
            order_numbers.append(order_fv.value)

        if res.material_sold:
            docs_with_material += 1
            material_lines += len(res.material_sold)
            for row in res.material_sold:
                if row.price:
                    material_total += row.price

        # Anomalie : document classifie mais champs critiques tous manquants
        critical = ["date", "ac_registration", "airline_customer"]
        if all((res.fields.get(c) is None or res.fields.get(c).value in (None, "")) for c in critical):
            anomalies.append(f"Document #{idx + 1} : tous les champs critiques sont vides (echec probable d'extraction)")

    # Doublons de numero d'ordre
    dup_orders = [num for num, count in Counter(order_numbers).items() if count > 1]
    for num in dup_orders:
        anomalies.append(f"Numero d'ordre en double : {num}")

    # Valeurs M/H aberrantes (au-dela de 3x la mediane)
    if mh_values:
        sorted_mh = sorted(mh_values)
        median_mh = sorted_mh[len(sorted_mh) // 2]
        for v in mh_values:
            if median_mh > 0 and v > 3 * median_mh:
                anomalies.append(f"Valeur M/H potentiellement aberrante : {v} (mediane={median_mh})")

    date_range = None
    if dates:
        date_range = {"min": min(dates).strftime("%d/%m/%Y"), "max": max(dates).strftime("%d/%m/%Y")}

    total_fields = n_filled + n_missing
    extraction_rate = round(n_filled / total_fields, 3) if total_fields else 0.0
    total_mh = round(sum(mh_values), 1)
    avg_mh = round(total_mh / len(mh_values), 1) if mh_values else 0.0

    summary_parts = [
        f"{len(results)} document(s) analyse(s).",
        f"Taux de champs extraits : {extraction_rate * 100:.1f}%.",
    ]
    if ac_types:
        top_ac = ac_types.most_common(1)[0]
        summary_parts.append(f"Type avion dominant : {top_ac[0]} ({top_ac[1]} document(s)).")
    if mh_values:
        summary_parts.append(f"Total M/H demande : {total_mh}h (moyenne {avg_mh}h/document).")
    if material_lines:
        summary_parts.append(f"{material_lines} ligne(s) de materiel vendu, valeur totale estimee {material_total:.2f}.")
    if anomalies:
        summary_parts.append(f"{len(anomalies)} anomalie(s) detectee(s).")

    report = AnalysisReport(
        n_documents=len(results),
        n_fields_extracted=n_filled,
        n_fields_missing=n_missing,
        extraction_rate=extraction_rate,
        date_range=date_range,
        ac_type_distribution=dict(ac_types),
        ac_registration_distribution=dict(ac_regs),
        total_required_mh=total_mh,
        average_required_mh=avg_mh,
        total_material_value=round(material_total, 2),
        material_lines_count=material_lines,
        documents_with_material=docs_with_material,
        anomalies=anomalies,
        summary=" ".join(summary_parts),
    )
    logger.info(f"Analyse terminee : {report.summary}")
    return report
