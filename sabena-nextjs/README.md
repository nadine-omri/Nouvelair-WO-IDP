# Sabena IDP — Interface Next.js

Interface web (Next.js 14 + TypeScript + Tailwind) du pipeline IDP "Ordre
Client Sabena Technics".

> 📖 Vue d'ensemble complète du projet (architecture, backend Python,
> installation, variables d'environnement) : voir le
> [README à la racine du repo](../README.md).

## Démarrage rapide

```bash
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

Ouvre http://localhost:3000. Le backend FastAPI doit tourner sur le port
8000 (voir le README racine) — sinon l'interface bascule automatiquement en
**mode démo** (données simulées, badge discret dans l'en-tête).

## Structure

```
app/                    routes Next.js (App Router)
src/components/         Sidebar, en-tête, badges
src/components/tabs/    Un composant par onglet :
                         Dashboard, Données extraites, Correction manuelle,
                         Matériaux & prix, Export, Informations techniques,
                         Historique des WO (recherche), Analyse des prix (IA)
src/lib/types.ts        Types miroir du schéma Python (PipelineResult,
                         FieldValue, WorkOrderRecord, PriceAnalysis...)
src/lib/api.ts          Appels HTTP vers le backend FastAPI (+ repli démo)
src/lib/validation.ts   Portage exact des règles de validation manuelle
src/lib/mock.ts         Générateur de données de démo (+ base simulée en
                         mémoire si le backend est indisponible)
```

## Navigation

Le menu latéral (`Sidebar.tsx`) est organisé en deux groupes :

- **Vue d'ensemble** (accessible sans document chargé) : Dashboard,
  Historique des WO, Analyse des prix (IA)
- **Traitement du document** (nécessite un document sélectionné) : Données
  extraites, Correction, Matériaux & prix, Export, Informations techniques

## Design

Thème violet / blanc avec fond dégradé animé, cartes en verre dépoli
(`glassmorphism`), micro-interactions douces. Police display `Space
Grotesk`, texte `Inter`, valeurs techniques (immatriculations, dates, N°
d'ordre) en `JetBrains Mono`.
