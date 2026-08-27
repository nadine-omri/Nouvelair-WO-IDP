import {
  DashboardStats,
  DocumentReport,
  FieldValue,
  HoursAnomaly,
  HoursByWorkRow,
  HoursByWorkStats,
  PipelineResult,
  PriceAnalysis,
  PriceMaterialItem,
  WorkOrderInput,
  WorkOrderRecord,
} from "./types";

function fv(
  raw: string,
  value: string | null,
  confidence: number,
  engine = "local_ocr"
): FieldValue {
  return {
    raw_text: raw,
    value,
    confidence,
    needs_review: confidence < 72,
    engine,
    ink_ratio: Math.round(Math.random() * 40 + 5) / 100,
    bbox_px: [12, 24, 220, 44],
  };
}

let counter = 0;

/**
 * Simule un résultat de pipeline plausible, pour que l'interface reste
 * pleinement démontrable même sans le backend Python démarré.
 */
export function mockPipelineResult(fileName: string): PipelineResult {
  counter += 1;
  const seed = counter;
  const lowConf = seed % 3 === 0;

  const fields: Record<string, FieldValue> = {
    order_number: fv("48213", "48213", 96),
    date: fv("14/03/2026", "14/03/2026", 93),
    lieu_place: fv("Tunis-Carthage", "Tunis-Carthage", 88),
    ac_type: fv("A320", "A320", 91),
    ac_registration: fv("TS-IMB", "TS-IMB", 89),
    airline_customer: fv("Tunisair", "Tunisair", 85),
    required_mh: fv("6,5", "6.5", lowConf ? 61 : 82),
    customer_rep_name: fv("H. Ben Salah", "H. Ben Salah", lowConf ? 58 : 79),
    customer_rep_date: fv("14/03/2026", "14/03/2026", 84),
    work_required: fv(
      "Inspection A-check + remplacement joint hydraulique train avant",
      "Inspection A-check + remplacement joint hydraulique train avant",
      lowConf ? 55 : 76
    ),
  };

  const needsReview = Object.values(fields).some((f) => f.needs_review) || lowConf;
  const globalScore = lowConf ? 0.63 : 0.88;

  return {
    engine_used: "local_ocr",
    requires_review: needsReview,
    review_reasons: needsReview
      ? [
          "Confiance faible sur : required_mh, customer_rep_name",
          "Score de confiance global trop bas (0.63 < 0.72)",
        ]
      : [],
    document_type: "sabena_customer_work_order",
    classification_score: 0.94,
    document_detected: true,
    document_detection_confidence: 0.97,
    template_aligned: true,
    template_matched: true,
    template_match_score: 0.91,
    deskew_angle: -0.6,
    extraction: {
      document_type: "sabena_customer_work_order",
      fields,
      material_sold: [
        {
          qty: "2",
          designation: "Joint hydraulique train avant",
          reference: "JH-4471-A",
          price: 340.5,
          price_raw: "340,50",
        },
        {
          qty: "1",
          designation: "Kit visserie inspection",
          reference: "KV-1120",
          price: 58.0,
          price_raw: "58,00",
        },
      ],
    },
    validation_issues: needsReview
      ? [
          {
            field: "required_mh",
            level: "warning",
            message: "MH hors plage habituelle, à confirmer",
          },
        ]
      : [],
    llm_validation: {
      used_llm: false,
      confidence_score: 0,
      issues: [],
    },
    confidence_components: {
      ocr: lowConf ? 0.68 : 0.87,
      template: 0.91,
      rules: lowConf ? 0.7 : 0.95,
      llm: null,
      llm_used: false,
      global: globalScore,
    },
    global_confidence_score: globalScore,
    processing_time_s: 1.8 + Math.random() * 2.4,
  };
}

// --------------------------------------------------------------------------
// Base de données simulée (en mémoire) — utilisée uniquement si le backend
// FastAPI n'est pas joignable, pour garder l'interface pleinement démontrable.
// Les données ne sont PAS persistées entre rechargements de page.
// --------------------------------------------------------------------------
let mockDbSeeded = false;
let mockDb: WorkOrderRecord[] = [];
let mockDbNextId = 1;

function seedMockDb() {
  if (mockDbSeeded) return;
  mockDbSeeded = true;
  const samples: Omit<WorkOrderRecord, "id">[] = [
    {
      document_name: "wo_48213.png",
      order_number: "48213",
      date: "14/03/2026",
      lieu_place: "Tunis-Carthage",
      ac_type: "A320",
      ac_registration: "TS-IMB",
      airline_customer: "Tunisair",
      required_mh: "6.5",
      customer_rep_name: "H. Ben Salah",
      customer_rep_date: "14/03/2026",
      work_required: "Inspection A-check + remplacement joint hydraulique train avant",
      materials: [
        { qty: "2", designation: "Joint hydraulique train avant", reference: "JH-4471-A", price: 340.5, price_raw: "340,50" },
      ],
    },
    {
      document_name: "wo_48190.png",
      order_number: "48190",
      date: "02/03/2026",
      lieu_place: "Tunis-Carthage",
      ac_type: "A319",
      ac_registration: "TS-IMD",
      airline_customer: "Nouvelair",
      required_mh: "3.0",
      customer_rep_name: "K. Trabelsi",
      customer_rep_date: "02/03/2026",
      work_required: "Contrôle pneus + appoint azote",
      materials: [{ qty: "4", designation: "Cartouche azote", reference: "N2-CART-10", price: 45, price_raw: "45,00" }],
    },
  ];
  mockDb = samples.map((s) => ({ ...s, id: mockDbNextId++ }));
}

export function mockCreateWorkOrder(input: WorkOrderInput): WorkOrderRecord {
  seedMockDb();
  const record: WorkOrderRecord = {
    ...input,
    id: mockDbNextId++,
    document_name: input.document_name ?? null,
    order_number: input.order_number ?? null,
    date: input.date ?? null,
    lieu_place: input.lieu_place ?? null,
    ac_type: input.ac_type ?? null,
    ac_registration: input.ac_registration ?? null,
    airline_customer: input.airline_customer ?? null,
    required_mh: input.required_mh ?? null,
    customer_rep_name: input.customer_rep_name ?? null,
    customer_rep_date: input.customer_rep_date ?? null,
    work_required: input.work_required ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    materials: input.materials,
  };
  mockDb.unshift(record);
  return record;
}

export function mockUpdateWorkOrder(id: number, input: WorkOrderInput): WorkOrderRecord | null {
  seedMockDb();
  const idx = mockDb.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  mockDb[idx] = {
    ...mockDb[idx],
    ...input,
    materials: input.materials,
    updated_at: new Date().toISOString(),
  } as WorkOrderRecord;
  return mockDb[idx];
}

export function mockUpdateMaterials(
  id: number,
  materials: WorkOrderRecord["materials"]
): WorkOrderRecord | null {
  seedMockDb();
  const idx = mockDb.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  mockDb[idx] = { ...mockDb[idx], materials, updated_at: new Date().toISOString() };
  return mockDb[idx];
}

export function mockSearchWorkOrders(params: {
  dateFrom?: string;
  dateTo?: string;
  acRegistration?: string;
  q?: string;
  sourceFile?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}): WorkOrderRecord[] {
  seedMockDb();
  const toIso = (d: string) => {
    const [dd, mm, yyyy] = d.split("/");
    return dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : "";
  };
  const from = params.dateFrom ? toIso(params.dateFrom) : null;
  const to = params.dateTo ? toIso(params.dateTo) : null;

  const filtered = mockDb.filter((w) => {
    const iso = w.date ? toIso(w.date) : "";
    if (from && (!iso || iso < from)) return false;
    if (to && (!iso || iso > to)) return false;
    if (
      params.acRegistration &&
      !(w.ac_registration || "").toUpperCase().includes(params.acRegistration.toUpperCase())
    )
      return false;
    if (
      params.sourceFile &&
      !(w.source_file || "").toLowerCase().includes(params.sourceFile.toLowerCase())
    )
      return false;
    if (params.q) {
      const hay = `${w.order_number} ${w.work_required} ${w.airline_customer} ${w.document_name}`.toLowerCase();
      if (!hay.includes(params.q.toLowerCase())) return false;
    }
    return true;
  });

  const dir = params.sortDir === "asc" ? 1 : -1;
  const sortBy = params.sortBy || "created_at";
  const key = (w: WorkOrderRecord): string => {
    if (sortBy === "date") return w.date ? toIso(w.date) : "";
    if (sortBy === "order_number") return (w.order_number || "").padStart(20, "0");
    if (sortBy === "ac_registration") return w.ac_registration || "";
    if (sortBy === "global_confidence_score") return String(w.global_confidence_score ?? 0).padStart(10, "0");
    return w.created_at || "";
  };
  return [...filtered].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * dir);
}

function woToIso(d: string | null): string | null {
  if (!d) return null;
  const [dd, mm, yyyy] = d.split("/");
  return dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : null;
}

// Miroir de db._parse_mh() côté backend : extrait un nombre d'heures même
// avec unité/texte autour ("8h", "6,5 heures", "6-8" -> premier nombre).
const MH_NUMBER_RE = /(\d+(?:[.,]\d+)?)/;
function parseMh(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = MH_NUMBER_RE.exec(raw.trim());
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  return Number.isNaN(v) ? null : v;
}

export function mockDashboardStats(): DashboardStats {
  seedMockDb();

  const total_work_orders = mockDb.length;
  const allMaterials = mockDb.flatMap((w) => w.materials);
  const total_materials_value =
    Math.round(allMaterials.reduce((s, m) => s + (m.price || 0), 0) * 100) / 100;

  const mhValues = mockDb.map((w) => parseMh(w.required_mh)).filter((v): v is number => v != null);
  const avg_required_mh = mhValues.length
    ? Math.round((mhValues.reduce((a, b) => a + b, 0) / mhValues.length) * 100) / 100
    : 0;
  const missing_mh_count = mockDb.filter(
    (w) => (w.work_required || "").trim() && parseMh(w.required_mh) == null
  ).length;

  const byMonth: Record<string, number> = {};
  for (const w of mockDb) {
    const iso = woToIso(w.date);
    if (!iso) continue;
    const ym = iso.slice(0, 7);
    byMonth[ym] = (byMonth[ym] || 0) + 1;
  }

  const byAcType: Record<string, number> = {};
  for (const w of mockDb) {
    const t = w.ac_type || "Inconnu";
    byAcType[t] = (byAcType[t] || 0) + 1;
  }

  const byReg: Record<string, number> = {};
  for (const w of mockDb) {
    const r = w.ac_registration || "Inconnu";
    byReg[r] = (byReg[r] || 0) + 1;
  }
  const top_registrations = Object.entries(byReg).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return {
    total_work_orders,
    total_materials_value,
    avg_required_mh,
    missing_mh_count,
    by_month: Object.entries(byMonth).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    by_ac_type: Object.entries(byAcType).sort((a, b) => b[1] - a[1]),
    top_registrations,
    recent: [...mockDb].slice(0, 6),
  };
}

// Miroir simplifié de db.categorize_work() côté backend (mêmes catégories),
// pour que le mode démo (backend Python indisponible) affiche des
// statistiques cohérentes avec le mode réel.
const MOCK_ACTIONS: [string, string[]][] = [
  ["Remplacement", ["remplacement", "remplacer", "changement"]],
  ["Dépose", ["dépose", "depose", "démontage", "demontage"]],
  ["Installation", ["installation", "montage", "pose de", "repose"]],
  ["Inspection", ["inspection", "inspecter"]],
  ["Contrôle", ["contrôle", "controle", "vérification", "verification", "check"]],
  ["Réparation", ["réparation", "reparation", "réparer", "reparer"]],
  ["Appoint", ["appoint", "recharge", "remplissage"]],
  ["Nettoyage", ["nettoyage", "nettoyer"]],
  ["Lubrification", ["lubrification", "graissage"]],
  ["Test", ["test", "essai"]],
  ["Calibration", ["calibration", "étalonnage", "etalonnage"]],
  ["Ajustement", ["ajustement", "réglage", "reglage"]],
];

const MOCK_COMPONENTS: [string, string[]][] = [
  ["train d'atterrissage", ["train atterrissage", "train d'atterrissage", "train avant", "train principal"]],
  ["hublot", ["hublot"]],
  ["pneu", ["pneu", "pneus"]],
  ["frein", ["frein", "freins"]],
  ["moteur", ["moteur", "réacteur", "reacteur"]],
  ["hydraulique", ["hydraulique"]],
  ["électrique", ["electrique", "électrique"]],
  ["avionique", ["avionique"]],
  ["radôme", ["radome", "radôme"]],
  ["joint", ["joint"]],
  ["azote", ["azote", "n2"]],
];

function mockCategorizeWork(raw: string | null): string {
  if (!raw || !raw.trim()) return "(non renseigné)";
  const text = raw.toLowerCase();
  const action = MOCK_ACTIONS.find(([, kws]) => kws.some((k) => text.includes(k)))?.[0];
  const component = MOCK_COMPONENTS.find(([, kws]) => kws.some((k) => text.includes(k)))?.[0];
  if (action && component) return `${action} · ${component}`;
  if (action) return action;
  if (component) return `Autre · ${component}`;
  return "Autre";
}

export function mockHoursByWorkStats(query?: string): HoursByWorkStats {
  seedMockDb();
  const groups = new Map<
    string,
    { category: string; count: number; values: number[]; example_order_numbers: string[]; example_texts: string[] }
  >();
  const overall: number[] = [];

  for (const w of mockDb) {
    const raw = (w.work_required || "").trim();
    const category = mockCategorizeWork(raw);
    if (query) {
      const q = query.toLowerCase();
      if (!category.toLowerCase().includes(q) && !raw.toLowerCase().includes(q)) continue;
    }
    const mh = parseMh(w.required_mh) ?? NaN;
    if (!groups.has(category)) {
      groups.set(category, { category, count: 0, values: [], example_order_numbers: [], example_texts: [] });
    }
    const g = groups.get(category)!;
    g.count += 1;
    if (!Number.isNaN(mh)) {
      g.values.push(mh);
      overall.push(mh);
    }
    if (w.order_number && g.example_order_numbers.length < 3) {
      g.example_order_numbers.push(w.order_number);
    }
    if (raw && !g.example_texts.includes(raw) && g.example_texts.length < 3) {
      g.example_texts.push(raw);
    }
  }

  const rows: HoursByWorkRow[] = Array.from(groups.values())
    .map((g) => ({
      work_required: g.category,
      count: g.count,
      min_mh: g.values.length ? Math.min(...g.values) : null,
      max_mh: g.values.length ? Math.max(...g.values) : null,
      avg_mh: g.values.length ? Math.round((g.values.reduce((a, b) => a + b, 0) / g.values.length) * 100) / 100 : null,
      example_order_numbers: g.example_order_numbers,
      example_texts: g.example_texts,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    rows,
    overall: {
      count: overall.length,
      min_mh: overall.length ? Math.min(...overall) : null,
      max_mh: overall.length ? Math.max(...overall) : null,
      avg_mh: overall.length ? Math.round((overall.reduce((a, b) => a + b, 0) / overall.length) * 100) / 100 : null,
    },
  };
}

export function mockHoursAnomalies(minGroupSize = 3, zThreshold = 1.8): HoursAnomaly[] {
  seedMockDb();
  const byCategory = new Map<string, (WorkOrderRecord & { _mh: number })[]>();
  for (const w of mockDb) {
    const mh = parseMh(w.required_mh) ?? NaN;
    if (Number.isNaN(mh)) continue;
    const category = mockCategorizeWork(w.work_required);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push({ ...w, _mh: mh });
  }

  const anomalies: HoursAnomaly[] = [];
  for (const [category, items] of byCategory.entries()) {
    if (items.length < minGroupSize) continue;
    const mean = items.reduce((a, b) => a + b._mh, 0) / items.length;
    const variance = items.reduce((a, b) => a + (b._mh - mean) ** 2, 0) / items.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    for (const it of items) {
      const z = (it._mh - mean) / std;
      if (Math.abs(z) >= zThreshold) {
        anomalies.push({
          id: it.id,
          order_number: it.order_number,
          date: it.date,
          ac_registration: it.ac_registration,
          work_required: it.work_required,
          category,
          required_mh: it._mh,
          group_avg_mh: Math.round(mean * 100) / 100,
          group_size: items.length,
          z_score: Math.round(z * 100) / 100,
          direction: z > 0 ? "au-dessus" : "en-dessous",
        });
      }
    }
  }
  anomalies.sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score));
  return anomalies;
}

// --------------------------------------------------------------------------
// Analyse des prix (mode démo) — mêmes stats que le backend Python
// (app/analysis/price_analyzer.py), calculées côté client sur mockDb.
// --------------------------------------------------------------------------

function frDateToIso(d: string | null | undefined): string | null {
  if (!d) return null;
  const [dd, mm, yyyy] = d.split("/");
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export function mockPriceAnalysis(params: { dateFrom?: string; dateTo?: string }): PriceAnalysis {
  seedMockDb();

  const isoFrom = params.dateFrom ? frDateToIso(params.dateFrom) : null;
  const isoTo = params.dateTo ? frDateToIso(params.dateTo) : null;

  const items: PriceMaterialItem[] = [];
  for (const wo of mockDb) {
    const isoDate = frDateToIso(wo.date);
    if (isoFrom && (!isoDate || isoDate < isoFrom)) continue;
    if (isoTo && (!isoDate || isoDate > isoTo)) continue;
    for (const m of wo.materials) {
      if (typeof m.price !== "number") continue;
      items.push({
        id: m.id ?? 0,
        qty: m.qty,
        designation: m.designation,
        reference: m.reference,
        price: m.price,
        price_raw: m.price_raw,
        date: wo.date,
        ac_type: wo.ac_type,
        ac_registration: wo.ac_registration,
        order_number: wo.order_number,
        iso_date: isoDate,
      });
    }
  }

  const n_items = items.length;
  const total_value = Math.round(items.reduce((s, m) => s + m.price, 0) * 100) / 100;
  const avg_price = n_items ? Math.round((total_value / n_items) * 100) / 100 : 0;
  const max_item = items.reduce<PriceMaterialItem | null>(
    (best, m) => (!best || m.price > best.price ? m : best),
    null
  );
  const min_item = items.reduce<PriceMaterialItem | null>(
    (best, m) => (!best || m.price < best.price ? m : best),
    null
  );

  const byMonthMap = new Map<string, { count: number; total: number }>();
  for (const m of items) {
    const ym = m.iso_date ? m.iso_date.slice(0, 7) : "Date inconnue";
    const b = byMonthMap.get(ym) ?? { count: 0, total: 0 };
    b.count += 1;
    b.total += m.price;
    byMonthMap.set(ym, b);
  }
  const by_month = [...byMonthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, count: v.count, total: Math.round(v.total * 100) / 100 }));

  const byDesignationMap = new Map<string, { count: number; total: number }>();
  for (const m of items) {
    const d = m.designation || "Non désigné";
    const b = byDesignationMap.get(d) ?? { count: 0, total: 0 };
    b.count += 1;
    b.total += m.price;
    byDesignationMap.set(d, b);
  }
  const top_designations = [...byDesignationMap.entries()]
    .map(([designation, v]) => ({ designation, count: v.count, total: Math.round(v.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const byAcTypeMap = new Map<string, number>();
  for (const m of items) {
    const t = (m.ac_type || "Inconnu").trim() || "Inconnu";
    byAcTypeMap.set(t, (byAcTypeMap.get(t) ?? 0) + m.price);
  }
  const by_ac_type = [...byAcTypeMap.entries()]
    .map(([ac_type, total]) => ({ ac_type, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  const month_avg_trend = by_month.map((b) => ({
    month: b.month,
    avg: b.count ? Math.round((b.total / b.count) * 100) / 100 : 0,
  }));
  let trend_pct: number | null = null;
  if (month_avg_trend.length >= 2 && month_avg_trend[0].avg) {
    trend_pct =
      Math.round(
        ((month_avg_trend[month_avg_trend.length - 1].avg - month_avg_trend[0].avg) /
          month_avg_trend[0].avg) *
          1000
      ) / 10;
  }

  const stats = {
    n_items,
    total_value,
    avg_price,
    max_item,
    min_item,
    by_month,
    top_designations,
    by_ac_type,
    month_avg_trend,
    trend_pct,
  };

  const report = n_items
    ? [
        "## Résumé",
        `${n_items} pièce(s) facturée(s) sur la période, pour une valeur totale de ${total_value.toFixed(2)} TND (moyenne ${avg_price.toFixed(2)} TND/pièce).`,
        "",
        "## Tendances",
        top_designations[0]
          ? `Le poste le plus coûteux est **${top_designations[0].designation}** (${top_designations[0].total.toFixed(2)} TND sur ${top_designations[0].count} occurrence(s)).`
          : "",
        "",
        "## Points d'attention",
        "_(mode démo — backend Python non joignable ; ceci est un résumé simulé, pas un rapport généré par IA)_",
        "",
        "## Recommandations",
        "Démarre le backend FastAPI (`api_server.py`) pour obtenir le vrai rapport généré par IA sur tes données.",
      ]
        .filter((l) => l !== "")
        .join("\n")
    : "## Résumé\nAucune donnée facturée sur la période sélectionnée.";

  return { stats, report, generated_by: "template", items };
}

// --------------------------------------------------------------------------
// Rapport IA par document (mode démo) — résumé simulé + comparaison M/H
// approximative sur mockDb (le vrai regroupement par catégorie de travaux
// vit côté backend, voir db.categorize_work).
// --------------------------------------------------------------------------

function parseMhLoose(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function mockDocumentReport(result: PipelineResult): DocumentReport {
  seedMockDb();

  const fields = Object.fromEntries(
    Object.entries(result.extraction.fields).map(([k, v]) => [k, v.value])
  );
  const docMh = parseMhLoose(fields["required_mh"]);

  const mhValues = mockDb
    .map((w) => parseMhLoose(w.required_mh))
    .filter((v): v is number => v != null);
  const avgMh = mhValues.length
    ? Math.round((mhValues.reduce((a, b) => a + b, 0) / mhValues.length) * 100) / 100
    : null;

  const hours_comparison =
    avgMh != null
      ? {
          category: "Ensemble des travaux (mode démo)",
          doc_mh: docMh,
          group_count: mhValues.length,
          avg_mh: avgMh,
          min_mh: Math.min(...mhValues),
          max_mh: Math.max(...mhValues),
          delta_pct: docMh != null && avgMh ? Math.round(((docMh - avgMh) / avgMh) * 1000) / 10 : null,
        }
      : null;

  const materialCount = result.extraction.material_sold.length;
  const report = [
    "## Résumé",
    `CWO ${fields["order_number"] || "—"} du ${fields["date"] || "—"} — ` +
      `${fields["ac_type"] || "type avion inconnu"} (${fields["ac_registration"] || "—"}), ` +
      `${materialCount} ligne(s) de matériel.`,
    "",
    "## Points d'attention",
    result.validation_issues.length
      ? result.validation_issues.slice(0, 5).map((i) => `- ${i.message}`).join("\n")
      : "_(mode démo — backend Python non joignable ; ceci est un résumé simulé, pas un rapport généré par IA)_",
    "",
    "## Recommandation",
    "Démarre le backend FastAPI (`api_server.py`) pour obtenir le vrai rapport généré par IA sur ce document.",
  ].join("\n");

  return { report, generated_by: "template", hours_comparison };
}
