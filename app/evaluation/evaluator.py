"""
Evaluation des performances du pipeline (§13 du cahier des charges).

Compare les resultats d'extraction a un jeu de documents annotes
manuellement (verite terrain) et calcule :
    - taux de champs correctement extraits (exact match, apres normalisation)
    - precision par champ
    - confiance moyenne
    - temps de traitement moyen
    - taux d'echec (document non classifie / erreur)

Format attendu du jeu de test : data/test_set/annotations.json
[
  {
    "image": "data/test_set/images/wo_005096.png",
    "ground_truth": {
        "order_number": "005096",
        "date": "17/07/2023",
        "ac_type": "A320",
        "ac_registration": "TS-INQ",
        "airline_customer": "Nouvelair",
        "required_mh": 52.0
    }
  },
  ...
]
"""
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

from app.main import process_document
from app.utils.io_utils import load_image, load_json
from app.utils.logger import get_logger
from configs.config import TEST_SET_DIR

logger = get_logger(__name__)


@dataclass
class FieldEvalStats:
    field: str
    n_total: int = 0
    n_correct: int = 0
    n_extracted: int = 0

    @property
    def accuracy(self) -> float:
        return round(self.n_correct / self.n_total, 3) if self.n_total else 0.0

    @property
    def extraction_rate(self) -> float:
        return round(self.n_extracted / self.n_total, 3) if self.n_total else 0.0


@dataclass
class EvaluationReport:
    n_documents: int
    n_failed: int
    failure_rate: float
    avg_processing_time_s: float
    avg_confidence: float
    field_stats: Dict[str, FieldEvalStats] = field(default_factory=dict)
    overall_field_accuracy: float = 0.0


def _values_match(predicted, expected) -> bool:
    if predicted is None or expected is None:
        return predicted == expected
    return str(predicted).strip().lower() == str(expected).strip().lower()


def evaluate(annotations_path: str = None) -> EvaluationReport:
    annotations_path = annotations_path or str(TEST_SET_DIR / "annotations.json")
    if not Path(annotations_path).exists():
        raise FileNotFoundError(
            f"Fichier d'annotations introuvable : {annotations_path}. "
            "Cree un jeu de test annote (voir docstring du module)."
        )
    annotations = load_json(annotations_path)

    field_stats: Dict[str, FieldEvalStats] = {}
    n_failed = 0
    times, confidences = [], []

    for entry in annotations:
        img_path = entry["image"]
        gt = entry["ground_truth"]

        try:
            image = load_image(img_path)
            start = time.time()
            result = process_document(image)
            elapsed = time.time() - start
            times.append(elapsed)

            if not result.classification.is_expected_type:
                n_failed += 1
                logger.warning(f"{img_path} : document non reconnu comme type attendu")

            doc_confidences = [fv.confidence for fv in result.extraction.fields.values() if fv.raw_text]
            if doc_confidences:
                confidences.append(sum(doc_confidences) / len(doc_confidences))

            for field_name, expected in gt.items():
                stats = field_stats.setdefault(field_name, FieldEvalStats(field=field_name))
                stats.n_total += 1
                fv = result.extraction.fields.get(field_name)
                predicted = fv.value if fv else None
                if predicted not in (None, ""):
                    stats.n_extracted += 1
                if _values_match(predicted, expected):
                    stats.n_correct += 1

        except Exception as e:
            n_failed += 1
            logger.error(f"Echec de traitement pour {img_path} : {e}")

    n_docs = len(annotations)
    all_correct = sum(s.n_correct for s in field_stats.values())
    all_total = sum(s.n_total for s in field_stats.values())

    report = EvaluationReport(
        n_documents=n_docs,
        n_failed=n_failed,
        failure_rate=round(n_failed / n_docs, 3) if n_docs else 0.0,
        avg_processing_time_s=round(sum(times) / len(times), 3) if times else 0.0,
        avg_confidence=round(sum(confidences) / len(confidences), 1) if confidences else 0.0,
        field_stats=field_stats,
        overall_field_accuracy=round(all_correct / all_total, 3) if all_total else 0.0,
    )
    return report


def print_report(report: EvaluationReport) -> None:
    print(f"\n=== Rapport d'evaluation ===")
    print(f"Documents evalues     : {report.n_documents}")
    print(f"Taux d'echec          : {report.failure_rate * 100:.1f}%")
    print(f"Temps moyen/document  : {report.avg_processing_time_s}s")
    print(f"Confiance OCR moyenne : {report.avg_confidence}%")
    print(f"Precision globale     : {report.overall_field_accuracy * 100:.1f}%")
    print("\nPar champ :")
    for name, s in report.field_stats.items():
        print(f"  - {name:20s} accuracy={s.accuracy * 100:5.1f}%  extraction_rate={s.extraction_rate * 100:5.1f}%  (n={s.n_total})")


if __name__ == "__main__":
    print_report(evaluate())
