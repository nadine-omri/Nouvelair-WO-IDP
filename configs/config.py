"""
Configuration centrale du projet.

Toutes les valeurs "magiques" (chemins, seuils, options du pipeline) vivent ici
pour éviter de les disperser dans le code. Modifier ce fichier pour adapter le
comportement du pipeline sans toucher à la logique métier.
"""
from dataclasses import dataclass
from pathlib import Path

# Charge automatiquement les variables d'environnement depuis un fichier .env
# a la racine du projet (GEMINI_API_KEY, etc.) si python-dotenv est installe.
# Optionnel : si absent, les variables systeme classiques (set/export) marchent
# toujours normalement.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Chemins
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
INPUT_DIR = DATA_DIR / "input"
PROCESSED_DIR = DATA_DIR / "processed"
OUTPUT_DIR = DATA_DIR / "output"
TEMPLATES_DIR = DATA_DIR / "templates"
TEST_SET_DIR = DATA_DIR / "test_set"
LOG_DIR = BASE_DIR / "logs"

for d in (INPUT_DIR, PROCESSED_DIR, OUTPUT_DIR, TEMPLATES_DIR, TEST_SET_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------
@dataclass
class PreprocessConfig:
    target_dpi_width: int = 1700
    denoise_h: int = 7
    clahe_clip_limit: float = 2.0
    clahe_tile_grid: tuple = (8, 8)
    adaptive_block_size: int = 35
    adaptive_C: int = 15
    deskew_max_angle: float = 15.0
    border_crop_margin_pct: float = 0.01

# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------
@dataclass
class OCRConfig:
    tesseract_lang: str = "fra"
    tesseract_config_printed: str = "--oem 3 --psm 6"
    tesseract_config_single_line: str = "--oem 3 --psm 7"
    tesseract_config_sparse: str = "--oem 3 --psm 11"
    min_confidence_ok: float = 75.0
    min_confidence_review: float = 40.0

    # TrOCR FR
    use_handwriting_model: bool = True
    handwriting_model_name: str = "agomberto/trocr-large-handwritten-fr"
    force_trocr_all_zones: bool = False

# ---------------------------------------------------------------------------
# Classification de document
# ---------------------------------------------------------------------------
@dataclass
class ClassificationConfig:
    expected_type: str = "sabena_customer_work_order"
    keyword_match_threshold: float = 0.5
    keywords: tuple = (
        "sabena",
        "ordre client",
        "customer work order",
        "direction industrielle",
        "materiel vendu",
    )

# ---------------------------------------------------------------------------
# Extraction vision (LLM multimodal) - optionnelle
# ---------------------------------------------------------------------------
@dataclass
class VisionConfig:
    enabled: bool = True              # Gemini par defaut : le TrOCR local hallucine
                                       # du texte fluide mais hors-sujet sur ce type de
                                       # formulaire (modele entraine sur des archives
                                       # civiles du 19e siecle, cf. debug_pipeline.py STEP 5
                                       # vs STEP 6). Remets a False pour retester le
                                       # pipeline 100% local/hors-ligne si besoin.
    provider: str = "gemini"          # "gemini" (gratuit, cloud) / "claude" (payant) /
                                       # "ollama" (local, gratuit, hors-ligne, qualite moindre)
    model: str = "gemini-3.6-flash"   # modele Gemini (tier gratuit) -- verifie sur
                                       # https://ai.google.dev/gemini-api/docs/models si erreur 404 (Google renomme ses modeles assez souvent)
    claude_model: str = "claude-sonnet-5"
    max_tokens: int = 4096
    api_key_env: str = "GEMINI_API_KEY"          # cle gratuite: https://aistudio.google.com/apikey
    claude_api_key_env: str = "ANTHROPIC_API_KEY"
    fallback_chain: tuple = ("ollama",)  # essaye ces providers, dans l'ordre, avant de
                                          # se rabattre sur le pipeline 100% local (TrOCR/
                                          # Tesseract) en tout dernier recours. "provider"
                                          # ci-dessus est toujours tente en premier.


@dataclass
class OllamaVisionConfig:
    model: str = "moondream:1.8b"  # qwen2.5vl:3b demande ~10 Go de RAM (trop pour
                                    # une machine a 8 Go) -- moondream est plus leger
                                    # mais moins bon sur les tableaux/texte dense.
                                    # Si tu as plus de RAM dispo un jour : "qwen2.5vl:3b"
    host: str = "http://localhost:11434"

# ---------------------------------------------------------------------------
# Validation métier
# ---------------------------------------------------------------------------
@dataclass
class ValidationConfig:
    valid_ac_types: tuple = ("A320", "A319", "A321", "A330", "A340", "B737", "B738")
    registration_prefix: str = "TS-"
    min_year: int = 2000
    max_year_ahead: int = 1

# ---------------------------------------------------------------------------
# Document detection
# ---------------------------------------------------------------------------
@dataclass
class DocumentDetectionConfig:
    min_area_ratio: float = 0.45
    target_area_ratio: float = 0.75
    correct_perspective: bool = True

# ---------------------------------------------------------------------------
# Template matching
# ---------------------------------------------------------------------------
@dataclass
class TemplateMatchingConfig:
    match_threshold: float = 0.25
    good_matches_norm: int = 60

# ---------------------------------------------------------------------------
# LLM validation
# ---------------------------------------------------------------------------
@dataclass
class LLMValidationConfig:
    enabled: bool = True
    model: str = "gemini-3.6-flash"
    api_key_env: str = "GEMINI_API_KEY"

# ---------------------------------------------------------------------------
# Confidence score weights
# ---------------------------------------------------------------------------
@dataclass
class ConfidenceWeightsConfig:
    ocr: float = 0.4
    template: float = 0.2
    rules: float = 0.2
    llm: float = 0.2

# ---------------------------------------------------------------------------
# Rapport IA - analyse des prix (app/analysis/price_analyzer.py)
# ---------------------------------------------------------------------------
@dataclass
class PriceAnalysisLLMConfig:
    provider: str = "huggingface"     # "huggingface" (cloud, cle gratuite) puis repli
                                       # automatique sur "ollama" (local) si indisponible,
                                       # puis repli final sur un resume par template.
    model: str = "meta-llama/Llama-3.1-8B-Instruct"  # modele HF Inference (texte seul)
    api_key_env: str = "HF_TOKEN"     # cle gratuite: https://huggingface.co/settings/tokens
    max_tokens: int = 700
    ollama_model: str = "llama3.2"    # utilise avec OLLAMA_VISION.host en repli local

# ---------------------------------------------------------------------------
# Rapport IA - analyse par document (app/analysis/document_report.py)
# ---------------------------------------------------------------------------
@dataclass
class DocumentReportLLMConfig:
    provider: str = "huggingface"     # meme chaine de repli que PriceAnalysisLLMConfig
    model: str = "meta-llama/Llama-3.1-8B-Instruct"
    api_key_env: str = "HF_TOKEN"     # cle gratuite: https://huggingface.co/settings/tokens
    max_tokens: int = 500
    ollama_model: str = "llama3.2"

PREPROCESS = PreprocessConfig()
OCR = OCRConfig()
CLASSIFICATION = ClassificationConfig()
VALIDATION = ValidationConfig()
VISION = VisionConfig()
OLLAMA_VISION = OllamaVisionConfig()

DOC_DETECTION = DocumentDetectionConfig()
TEMPLATE_MATCHING = TemplateMatchingConfig()
LLM_VALIDATION = LLMValidationConfig()
CONFIDENCE_WEIGHTS = ConfidenceWeightsConfig()
PRICE_ANALYSIS_LLM = PriceAnalysisLLMConfig()
DOCUMENT_REPORT_LLM = DocumentReportLLMConfig()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_FILE = LOG_DIR / "pipeline.log"
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"

# AJOUTER ces dataclasses + instances (sans casser l'existant)

from dataclasses import dataclass

@dataclass
class StrongModeConfig:
    enabled: bool = True
    force_trocr_all_zones: bool = True
    critical_fallback_passes: int = 3      # nb d'essais OCR sur bbox élargies
    fallback_expand_steps: tuple = (0.15, 0.28, 0.40)
    confidence_cap_if_invalid: float = 25.0
    use_tesseract_second_opinion: bool = True
    denoise_boost: bool = True             # preprocess plus agressif


STRONG_MODE = StrongModeConfig()