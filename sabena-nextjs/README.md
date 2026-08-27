# Sabena IDP — Interface Next.js

Nouvelle interface (Next.js 14 + TypeScript + Tailwind) pour le pipeline IDP
"Ordre Client Sabena Technics", en remplacement de `streamlit_app.py`.

Le pipeline Python (préprocessing, OCR, extraction, validation) **n'a pas été
réécrit** : il tourne exactement comme avant, exposé via un petit serveur
FastAPI (`api_server.py`, fourni dans le dossier du projet Python) que le
frontend Next.js appelle en HTTP.

## Démarrage

### 1. Backend Python (pipeline existant)

```bash
cd "sabena-version streamlit"
pip install -r requirements.txt
uvicorn api_server:app --reload --port 8000
```

### 2. Frontend Next.js

```bash
cd sabena-nextjs
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

Ouvre http://localhost:3000.

> Si le backend FastAPI n'est pas lancé, l'interface bascule automatiquement
> en **mode démo** (données simulées) pour rester utilisable et démontrable
> — un badge discret l'indique dans l'en-tête.

## Structure

```
app/                    routes Next.js (App Router)
src/components/         Sidebar, onglets, badges, barres de confiance
src/components/tabs/    Aperçu extraction / Correction manuelle / Matériaux & prix /
                         Export / Analyse / Recherche (base de données)
src/lib/types.ts        types miroir du schéma Python (PipelineResult, FieldValue,
                         WorkOrderRecord…)
src/lib/api.ts          appel HTTP vers le backend FastAPI (+ repli démo)
src/lib/validation.ts   portage exact des règles de validation manuelle
src/lib/mock.ts         générateur de données de démo (+ base de données simulée
                         en mémoire si le backend est indisponible)
```

## Base de données (nouveau)

Les ordres de travail corrigés peuvent être enregistrés dans une base SQLite
côté backend (`data/sabena_wo.db`, créée automatiquement) :

- **Onglet "Matériaux & prix"** : ajout/suppression/édition des lignes de
  matériaux vendus et de leur prix, pour le document actuellement sélectionné.
  Les changements sont pris en compte automatiquement dans l'export JSON et
  l'enregistrement en base.
- **Onglet "Export final"** : bouton "Enregistrer dans la base de données"
  qui sauvegarde Work Required, A/C Registration, MH Required, date, lieu et
  les matériaux vendus (`POST /api/work-orders`, puis `PUT` si déjà enregistré).
- **Onglet "Recherche (base de données)"** : recherche par date (début/fin),
  immatriculation ou texte libre parmi les WO déjà enregistrés
  (`GET /api/work-orders`), avec possibilité de modifier et ré-enregistrer
  les matériaux/prix directement depuis les résultats.

Côté backend, voir `db.py` (schéma + requêtes) et les endpoints ajoutés dans
`api_server.py` : `POST/GET/PUT/DELETE /api/work-orders`,
`PUT /api/work-orders/{id}/materials`.

## Design

Thème violet / blanc avec fond dégradé animé (orbes flottants doux), cartes
en verre dépoli (`glassmorphism`), micro-interactions (hover, transitions,
barres de confiance animées). Police display `Space Grotesk`, texte `Inter`,
valeurs techniques (immatriculations, dates, N° d'ordre) en `JetBrains Mono`
pour un rendu "instrument de bord" cohérent avec le contexte aéronautique.
