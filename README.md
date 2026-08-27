# IDP — Ordre Client / Customer Work Order (Sabena Technics)

Système d'**Intelligent Document Processing** pour les fiches "Ordre Client /
Customer Work Order" de Sabena Technics (formulaire MRO Nouvelair) :

```
Document → Preprocessing → Classification → OCR par zone → Extraction →
Validation + confiance → Analyse → Résultats structurés → Export
```

Approche : le document est un **formulaire à mise en page fixe** rempli à la
main. Plutôt que du texte libre, le pipeline utilise une **extraction par
zones (ROI)** calibrées sur le gabarit du formulaire, alignées automatiquement
sur chaque nouveau scan via mise en correspondance de points d'intérêt (ORB +
homographie). C'est plus fiable que du parsing regex sur texte OCR brut pour
ce type de document (cf. §12 du cahier des charges : pas de complexité
inutile).

## 1. Installation

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows : .venv\Scripts\activate
pip install -r requirements.txt
```

Tesseract doit être installé sur le système, avec le pack de langue français :

```bash
# Ubuntu/Debian
sudo apt-get install tesseract-ocr tesseract-ocr-fra

# Windows : installeur https://github.com/UB-Mannheim/tesseract/wiki
# puis ajouter tesseract.exe au PATH, ou definir pytesseract.pytesseract.tesseract_cmd
```

## 2. Calibrer les zones sur VOS scans (étape indispensable)

Les coordonnées dans `configs/roi_template.json` sont des **estimations de
départ**, faites sans accès au scanner réel. Elles doivent être calibrées sur
un scan de référence bien droit avant toute utilisation en production :

```bash
streamlit run tools/calibrate_roi.py
```

1. Charger un scan de référence propre et bien cadré.
2. Ajuster chaque zone (sliders x0/y0/x1/y1) jusqu'à ce que le rectangle
   entoure précisément le champ voulu.
3. Cliquer **"Sauvegarder comme image de référence"** (utilisée pour
   l'alignement automatique des futurs scans) puis **"Exporter roi_template.json"**.

## 3. Lancer l'application

```bash
streamlit run streamlit_app.py
```

Pages : Aperçu → Preprocessing (avant/après) → OCR (texte + confiance par
champ) → Extraction (tableau structuré) → Validation (erreurs/avertissements)
→ Analyse (statistiques du lot) → Export (JSON / CSV / Excel).

## 4. Utilisation en ligne de commande

```bash
python -m app.main --input data/input/scan.jpg --output data/output/
python -m app.main --input data/input/scan.pdf --output data/output/   # PDF multi-pages
```

## 5. Évaluation des performances

```bash
python -m app.evaluation.evaluator
```

Complétez `data/test_set/annotations.json` avec vos propres documents annotés
(voir le format et les exemples dans le fichier). Le rapport donne : taux
d'échec, temps moyen de traitement, confiance OCR moyenne, précision et taux
d'extraction **par champ**.

## 6. Architecture

```
project/
├── app/
│   ├── main.py                      # orchestrateur du pipeline
│   ├── preprocessing/
│   │   ├── image_preprocessor.py    # grayscale, denoise, CLAHE, deskew, binarisation...
│   │   └── template_alignment.py    # alignement ORB sur le gabarit de référence
│   ├── ocr/
│   │   └── ocr_engine.py            # interface OCREngine (Tesseract, TrOCR pluggable)
│   ├── classification/
│   │   └── document_classifier.py   # reconnaissance du type de document (mots-clés)
│   ├── extraction/
│   │   ├── information_extractor.py # extraction par zone -> ExtractionResult structuré
│   │   └── validators.py            # règles de validation / cohérence
│   ├── postprocessing/
│   │   └── text_cleaner.py          # nettoyage texte, normalisation dates/montants/MH
│   ├── analysis/
│   │   └── document_analyzer.py     # statistiques, répartitions, anomalies
│   ├── evaluation/
│   │   └── evaluator.py             # accuracy/champ, taux d'échec, temps de traitement
│   └── utils/
│       ├── logger.py
│       └── io_utils.py
├── tools/
│   └── calibrate_roi.py             # calibration interactive des zones (Streamlit)
├── streamlit_app.py                 # interface principale
├── configs/
│   ├── config.py                    # configuration centralisée
│   └── roi_template.json            # coordonnées normalisées des zones du formulaire
├── data/
│   ├── input/ processed/ output/ templates/ test_set/
├── tests/                           # tests unitaires (pytest)
├── requirements.txt
└── README.md
```

## 7. Champs extraits

| Champ | Type | Normalisation |
|---|---|---|
| `order_number` | N° d'ordre | chiffres uniquement |
| `date` | date fiche | JJ/MM/AAAA |
| `lieu_place` | lieu | texte brut nettoyé |
| `ac_type` | type avion | texte brut (validé contre une liste de types connus) |
| `ac_registration` | immatriculation | `XX-XXX` |
| `airline_customer` | compagnie cliente | texte brut nettoyé |
| `required_mh` | temps forfaitaire M/H | nombre décimal |
| `work_required` | travaux demandés (multi-ligne) | texte brut nettoyé |
| `customer_rep_name` / `customer_rep_date` | représentant client | texte / date |
| `work_summary` | résumé travaux effectués | texte brut nettoyé |
| `material_sold` | tableau (qté, désignation, référence, prix) | prix normalisé en nombre |
| `observation` | remarques | texte brut nettoyé |
| `inspection_visa` | visa inspection | texte brut (souvent vide/tampon) |

Chaque champ porte : `raw_text`, `value` (normalisé), `confidence` (0-100),
`needs_review` (booléen, vrai si confiance faible ou valeur manquante).

## 8. Limites connues et pistes d'amélioration

- **Écriture manuscrite cursive** : Tesseract (moteur par défaut) est conçu
  pour du texte imprimé ; sur les champs manuscrits denses (ex. `travaux
  demandés`), la précision est faible. L'architecture est prête pour un
  moteur d'écriture manuscrite dédié (`app/ocr/ocr_engine.py::HandwritingEngine`,
  interface identique à Tesseract) — activer avec un modèle TrOCR français
  et `configs.config.OCR.use_handwriting_model = True`.
- **Alignement de template** : fonctionne bien sur des scans propres et
  droits ; sur des photocopies très dégradées (cf. exemples 2 et 8 fournis),
  le nombre de points d'intérêt fiables peut chuter sous le seuil
  (`MIN_GOOD_MATCHES` dans `template_alignment.py`) — dans ce cas le
  pipeline continue sans alignement et le signale (`aligned=False`).
- **Numéro d'ordre absent** : certaines fiches n'ont pas de N° imprimé
  (formulaire vierge) — le champ reste `None`, ce n'est pas un échec du
  pipeline.

## 9. Philosophie de conception

Pas de Machine Learning/Deep Learning ajouté "pour faire impressionnant" :
classification par mots-clés, extraction par zones + règles, normalisation
par expressions régulières. L'architecture isole cependant chaque étape
derrière une interface claire (`OCREngine`, `DocumentClassifier`) pour
permettre d'introduire un modèle plus avancé (classification de mise en page,
LLM d'extraction) sans réécrire le pipeline.
