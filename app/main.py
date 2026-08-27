"""
Orchestrateur du pipeline complet d'IDP pour les fiches Sabena Technics
"Ordre Client / Customer Work Order".
"""
import argparse
import time
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional, Dict, Any

import cv2
import numpy as np

from app.analysis.document_analyzer import analyze
from app.classification.document_classifier import ClassificationResult, DocumentClassifier
from app.extraction.information_extractor import ExtractionResult, FieldValue, InformationExtractor
from app.extraction.llm_validator import validate_with_llm, LLMValidationReport
from app.extraction.validators import ValidationIssue, validate
from app.ocr.ocr_engine import TesseractEngine, full_page_ocr
from app.preprocessing.document_detector import detect_document
from app.preprocessing.image_preprocessor import PreprocessResult, preprocess
from app.preprocessing.template_alignment import align_to_template
from app.preprocessing.template_matcher import match_template, TemplateMatchResult
from app.utils.io_utils import load_image, pdf_to_images, save_json
from app.utils.logger import get_logger
from configs.config import OUTPUT_DIR, TEMPLATES_DIR, VISION, CONFIDENCE_WEIGHTS

logger = get_logger(__name__)


MIN_AUTO_ACCEPT_CONFIDENCE = 0.72  # en dessous -> requires_review = True


def _compute_review_flag(extraction: ExtractionResult, issues: List[ValidationIssue],
                          llm_val: LLMValidationReport, global_score: float,
                          document_detected: bool, template_matched: bool) -> Dict[str, Any]:
    """Decide honnetement si ce document peut etre accepte tel quel, plutot
    que de laisser un score noye dans le JSON. C'est ce flag que Streamlit
    et l'export doivent afficher en premier."""
    reasons: List[str] = []

    if not document_detected:
        reasons.append("Document non detecte correctement dans l'image")
    if not template_matched:
        reasons.append("Le formulaire ne correspond pas au template de reference")
    errors = [i for i in issues if i.level == "error"]
    if errors:
        reasons.append(f"{len(errors)} champ(s) obligatoire(s) manquant(s) ou invalide(s)")
    fields_needing_review = [n for n, fv in extraction.fields.items() if fv.needs_review]
    if fields_needing_review:
        reasons.append(f"Confiance faible sur : {', '.join(fields_needing_review)}")
    if llm_val.used_llm and llm_val.issues:
        reasons.extend(llm_val.issues)
    if global_score < MIN_AUTO_ACCEPT_CONFIDENCE:
        reasons.append(f"Score de confiance global trop bas ({global_score:.2f} < {MIN_AUTO_ACCEPT_CONFIDENCE})")

    return {"requires_review": bool(reasons), "review_reasons": reasons}


class PipelineResult:
    def __init__(
        self,
        preprocess_result: PreprocessResult,
        classification: ClassificationResult,
        extraction: ExtractionResult,
        issues: List[ValidationIssue],
        processing_time_s: float,
        aligned: bool,
        document_detected: bool,
        document_detection_confidence: float,
        template_match: TemplateMatchResult,
        llm_validation: LLMValidationReport,
        confidence_components: Dict[str, float],
        requires_review: bool = True,
        review_reasons: Optional[List[str]] = None,
        engine_used: str = "local_ocr",
    ):
        self.preprocess_result = preprocess_result
        self.classification = classification
        self.extraction = extraction
        self.issues = issues
        self.processing_time_s = processing_time_s
        self.aligned = aligned
        self.document_detected = document_detected
        self.document_detection_confidence = document_detection_confidence
        self.template_match = template_match
        self.llm_validation = llm_validation
        self.confidence_components = confidence_components
        self.global_confidence_score = confidence_components.get("global", 0.0)
        self.requires_review = requires_review
        self.review_reasons = review_reasons or []
        self.engine_used = engine_used

    def to_dict(self) -> dict:
        return {
            "engine_used": self.engine_used,
            "requires_review": self.requires_review,
            "review_reasons": self.review_reasons,
            "document_type": self.classification.document_type,
            "classification_score": self.classification.match_score,
            "document_detected": self.document_detected,
            "document_detection_confidence": self.document_detection_confidence,
            "template_aligned": self.aligned,
            "template_matched": self.template_match.matched,
            "template_match_score": self.template_match.score,
            "deskew_angle": self.preprocess_result.deskew_angle,
            "extraction": self.extraction.to_dict(),
            "validation_issues": [asdict(i) for i in self.issues],
            "llm_validation": asdict(self.llm_validation),
            "confidence_components": self.confidence_components,
            "global_confidence_score": self.global_confidence_score,
            "processing_time_s": round(self.processing_time_s, 3),
        }


def _load_reference_template(template_path: Optional[Path]) -> Optional[np.ndarray]:
    if template_path is None:
        default = TEMPLATES_DIR / "reference_form.png"
        if default.exists():
            return cv2.imread(str(default), cv2.IMREAD_GRAYSCALE)
        return None
    return cv2.imread(str(template_path), cv2.IMREAD_GRAYSCALE)


def _compute_confidence(extraction: ExtractionResult, template_score: float,
                        issues: List[ValidationIssue], llm_val: LLMValidationReport) -> Dict[str, float]:
    ocr_scores = [fv.confidence / 100.0 for fv in extraction.fields.values()] or [0.0]
    ocr_component = sum(ocr_scores) / len(ocr_scores)

    errors = len([i for i in issues if i.level == "error"])
    warnings = len([i for i in issues if i.level == "warning"])
    rules_component = max(0.0, 1.0 - (errors * 0.25 + warnings * 0.05))
    # Les incoherences remontees par la validation LLM (quand elle a reellement
    # tourne) penalisent aussi la composante "rules" : elle attrape des erreurs
    # de contenu qu'aucune regle de format ne peut voir.
    if llm_val.used_llm:
        rules_component = max(0.0, rules_component - 0.1 * len(llm_val.issues))

    w = CONFIDENCE_WEIGHTS
    if llm_val.used_llm:
        llm_component = llm_val.confidence_score
        global_score = (
            w.ocr * ocr_component
            + w.template * template_score
            + w.rules * rules_component
            + w.llm * llm_component
        )
    else:
        # Pas de verification LLM reelle effectuee (pas de cle API, appel
        # echoue, ou desactivee) -> on ne simule PAS un score neutre a la
        # place : on redistribue son poids sur les composantes reelles au
        # lieu de fabriquer un chiffre qui n'a rien verifie.
        llm_component = None
        total_w = w.ocr + w.template + w.rules
        global_score = (
            w.ocr * ocr_component + w.template * template_score + w.rules * rules_component
        ) / total_w

    return {
        "ocr": round(ocr_component, 3),
        "template": round(template_score, 3),
        "rules": round(rules_component, 3),
        "llm": round(llm_component, 3) if llm_component is not None else None,
        "llm_used": llm_val.used_llm,
        "global": round(global_score, 3),
    }


def _is_extraction_degenerate(extraction: ExtractionResult) -> bool:
    """Vrai si l'extraction est techniquement valide (pas d'exception) mais
    ne contient en pratique aucune valeur exploitable -- un echec silencieux
    qu'une exception ne capte pas. Protege contre n'importe quel provider de
    la chaine (pas seulement Ollama/petits modeles). Filtre aussi les
    placeholders recopies litteralement par un petit modele qui n'a pas
    compris qu'il fallait les remplacer (ex: "...", "<valeur>")."""
    def _is_placeholder(v) -> bool:
        s = str(v).strip().strip("<>")
        return s in ("", "...", "…", "null", "none", "valeur ou null", "texte lu ou null")

    filled = sum(1 for fv in extraction.fields.values() if fv.value and not _is_placeholder(fv.value))
    return filled == 0


def process_document(image: np.ndarray, reference_template: Optional[np.ndarray] = None,
                     use_vision_llm: Optional[bool] = None) -> PipelineResult:
    start = time.time()
    use_vision_llm = VISION.enabled if use_vision_llm is None else use_vision_llm
    fallback_reason: Optional[str] = None

    _VISION_EXTRACTORS = {
        "gemini": lambda: __import__(
            "app.extraction.gemini_vision_extractor", fromlist=["GeminiVisionExtractor"]
        ).GeminiVisionExtractor(),
        "claude": lambda: __import__(
            "app.extraction.vision_llm_extractor", fromlist=["VisionLLMExtractor"]
        ).VisionLLMExtractor(),
        "ollama": lambda: __import__(
            "app.extraction.ollama_vision_extractor", fromlist=["OllamaVisionExtractor"]
        ).OllamaVisionExtractor(),
    }

    # Option conservée : extraction vision full doc. On tente VISION.provider en
    # premier (le plus precis, ex. Gemini), puis chaque provider de
    # VISION.fallback_chain dans l'ordre (ex. Ollama, local et hors-ligne), et
    # seulement si TOUS echouent (pas d'internet, quota depasse, Ollama pas
    # lance, etc.) on se rabat sur le pipeline 100% local OCR par zones
    # (TrOCR/Tesseract) en tout dernier recours -- le document est toujours
    # traite, jamais d'echec sec cote utilisateur. engine_used + review_reasons
    # indiquent honnetement quel palier a reellement servi.
    if use_vision_llm:
        attempted: List[str] = []
        providers_to_try = [VISION.provider] + [p for p in VISION.fallback_chain if p != VISION.provider]

        for provider_name in providers_to_try:
            extractor_factory = _VISION_EXTRACTORS.get(provider_name)
            if extractor_factory is None:
                continue
            attempted.append(provider_name)
            try:
                pre = preprocess(image)
                detector = detect_document(image)
                extractor = extractor_factory()
                extraction = extractor.extract(detector.image)
                if _is_extraction_degenerate(extraction):
                    raise ValueError(
                        f"Extraction via {provider_name} vide (0 champ rempli) -- traite comme un echec"
                    )
                issues = validate(extraction)
                llm_val = validate_with_llm(extraction)
                template_match_res = TemplateMatchResult(matched=True, score=0.5, method="not_used_vision_mode")

                order_number_ok = bool(extraction.fields.get("order_number", FieldValue("", None, 0, True)).value)
                classification = ClassificationResult(
                    document_type=extraction.document_type if order_number_ok else "unknown",
                    is_expected_type=order_number_ok,
                    match_score=1.0 if order_number_ok else 0.0,
                    matched_keywords=[],
                )

                conf = _compute_confidence(extraction, template_match_res.score, issues, llm_val)
                review = _compute_review_flag(extraction, issues, llm_val, conf["global"],
                                               detector.detected, template_match_res.matched)
                if len(attempted) > 1:
                    # On a reussi, mais pas au premier essai -> le signaler quand
                    # meme (utile a savoir meme si le resultat final est bon)
                    note = f"Mode degrade : {attempted[0]} indisponible, extraction via {provider_name} utilisee"
                    review["requires_review"] = True
                    review["review_reasons"] = [note] + review["review_reasons"]

                elapsed = time.time() - start
                return PipelineResult(
                    preprocess_result=pre,
                    classification=classification,
                    extraction=extraction,
                    issues=issues,
                    processing_time_s=elapsed,
                    aligned=True,
                    document_detected=detector.detected,
                    document_detection_confidence=detector.confidence,
                    template_match=template_match_res,
                    llm_validation=llm_val,
                    confidence_components=conf,
                    requires_review=review["requires_review"],
                    review_reasons=review["review_reasons"],
                    engine_used=provider_name,
                )
            except Exception as e:
                logger.warning(f"Extraction vision via {provider_name} echouee : {e}")
                continue

        # Tous les providers vision ont echoue -> dernier recours local
        logger.warning(
            f"Tous les providers vision ({', '.join(attempted)}) ont echoue, "
            f"bascule sur le pipeline local OCR par zones."
        )
        fallback_reason = (
            f"Mode fortement degrade : aucun provider vision disponible "
            f"({', '.join(attempted)}), pipeline 100% local utilise"
        )

    # Pipeline demandé
    # 1) preprocess
    pre = preprocess(image)

    # 2) document detection
    detector = detect_document(pre.preprocess_result.original if hasattr(pre, "preprocess_result") else image)

    # 3) alignment
    working_gray = pre.gray
    aligned = False
    if reference_template is not None:
        aligned_img = align_to_template(pre.gray, reference_template)
        if aligned_img is not None:
            working_gray = aligned_img
            aligned = True

    # 4) template matching
    template_match_res = match_template(working_gray, reference_template)

    # 5) extraction zone OCR
    extractor = InformationExtractor()
    extraction = extractor.extract(working_gray)

    # 6) validation règles
    issues = validate(extraction)

    # 7) validation LLM
    llm_val = validate_with_llm(extraction)

    # classification
    page_ocr = full_page_ocr(working_gray, engine=TesseractEngine())
    classifier = DocumentClassifier()
    classification = classifier.classify(page_ocr)

    # 8) confidence
    conf = _compute_confidence(extraction, template_match_res.score, issues, llm_val)
    review = _compute_review_flag(extraction, issues, llm_val, conf["global"],
                                   detector.detected, template_match_res.matched)
    if fallback_reason:
        review["requires_review"] = True
        review["review_reasons"] = [fallback_reason] + review["review_reasons"]

    elapsed = time.time() - start
    return PipelineResult(
        preprocess_result=pre,
        classification=classification,
        extraction=extraction,
        issues=issues,
        processing_time_s=elapsed,
        aligned=aligned,
        document_detected=detector.detected,
        document_detection_confidence=detector.confidence,
        template_match=template_match_res,
        llm_validation=llm_val,
        confidence_components=conf,
        requires_review=review["requires_review"],
        review_reasons=review["review_reasons"],
        engine_used="local_ocr_fallback" if fallback_reason else "local_ocr",
    )


def process_file(path: str, reference_template: Optional[np.ndarray] = None) -> List[PipelineResult]:
    suffix = Path(path).suffix.lower()
    images = pdf_to_images(path) if suffix == ".pdf" else [load_image(path)]
    return [process_document(img, reference_template) for img in images]


def main():
    parser = argparse.ArgumentParser(description="Pipeline IDP - Ordre Client Sabena Technics")
    parser.add_argument("--input", required=True, help="Chemin vers une image ou un PDF")
    parser.add_argument("--output", default=str(OUTPUT_DIR), help="Dossier de sortie JSON")
    parser.add_argument("--template", default=None, help="Image de reference pour l'alignement (optionnel)")
    args = parser.parse_args()

    ref = _load_reference_template(Path(args.template) if args.template else None)
    results = process_file(args.input, reference_template=ref)

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(args.input).stem

    all_dicts = []
    for i, res in enumerate(results):
        d = res.to_dict()
        all_dicts.append(d)
        save_json(d, str(out_dir / f"{stem}_page{i + 1}.json"))

    report = analyze([r.extraction for r in results])
    save_json(asdict(report), str(out_dir / f"{stem}_analysis.json"))

    print(f"\n{len(results)} page(s) traitee(s). Resultats dans {out_dir}")
    print(report.summary)


if __name__ == "__main__":
    main()