"""Configuration centralisee du logging pour tout le projet."""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from configs.config import LOG_FILE, LOG_FORMAT, LOG_LEVEL

_configured = False


def get_logger(name: str) -> logging.Logger:
    """Retourne un logger configure (fichier + console), instancie une seule fois."""
    global _configured
    root = logging.getLogger()
    if not _configured:
        root.setLevel(LOG_LEVEL)
        formatter = logging.Formatter(LOG_FORMAT)

        file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        root.addHandler(console_handler)

        _configured = True

    return logging.getLogger(name)
