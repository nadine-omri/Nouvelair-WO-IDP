"""
Base de données SQLite pour l'historique des ordres de travail (Work Orders)
traités et corrigés via l'interface.

Ne touche à rien du pipeline existant : c'est une couche additive, utilisée
uniquement par api_server.py (endpoints /api/work-orders/*).

Champs stockés par WO : order_number, work_required, ac_registration,
ac_type, mh_required, date, lieu, airline_customer, customer_rep_name,
customer_rep_date, document_name + N matériaux vendus liés (qty,
designation, reference, price).
"""
import sqlite3
import json
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

    # Migrations additives : la base existante reste compatible.
    with get_conn() as conn:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(work_orders)").fetchall()}
        migrations = {
            "source_file": "TEXT",
            "source_page": "INTEGER",
            "source_total_pages": "INTEGER",
            "engine_used": "TEXT",
            "global_confidence": "REAL",
            "processing_time_s": "REAL",
            "technical_json": "TEXT",
            "extraction_json": "TEXT",
        }
        for name, sql_type in migrations.items():
            if name not in columns:
                conn.execute(f"ALTER TABLE work_orders ADD COLUMN {name} {sql_type}")



def create_processed_work_order(
    *,
    source_file: str,
    source_page: int,
    source_total_pages: int,
    pipeline: dict,
) -> int:
    """Enregistre automatiquement chaque page/WO dès la fin du traitement.

    Le résultat technique et l'extraction complète sont conservés en JSON afin
    de pouvoir reconstruire l'historique même après fermeture de l'application.
    """
    fields = (pipeline.get("extraction") or {}).get("fields") or {}

    def value(key: str):
        item = fields.get(key) or {}
        return item.get("value")

    wo_fields = {
        "document_name": source_file,
        "order_number": value("order_number"),
        "date": value("date"),
        "lieu_place": value("lieu_place"),
        "ac_type": value("ac_type"),
        "ac_registration": value("ac_registration"),
        "airline_customer": value("airline_customer"),
        "required_mh": value("required_mh"),
        "customer_rep_name": value("customer_rep_name"),
        "customer_rep_date": value("customer_rep_date"),
        "work_required": value("work_required"),
    }
    materials = (pipeline.get("extraction") or {}).get("material_sold") or []
    technical = {
        "engine_used": pipeline.get("engine_used"),
        "global_confidence_score": pipeline.get("global_confidence_score"),
        "requires_review": pipeline.get("requires_review"),
        "review_reasons": pipeline.get("review_reasons") or [],
        "processing_time_s": pipeline.get("processing_time_s"),
        "document_type": pipeline.get("document_type"),
        "classification_score": pipeline.get("classification_score"),
        "document_detected": pipeline.get("document_detected"),
        "document_detection_confidence": pipeline.get("document_detection_confidence"),
        "template_aligned": pipeline.get("template_aligned"),
        "template_matched": pipeline.get("template_matched"),
        "template_match_score": pipeline.get("template_match_score"),
        "deskew_angle": pipeline.get("deskew_angle"),
        "confidence_components": pipeline.get("confidence_components"),
        "validation_issues": pipeline.get("validation_issues"),
        "llm_validation": pipeline.get("llm_validation"),
    }

    with get_conn() as conn:
        # Un même fichier/page est idempotent : un retraitement met à jour
        # l'entrée historique au lieu de créer des doublons.
        existing = conn.execute(
            "SELECT id FROM work_orders WHERE source_file=? AND source_page=?",
            (source_file, source_page),
        ).fetchone()
        if existing:
            wo_id = existing["id"]
            conn.execute(
                """UPDATE work_orders SET
                   document_name=:document_name, order_number=:order_number,
                   date=:date, lieu_place=:lieu_place, ac_type=:ac_type,
                   ac_registration=:ac_registration, airline_customer=:airline_customer,
                   required_mh=:required_mh, customer_rep_name=:customer_rep_name,
                   customer_rep_date=:customer_rep_date, work_required=:work_required,
                   source_total_pages=:source_total_pages, engine_used=:engine_used,
                   global_confidence=:global_confidence, processing_time_s=:processing_time_s,
                   technical_json=:technical_json, extraction_json=:extraction_json,
                   updated_at=datetime('now')
                   WHERE id=:id""",
                {
                    **wo_fields,
                    "source_total_pages": source_total_pages,
                    "engine_used": pipeline.get("engine_used"),
                    "global_confidence": pipeline.get("global_confidence_score"),
                    "processing_time_s": pipeline.get("processing_time_s"),
                    "technical_json": json.dumps(technical, ensure_ascii=False),
                    "extraction_json": json.dumps(pipeline.get("extraction") or {}, ensure_ascii=False),
                    "id": wo_id,
                },
            )
            conn.execute("DELETE FROM materials WHERE work_order_id=?", (wo_id,))
            _insert_materials(conn, wo_id, materials)
            return wo_id

        cur = conn.execute(
            """INSERT INTO work_orders
               (document_name, order_number, date, lieu_place, ac_type,
                ac_registration, airline_customer, required_mh,
                customer_rep_name, customer_rep_date, work_required,
                source_file, source_page, source_total_pages, engine_used,
                global_confidence, processing_time_s, technical_json, extraction_json)
               VALUES
               (:document_name, :order_number, :date, :lieu_place, :ac_type,
                :ac_registration, :airline_customer, :required_mh,
                :customer_rep_name, :customer_rep_date, :work_required,
                :source_file, :source_page, :source_total_pages, :engine_used,
                :global_confidence, :processing_time_s, :technical_json, :extraction_json)""",
            {
                **wo_fields,
                "source_file": source_file,
                "source_page": source_page,
                "source_total_pages": source_total_pages,
                "engine_used": pipeline.get("engine_used"),
                "global_confidence": pipeline.get("global_confidence_score"),
                "processing_time_s": pipeline.get("processing_time_s"),
                "technical_json": json.dumps(technical, ensure_ascii=False),
                "extraction_json": json.dumps(pipeline.get("extraction") or {}, ensure_ascii=False),
            },
        )
        wo_id = cur.lastrowid
        _insert_materials(conn, wo_id, materials)
        return wo_id


def get_technical(wo_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT technical_json, extraction_json, source_file, source_page, source_total_pages "
            "FROM work_orders WHERE id=?", (wo_id,)
        ).fetchone()
        if not row:
            return None
        return {
            "id": wo_id,
            "source_file": row["source_file"],
            "source_page": row["source_page"],
            "source_total_pages": row["source_total_pages"],
            "technical": json.loads(row["technical_json"] or "{}"),
            "extraction": json.loads(row["extraction_json"] or "{}"),
        }


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


def create_work_order(fields: dict, materials: list[dict]) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO work_orders
                (document_name, order_number, date, lieu_place, ac_type,
                 ac_registration, airline_customer, required_mh,
                 customer_rep_name, customer_rep_date, work_required)
            VALUES (:document_name, :order_number, :date, :lieu_place, :ac_type,
                    :ac_registration, :airline_customer, :required_mh,
                    :customer_rep_name, :customer_rep_date, :work_required)
            """,
            fields,
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
    with get_conn() as conn:
        cur = conn.execute(
            """
            UPDATE work_orders SET
                document_name=:document_name, order_number=:order_number, date=:date,
                lieu_place=:lieu_place, ac_type=:ac_type, ac_registration=:ac_registration,
                airline_customer=:airline_customer, required_mh=:required_mh,
                customer_rep_name=:customer_rep_name, customer_rep_date=:customer_rep_date,
                work_required=:work_required, updated_at=datetime('now')
            WHERE id=:id
            """,
            {**fields, "id": wo_id},
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
    return dict(row)


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


def search_work_orders(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    ac_registration: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    """Recherche les WO. date_from/date_to au format jj/mm/aaaa (inclus)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM work_orders ORDER BY created_at DESC LIMIT ?", (limit * 3,)
        ).fetchall()

    iso_from = _fr_date_to_iso(date_from) if date_from else None
    iso_to = _fr_date_to_iso(date_to) if date_to else None

    out = []
    for r in rows:
        d = _row_to_dict(r)
        iso_date = _fr_date_to_iso(d.get("date"))
        if iso_from and (not iso_date or iso_date < iso_from):
            continue
        if iso_to and (not iso_date or iso_date > iso_to):
            continue
        if ac_registration and ac_registration.upper() not in (d.get("ac_registration") or "").upper():
            continue
        if query:
            haystack = " ".join(
                str(d.get(k, "")) for k in ("order_number", "work_required", "airline_customer", "document_name")
            ).lower()
            if query.lower() not in haystack:
                continue
        out.append(d)
        if len(out) >= limit:
            break

    with get_conn() as conn:
        for d in out:
            mats = conn.execute(
                "SELECT * FROM materials WHERE work_order_id=? ORDER BY id", (d["id"],)
            ).fetchall()
            d["materials"] = [_row_to_dict(m) for m in mats]

    return out


def get_materials_in_range(date_from: Optional[str] = None, date_to: Optional[str] = None) -> list[dict]:
    """Retourne tous les matériaux vendus dont le WO parent a une date dans
    l'intervalle [date_from, date_to] (jj/mm/aaaa, bornes incluses, chacune
    optionnelle). Chaque ligne est enrichie avec le contexte du WO (date,
    order_number, ac_registration, ac_type, airline_customer) pour permettre
    l'analyse des prix sans requête supplémentaire.
    """
    iso_from = _fr_date_to_iso(date_from) if date_from else None
    iso_to = _fr_date_to_iso(date_to) if date_to else None

    with get_conn() as conn:
        wos = [_row_to_dict(r) for r in conn.execute("SELECT * FROM work_orders").fetchall()]
        mats = [_row_to_dict(r) for r in conn.execute("SELECT * FROM materials").fetchall()]

    wo_by_id = {w["id"]: w for w in wos}
    out = []
    for m in mats:
        wo = wo_by_id.get(m["work_order_id"])
        if not wo:
            continue
        iso_date = _fr_date_to_iso(wo.get("date"))
        if iso_from and (not iso_date or iso_date < iso_from):
            continue
        if iso_to and (not iso_date or iso_date > iso_to):
            continue
        if m.get("price") is None:
            continue
        out.append({
            "date": wo.get("date"),
            "iso_date": iso_date,
            "order_number": wo.get("order_number"),
            "ac_registration": wo.get("ac_registration"),
            "ac_type": wo.get("ac_type"),
            "airline_customer": wo.get("airline_customer"),
            "designation": (m.get("designation") or "").strip() or "Non désigné",
            "reference": m.get("reference"),
            "qty": m.get("qty"),
            "price": m.get("price"),
        })
    out.sort(key=lambda r: r.get("iso_date") or "")
    return out


def get_dashboard_stats() -> dict:
    """Statistiques agrégées sur l'ensemble des WO enregistrés, pour le
    Dashboard : totaux, valeur des matériaux, répartition par mois / type
    avion / immatriculation, et derniers WO enregistrés."""
    with get_conn() as conn:
        wos = [_row_to_dict(r) for r in conn.execute("SELECT * FROM work_orders").fetchall()]
        mats = [_row_to_dict(r) for r in conn.execute("SELECT * FROM materials").fetchall()]

    total_work_orders = len(wos)
    total_materials_value = round(sum((m.get("price") or 0) for m in mats), 2)

    mh_values = []
    for w in wos:
        raw = (w.get("required_mh") or "").replace(",", ".").strip()
        try:
            mh_values.append(float(raw))
        except ValueError:
            pass
    avg_required_mh = round(sum(mh_values) / len(mh_values), 2) if mh_values else 0.0

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
        "by_month": sorted(by_month.items()),
        "by_ac_type": sorted(by_ac_type.items(), key=lambda kv: -kv[1]),
        "top_registrations": top_registrations,
        "recent": recent,
    }
