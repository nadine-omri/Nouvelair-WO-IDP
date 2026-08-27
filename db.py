"""
Base de données SQLite persistante pour l'historique des ordres de travail
(Work Orders) traités par le pipeline IDP.

Le fichier `data/sabena_wo.db` est écrit sur disque : toutes les données
restent disponibles après fermeture de l'application / redémarrage du
serveur (contrairement à la session navigateur, qui elle ne survit qu'à un
F5 grâce à `sabena-nextjs/src/lib/persistence.ts`).

Chaque page traitée (image seule, ou une page d'un PDF multi-scans) devient
une ligne `work_orders` distincte, automatiquement enregistrée dès la fin du
traitement par `/api/process` (voir api_server.py) — l'utilisateur n'a rien
à cliquer pour que ce soit sauvegardé. Les colonnes `source_file`,
`page_index`, `page_count` permettent de savoir de quel fichier / quelle
page un WO provient, et de regrouper les WO issus d'un même PDF multi-scans.

Sont aussi stockées, pour l'onglet "Informations techniques" :
- le moteur d'extraction utilisé (Gemini / Ollama / OCR local / repli),
- le détail des scores de confiance (OCR, template, règles, LLM, global),
- les métriques de classification / alignement de template / deskew,
- le rapport de validation LLM et les problèmes de validation,
- un instantané complet des champs extraits (valeur, texte brut, confiance,
  moteur par champ) au format JSON, pour ré-afficher les données extraites
  complètes même après fermeture de l'application.
"""
import json
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent / "data" / "sabena_wo.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_name TEXT,
    order_number TEXT,
    date TEXT,                 -- jj/mm/aaaa (tel que saisi/corrigé)
    lieu_place TEXT,
    ac_type TEXT,
    ac_registration TEXT,
    airline_customer TEXT,
    required_mh TEXT,
    customer_rep_name TEXT,
    customer_rep_date TEXT,
    work_required TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    qty TEXT,
    designation TEXT,
    reference TEXT,
    price REAL,
    price_raw TEXT
);

CREATE INDEX IF NOT EXISTS idx_wo_date ON work_orders(date);
CREATE INDEX IF NOT EXISTS idx_wo_registration ON work_orders(ac_registration);
CREATE INDEX IF NOT EXISTS idx_wo_order_number ON work_orders(order_number);
"""

# Colonnes additionnelles (migration additive, sûre à rejouer). Chaque
# élément : (nom_colonne, type_sql).
EXTRA_COLUMNS = [
    # Origine du document (identification / regroupement PDF multi-scans)
    ("source_file", "TEXT"),
    ("page_index", "INTEGER"),   # 1-based : n° de page dans le fichier source
    ("page_count", "INTEGER"),   # nombre total de pages dans le fichier source
    ("auto_saved", "INTEGER DEFAULT 1"),  # 1 = enregistré automatiquement au traitement
    # Informations techniques d'extraction
    ("engine_used", "TEXT"),
    ("requires_review", "INTEGER"),
    ("review_reasons", "TEXT"),           # JSON: string[]
    ("document_type", "TEXT"),
    ("classification_score", "REAL"),
    ("document_detected", "INTEGER"),
    ("document_detection_confidence", "REAL"),
    ("template_aligned", "INTEGER"),
    ("template_matched", "INTEGER"),
    ("template_match_score", "REAL"),
    ("deskew_angle", "REAL"),
    ("processing_time_s", "REAL"),
    ("confidence_ocr", "REAL"),
    ("confidence_template", "REAL"),
    ("confidence_rules", "REAL"),
    ("confidence_llm", "REAL"),
    ("confidence_llm_used", "INTEGER"),
    ("global_confidence_score", "REAL"),
    ("validation_issues", "TEXT"),        # JSON: ValidationIssue[]
    ("llm_validation", "TEXT"),           # JSON: {used_llm, confidence_score, issues}
    ("extraction_fields", "TEXT"),        # JSON: Record<field, FieldValue>
]

JSON_COLUMNS = {"review_reasons", "validation_issues", "llm_validation", "extraction_fields"}
BOOL_COLUMNS = {
    "requires_review", "document_detected", "template_aligned",
    "template_matched", "confidence_llm_used", "auto_saved",
}

WO_BUSINESS_FIELDS = [
    "document_name", "order_number", "date", "lieu_place", "ac_type",
    "ac_registration", "airline_customer", "required_mh",
    "customer_rep_name", "customer_rep_date", "work_required",
]

WO_TECHNICAL_FIELDS = [name for name, _ in EXTRA_COLUMNS]

ALL_INSERTABLE_FIELDS = WO_BUSINESS_FIELDS + WO_TECHNICAL_FIELDS


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(work_orders)")}
        for name, sql_type in EXTRA_COLUMNS:
            if name not in existing:
                conn.execute(f"ALTER TABLE work_orders ADD COLUMN {name} {sql_type}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_wo_source_file ON work_orders(source_file)")


def _fr_date_to_iso(d: Optional[str]) -> Optional[str]:
    """Convertit jj/mm/aaaa -> aaaa-mm-jj pour permettre le tri/recherche
    par date en SQL. Retourne None si le format est invalide."""
    if not d:
        return None
    parts = d.strip().split("/")
    if len(parts) != 3:
        return None
    dd, mm, yyyy = parts
    if not (dd.isdigit() and mm.isdigit() and yyyy.isdigit()):
        return None
    return f"{yyyy}-{mm.zfill(2)}-{dd.zfill(2)}"


def _prepare_value(col: str, val):
    if val is None:
        return None
    if col in JSON_COLUMNS:
        return json.dumps(val, ensure_ascii=False)
    if col in BOOL_COLUMNS:
        return 1 if val else 0
    return val


def _prepare_fields(fields: dict) -> dict:
    """Complète `fields` avec None pour toute colonne insérable absente, et
    sérialise/convertit les valeurs (JSON, booléens) pour SQLite."""
    out = {}
    for col in ALL_INSERTABLE_FIELDS:
        out[col] = _prepare_value(col, fields.get(col))
    return out


def create_work_order(fields: dict, materials: list[dict]) -> int:
    prepared = _prepare_fields(fields)
    cols = list(prepared.keys())
    placeholders = ", ".join(f":{c}" for c in cols)
    col_list = ", ".join(cols)
    with get_conn() as conn:
        cur = conn.execute(
            f"INSERT INTO work_orders ({col_list}) VALUES ({placeholders})",
            prepared,
        )
        wo_id = cur.lastrowid
        _insert_materials(conn, wo_id, materials)
        return wo_id


def _insert_materials(conn, wo_id: int, materials: list[dict]):
    for m in materials:
        conn.execute(
            """
            INSERT INTO materials (work_order_id, qty, designation, reference, price, price_raw)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                wo_id,
                m.get("qty"),
                m.get("designation"),
                m.get("reference"),
                m.get("price"),
                m.get("price_raw"),
            ),
        )


def update_work_order(wo_id: int, fields: dict, materials: Optional[list[dict]] = None) -> bool:
    prepared = _prepare_fields(fields)
    set_clause = ", ".join(f"{c}=:{c}" for c in prepared.keys())
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE work_orders SET {set_clause}, updated_at=datetime('now') WHERE id=:id",
            {**prepared, "id": wo_id},
        )
        if cur.rowcount == 0:
            return False
        if materials is not None:
            conn.execute("DELETE FROM materials WHERE work_order_id=?", (wo_id,))
            _insert_materials(conn, wo_id, materials)
        return True


def update_materials(wo_id: int, materials: list[dict]) -> bool:
    """Remplace uniquement le tableau des matériaux vendus d'un WO existant
    (utilisé par l'écran de gestion des matériaux / prix)."""
    with get_conn() as conn:
        exists = conn.execute("SELECT 1 FROM work_orders WHERE id=?", (wo_id,)).fetchone()
        if not exists:
            return False
        conn.execute("DELETE FROM materials WHERE work_order_id=?", (wo_id,))
        _insert_materials(conn, wo_id, materials)
        conn.execute(
            "UPDATE work_orders SET updated_at=datetime('now') WHERE id=?", (wo_id,)
        )
        return True


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    for col in JSON_COLUMNS:
        raw = d.get(col)
        if raw:
            try:
                d[col] = json.loads(raw)
            except (TypeError, ValueError):
                d[col] = None
    for col in BOOL_COLUMNS:
        if col in d and d[col] is not None:
            d[col] = bool(d[col])
    return d


def get_work_order(wo_id: int) -> Optional[dict]:
    with get_conn() as conn:
        wo = conn.execute("SELECT * FROM work_orders WHERE id=?", (wo_id,)).fetchone()
        if not wo:
            return None
        mats = conn.execute(
            "SELECT * FROM materials WHERE work_order_id=? ORDER BY id", (wo_id,)
        ).fetchall()
        d = _row_to_dict(wo)
        d["materials"] = [_row_to_dict(m) for m in mats]
        return d


def delete_work_order(wo_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM work_orders WHERE id=?", (wo_id,))
        return cur.rowcount > 0


def get_materials_in_range(
    date_from: Optional[str] = None, date_to: Optional[str] = None
) -> list[dict]:
    """Matériaux vendus (table `materials`), joints aux infos du WO parent
    (date, avion, n° d'ordre), filtrables par date jj/mm/aaaa (inclus).
    Consommé par app/analysis/price_analyzer.py (onglet "Analyse des prix").
    Seules les lignes avec un prix numérique sont retournées."""
    iso_from = _fr_date_to_iso(date_from) if date_from else None
    iso_to = _fr_date_to_iso(date_to) if date_to else None
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT m.id, m.qty, m.designation, m.reference, m.price, m.price_raw,
                   w.date, w.ac_type, w.ac_registration, w.order_number
            FROM materials m
            JOIN work_orders w ON w.id = m.work_order_id
            WHERE m.price IS NOT NULL
            """
        ).fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        iso_date = _fr_date_to_iso(d.get("date"))
        if iso_from and (not iso_date or iso_date < iso_from):
            continue
        if iso_to and (not iso_date or iso_date > iso_to):
            continue
        d["iso_date"] = iso_date
        out.append(d)
    return out


_SORTABLE_COLUMNS = {
    "created_at": "created_at",
    "order_number": "order_number",
    "ac_registration": "ac_registration",
    "global_confidence_score": "global_confidence_score",
}


def search_work_orders(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    ac_registration: Optional[str] = None,
    query: Optional[str] = None,
    source_file: Optional[str] = None,
    limit: int = 200,
    order_by: str = "created_at",
    order_dir: str = "desc",
) -> list[dict]:
    """Recherche les WO. date_from/date_to au format jj/mm/aaaa (inclus).
    Triable par date, n° de WO, immatriculation, confiance ou date
    d'enregistrement (order_by), ascendant ou descendant (order_dir)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM work_orders ORDER BY created_at DESC LIMIT ?", (max(limit * 3, 1000),)
        ).fetchall()

    iso_from = _fr_date_to_iso(date_from) if date_from else None
    iso_to = _fr_date_to_iso(date_to) if date_to else None

    out = []
    for r in rows:
        d = _row_to_dict(r)
        iso_date = _fr_date_to_iso(d.get("date"))
        d["_date_iso"] = iso_date or ""
        if iso_from and (not iso_date or iso_date < iso_from):
            continue
        if iso_to and (not iso_date or iso_date > iso_to):
            continue
        if ac_registration and ac_registration.upper() not in (d.get("ac_registration") or "").upper():
            continue
        if source_file and source_file.lower() not in (d.get("source_file") or "").lower():
            continue
        if query:
            haystack = " ".join(
                str(d.get(k, "")) for k in (
                    "order_number", "work_required", "airline_customer",
                    "document_name", "source_file",
                )
            ).lower()
            if query.lower() not in haystack:
                continue
        out.append(d)

    reverse = order_dir.lower() != "asc"
    if order_by == "date":
        out.sort(key=lambda d: d.get("_date_iso") or "", reverse=reverse)
    elif order_by == "order_number":
        out.sort(key=lambda d: _sort_key_alnum(d.get("order_number")), reverse=reverse)
    elif order_by in _SORTABLE_COLUMNS:
        col = _SORTABLE_COLUMNS[order_by]
        out.sort(key=lambda d: (d.get(col) is None, d.get(col) or ""), reverse=reverse)
    else:
        out.sort(key=lambda d: d.get("created_at") or "", reverse=reverse)

    out = out[:limit]

    with get_conn() as conn:
        for d in out:
            d.pop("_date_iso", None)
            mats = conn.execute(
                "SELECT * FROM materials WHERE work_order_id=? ORDER BY id", (d["id"],)
            ).fetchall()
            d["materials"] = [_row_to_dict(m) for m in mats]

    return out


def _sort_key_alnum(v: Optional[str]):
    """Clé de tri qui traite les n° de WO numériques comme des nombres
    (48213 avant 481223) tout en restant tolérante aux valeurs non numériques."""
    if v is None:
        return (0, "")
    v = str(v).strip()
    if v.isdigit():
        return (1, v.zfill(20))
    return (1, v.lower())


def get_dashboard_stats() -> dict:
    """Statistiques agrégées sur l'ensemble des WO enregistrés, pour le
    Dashboard : totaux, valeur des matériaux, répartition par mois / type
    avion / immatriculation, et derniers WO enregistrés."""
    with get_conn() as conn:
        wos = [_row_to_dict(r) for r in conn.execute("SELECT * FROM work_orders").fetchall()]
        mats = [_row_to_dict(r) for r in conn.execute("SELECT * FROM materials").fetchall()]

    total_work_orders = len(wos)
    total_materials_value = round(sum((m.get("price") or 0) for m in mats), 2)

    mh_values = [v for w in wos if (v := _parse_mh(w.get("required_mh"))) is not None]
    avg_required_mh = round(sum(mh_values) / len(mh_values), 2) if mh_values else 0.0
    with_work_required = [w for w in wos if (w.get("work_required") or "").strip()]
    missing_mh_count = sum(
        1 for w in with_work_required if _parse_mh(w.get("required_mh")) is None
    )

    by_month: dict[str, int] = {}
    for w in wos:
        iso = _fr_date_to_iso(w.get("date"))
        if not iso:
            continue
        ym = iso[:7]
        by_month[ym] = by_month.get(ym, 0) + 1

    by_ac_type: dict[str, int] = {}
    for w in wos:
        t = (w.get("ac_type") or "Inconnu").strip() or "Inconnu"
        by_ac_type[t] = by_ac_type.get(t, 0) + 1

    by_registration: dict[str, int] = {}
    for w in wos:
        r = (w.get("ac_registration") or "Inconnu").strip() or "Inconnu"
        by_registration[r] = by_registration.get(r, 0) + 1
    top_registrations = sorted(by_registration.items(), key=lambda kv: -kv[1])[:6]

    by_engine: dict[str, int] = {}
    needs_review_count = 0
    conf_values = []
    for w in wos:
        e = (w.get("engine_used") or "Inconnu").strip() or "Inconnu"
        by_engine[e] = by_engine.get(e, 0) + 1
        if w.get("requires_review"):
            needs_review_count += 1
        if w.get("global_confidence_score") is not None:
            conf_values.append(w["global_confidence_score"])
    avg_confidence = round(sum(conf_values) / len(conf_values), 4) if conf_values else None

    mats_by_wo: dict[int, list] = {}
    for m in mats:
        mats_by_wo.setdefault(m["work_order_id"], []).append(m)

    recent = sorted(wos, key=lambda w: w.get("created_at") or "", reverse=True)[:6]
    for w in recent:
        w["materials"] = mats_by_wo.get(w["id"], [])

    return {
        "total_work_orders": total_work_orders,
        "total_materials_value": total_materials_value,
        "avg_required_mh": avg_required_mh,
        "missing_mh_count": missing_mh_count,
        "by_month": sorted(by_month.items()),
        "by_ac_type": sorted(by_ac_type.items(), key=lambda kv: -kv[1]),
        "top_registrations": top_registrations,
        "recent": recent,
        "by_engine": sorted(by_engine.items(), key=lambda kv: -kv[1]),
        "needs_review_count": needs_review_count,
        "avg_confidence": avg_confidence,
    }


_MH_NUMBER_RE = re.compile(r"(\d+(?:[.,]\d+)?)")


def _parse_mh(raw: Optional[str]) -> Optional[float]:
    """Extrait un nombre d'heures (MH) depuis une valeur potentiellement
    manuscrite/imparfaitement transcrite : gère les unités ("8h", "6,5
    heures", "4.5 H"), les espaces, et les plages ("6-8", "6 à 8" -> prend
    le premier nombre). Retourne None si aucun nombre n'est trouvé."""
    if not raw:
        return None
    match = _MH_NUMBER_RE.search(raw.strip())
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "."))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Catégorisation "intelligente" des travaux demandés, par mots-clés locaux
# ---------------------------------------------------------------------------
# Objectif : regrouper des libellés manuscrits proches ("Remplacement joint
# hublot FWD", "remplacement joint hublot fwd + inspection") sous une même
# catégorie (action + pièce), sans appel API (gratuit, instantané, pas de
# consommation de quota Gemini) -- contrairement à un regroupement texte
# strict qui les aurait laissés dans des groupes séparés.
#
# Limites assumées : reconnaissance par mots-clés simple, pas de LLM. Un
# libellé sans mot-clé reconnu tombe dans "Autre" (ou son texte tronqué).

_WORK_ACTIONS: list[tuple[str, list[str]]] = [
    ("Remplacement", ["remplacement", "remplacer", "changement", "chang\u00e9"]),
    ("D\u00e9pose", ["d\u00e9pose", "depose", "d\u00e9montage", "demontage"]),
    ("Installation", ["installation", "montage", "pose de", "repose"]),
    ("Inspection", ["inspection", "inspecter"]),
    ("Contr\u00f4le", ["contr\u00f4le", "controle", "v\u00e9rification", "verification", "check"]),
    ("R\u00e9paration", ["r\u00e9paration", "reparation", "r\u00e9parer", "reparer"]),
    ("Appoint", ["appoint", "recharge", "remplissage"]),
    ("Nettoyage", ["nettoyage", "nettoyer"]),
    ("Lubrification", ["lubrification", "graissage"]),
    ("Test", ["test", "essai"]),
    ("Calibration", ["calibration", "\u00e9talonnage", "etalonnage"]),
    ("Ajustement", ["ajustement", "r\u00e9glage", "reglage"]),
]

_WORK_COMPONENTS: list[tuple[str, list[str]]] = [
    ("train d'atterrissage", ["train atterrissage", "train d'atterrissage", "train avant", "train principal", "train arriere", "train arri\u00e8re"]),
    ("hublot", ["hublot"]),
    ("pneu", ["pneu", "pneus"]),
    ("frein", ["frein", "freins"]),
    ("moteur", ["moteur", "reacteur", "r\u00e9acteur"]),
    ("hydraulique", ["hydraulique"]),
    ("\u00e9lectrique", ["electrique", "\u00e9lectrique"]),
    ("avionique", ["avionique"]),
    ("rad\u00f4me", ["radome", "rad\u00f4me"]),
    ("empennage", ["empennage"]),
    ("aile", ["aile", "ailes", "voilure"]),
    ("capot", ["capot"]),
    ("si\u00e8ge", ["siege", "si\u00e8ge", "sieges", "si\u00e8ges"]),
    ("cabine", ["cabine"]),
    ("extincteur", ["extincteur"]),
    ("batterie", ["batterie"]),
    ("filtre", ["filtre"]),
    ("c\u00e2ble", ["cable", "c\u00e2ble"]),
    ("valve", ["valve"]),
    ("capteur", ["capteur", "sonde"]),
    ("porte", ["porte"]),
    ("joint", ["joint"]),
    ("r\u00e9servoir", ["reservoir", "r\u00e9servoir"]),
    ("azote", ["azote", "n2"]),
    ("oxyg\u00e8ne", ["oxygene", "oxyg\u00e8ne"]),
]


def categorize_work(raw: Optional[str]) -> str:
    """Catégorise un libellé de travaux demandés par reconnaissance de
    mots-clés locaux (action + pièce/zone concernée), ex. "Remplacement
    joint hublot FWD, ctrl étanchéité" -> "Remplacement · joint". Ne fait
    aucun appel réseau/API. Retourne "Autre" si rien n'est reconnu (texte
    vide ou hors vocabulaire connu)."""
    if not raw or not raw.strip():
        return "(non renseigné)"
    text = raw.lower()

    action = next((label for label, kws in _WORK_ACTIONS if any(kw in text for kw in kws)), None)
    component = next((label for label, kws in _WORK_COMPONENTS if any(kw in text for kw in kws)), None)

    if action and component:
        return f"{action} \u00b7 {component}"
    if action:
        return action
    if component:
        return f"Autre \u00b7 {component}"
    return "Autre"


def get_hours_stats_by_work(query: Optional[str] = None, limit: int = 100) -> dict:
    """Marge des heures (MH requis) par CATÉGORIE de travaux demandés
    (regroupement intelligent par mots-clés locaux -- voir categorize_work
    -- et non par correspondance texte stricte), sur l'ensemble des CWO
    enregistrés : pour chaque catégorie, le nombre de CWO concernés et le
    MH minimum / maximum / moyen observés. `query` filtre par catégorie ou
    par texte brut des travaux (recherche libre, insensible à la casse)."""
    with get_conn() as conn:
        wos = [_row_to_dict(r) for r in conn.execute("SELECT * FROM work_orders").fetchall()]

    groups: dict[str, dict] = {}
    overall_values: list[float] = []

    for w in wos:
        mh = _parse_mh(w.get("required_mh"))
        raw_label = (w.get("work_required") or "").strip()
        category = categorize_work(raw_label)
        if query:
            q = query.lower()
            if q not in category.lower() and q not in raw_label.lower():
                continue
        g = groups.setdefault(
            category,
            {
                "category": category,
                "count": 0,
                "values": [],
                "example_order_numbers": [],
                "example_texts": [],
            },
        )
        g["count"] += 1
        if mh is not None:
            g["values"].append(mh)
            overall_values.append(mh)
        if w.get("order_number") and len(g["example_order_numbers"]) < 3:
            g["example_order_numbers"].append(w["order_number"])
        if raw_label and raw_label not in g["example_texts"] and len(g["example_texts"]) < 3:
            g["example_texts"].append(raw_label)

    rows = []
    for g in groups.values():
        vals = g["values"]
        rows.append({
            "work_required": g["category"],
            "count": g["count"],
            "min_mh": min(vals) if vals else None,
            "max_mh": max(vals) if vals else None,
            "avg_mh": round(sum(vals) / len(vals), 2) if vals else None,
            "example_order_numbers": g["example_order_numbers"],
            "example_texts": g["example_texts"],
        })

    rows.sort(key=lambda r: -r["count"])
    rows = rows[:limit]

    return {
        "rows": rows,
        "overall": {
            "count": len(overall_values),
            "min_mh": min(overall_values) if overall_values else None,
            "max_mh": max(overall_values) if overall_values else None,
            "avg_mh": round(sum(overall_values) / len(overall_values), 2) if overall_values else None,
        },
    }


def get_hours_anomalies(min_group_size: int = 3, z_threshold: float = 1.8) -> list[dict]:
    """Détecte les CWO dont le MH requis s'écarte fortement de la moyenne
    observée pour leur catégorie de travaux (même catégorisation par
    mots-clés que get_hours_stats_by_work). Un CWO est signalé si sa
    catégorie compte au moins `min_group_size` valeurs de MH et si son
    écart à la moyenne du groupe dépasse `z_threshold` fois l'écart-type
    du groupe (z-score). Les catégories à écart-type nul (toutes les
    valeurs identiques) ne peuvent pas produire d'anomalie."""
    with get_conn() as conn:
        wos = [_row_to_dict(r) for r in conn.execute("SELECT * FROM work_orders").fetchall()]

    by_category: dict[str, list[dict]] = {}
    for w in wos:
        mh = _parse_mh(w.get("required_mh"))
        if mh is None:
            continue
        category = categorize_work(w.get("work_required"))
        by_category.setdefault(category, []).append({**w, "_mh": mh})

    anomalies = []
    for category, items in by_category.items():
        if len(items) < min_group_size:
            continue
        values = [it["_mh"] for it in items]
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        std = variance ** 0.5
        if std == 0:
            continue
        for it in items:
            z = (it["_mh"] - mean) / std
            if abs(z) >= z_threshold:
                anomalies.append({
                    "id": it["id"],
                    "order_number": it.get("order_number"),
                    "date": it.get("date"),
                    "ac_registration": it.get("ac_registration"),
                    "work_required": it.get("work_required"),
                    "category": category,
                    "required_mh": it["_mh"],
                    "group_avg_mh": round(mean, 2),
                    "group_size": len(items),
                    "z_score": round(z, 2),
                    "direction": "au-dessus" if z > 0 else "en-dessous",
                })

    anomalies.sort(key=lambda a: -abs(a["z_score"]))
    return anomalies
