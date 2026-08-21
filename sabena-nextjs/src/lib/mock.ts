import {
  DashboardStats,
  FieldValue,
  PipelineResult,
  PriceAnalysis,
  PriceAnalysisItem,
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
}): WorkOrderRecord[] {
  seedMockDb();
  const toIso = (d: string) => {
    const [dd, mm, yyyy] = d.split("/");
    return dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : "";
  };
  const from = params.dateFrom ? toIso(params.dateFrom) : null;
  const to = params.dateTo ? toIso(params.dateTo) : null;

  return mockDb.filter((w) => {
    const iso = w.date ? toIso(w.date) : "";
    if (from && (!iso || iso < from)) return false;
    if (to && (!iso || iso > to)) return false;
    if (
      params.acRegistration &&
      !(w.ac_registration || "").toUpperCase().includes(params.acRegistration.toUpperCase())
    )
      return false;
    if (params.q) {
      const hay = `${w.order_number} ${w.work_required} ${w.airline_customer} ${w.document_name}`.toLowerCase();
      if (!hay.includes(params.q.toLowerCase())) return false;
    }
    return true;
  });
}

function woToIso(d: string | null): string | null {
  if (!d) return null;
  const [dd, mm, yyyy] = d.split("/");
  return dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : null;
}

export function mockDashboardStats(): DashboardStats {
  seedMockDb();

  const total_work_orders = mockDb.length;
  const allMaterials = mockDb.flatMap((w) => w.materials);
  const total_materials_value =
    Math.round(allMaterials.reduce((s, m) => s + (m.price || 0), 0) * 100) / 100;

  const mhValues = mockDb
    .map((w) => parseFloat((w.required_mh || "").replace(",", ".")))
    .filter((v) => !Number.isNaN(v));
  const avg_required_mh = mhValues.length
    ? Math.round((mhValues.reduce((a, b) => a + b, 0) / mhValues.length) * 100) / 100
    : 0;

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
    by_month: Object.entries(byMonth).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    by_ac_type: Object.entries(byAcType).sort((a, b) => b[1] - a[1]),
    top_registrations,
    recent: [...mockDb].slice(0, 6),
  };
}

// --------------------------------------------------------------------------
// Analyse des prix (IA) — démo hors-ligne, même logique que price_analyzer.py
// --------------------------------------------------------------------------

function mockPriceReport(items: PriceAnalysisItem[], totalValue: number, avgPrice: number): string {
  if (items.length === 0) {
    return "## Résumé\nAucune donnée facturée sur la période sélectionnée.";
  }
  const byDesignation: Record<string, number> = {};
  for (const it of items) {
    byDesignation[it.designation] = (byDesignation[it.designation] || 0) + it.price;
  }
  const top = Object.entries(byDesignation).sort((a, b) => b[1] - a[1])[0];
  return [
    "## Résumé",
    `${items.length} pièce(s) facturée(s) sur la période, pour une valeur totale de ${totalValue.toFixed(
      2
    )} TND (moyenne ${avgPrice.toFixed(2)} TND/pièce). *(mode démo — backend Python indisponible)*`,
    "",
    "## Tendances",
    top ? `Le poste le plus coûteux est **${top[0]}** (${top[1].toFixed(2)} TND).` : "",
    "",
    "## Points d'attention",
    "_(analyse IA non disponible hors-ligne — connectez le backend Python pour un rapport généré par LLM)_",
    "",
    "## Recommandations",
    "Démarrez `uvicorn api_server:app --port 8000` avec une clé HF_TOKEN configurée "
      + "pour obtenir une analyse qualitative complète.",
  ].join("\n");
}

export function mockPriceAnalysis(params: { dateFrom?: string; dateTo?: string }): PriceAnalysis {
  seedMockDb();

  const toIso = (d: string) => {
    const [dd, mm, yyyy] = d.split("/");
    return dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : "";
  };
  const from = params.dateFrom ? toIso(params.dateFrom) : null;
  const to = params.dateTo ? toIso(params.dateTo) : null;

  const items: PriceAnalysisItem[] = [];
  for (const w of mockDb) {
    const iso = w.date ? toIso(w.date) : "";
    if (from && (!iso || iso < from)) continue;
    if (to && (!iso || iso > to)) continue;
    for (const m of w.materials) {
      if (m.price == null) continue;
      items.push({
        date: w.date,
        iso_date: iso || null,
        order_number: w.order_number,
        ac_registration: w.ac_registration,
        ac_type: w.ac_type,
        airline_customer: w.airline_customer,
        designation: (m.designation || "").trim() || "Non désigné",
        reference: m.reference,
        qty: m.qty,
        price: m.price,
      });
    }
  }
  items.sort((a, b) => (a.iso_date || "").localeCompare(b.iso_date || ""));

  const n_items = items.length;
  const total_value = Math.round(items.reduce((s, m) => s + m.price, 0) * 100) / 100;
  const avg_price = n_items ? Math.round((total_value / n_items) * 100) / 100 : 0;

  const byMonth: Record<string, { count: number; total: number }> = {};
  for (const it of items) {
    const ym = it.iso_date ? it.iso_date.slice(0, 7) : "Date inconnue";
    byMonth[ym] ??= { count: 0, total: 0 };
    byMonth[ym].count += 1;
    byMonth[ym].total += it.price;
  }
  const by_month = Object.entries(byMonth)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, v]) => ({ month, count: v.count, total: Math.round(v.total * 100) / 100 }));

  const byDesignation: Record<string, { count: number; total: number }> = {};
  for (const it of items) {
    byDesignation[it.designation] ??= { count: 0, total: 0 };
    byDesignation[it.designation].count += 1;
    byDesignation[it.designation].total += it.price;
  }
  const top_designations = Object.entries(byDesignation)
    .map(([designation, v]) => ({ designation, count: v.count, total: Math.round(v.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const byAcType: Record<string, number> = {};
  for (const it of items) {
    const t = it.ac_type || "Inconnu";
    byAcType[t] = (byAcType[t] || 0) + it.price;
  }
  const by_ac_type = Object.entries(byAcType)
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

  const max_item = items.length ? items.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const min_item = items.length ? items.reduce((a, b) => (b.price < a.price ? b : a)) : null;

  return {
    stats: {
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
    },
    report: mockPriceReport(items, total_value, avg_price),
    generated_by: "template",
    items,
  };
}
