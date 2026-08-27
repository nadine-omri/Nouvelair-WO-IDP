export type EngineUsed =
  | "gemini"
  | "claude"
  | "ollama"
  | "local_ocr"
  | "local_ocr_fallback"
  | string;

export interface FieldValue {
  raw_text: string;
  value: string | null;
  confidence: number; // 0-100
  needs_review: boolean;
  engine: string;
  ink_ratio: number;
  bbox_px: [number, number, number, number];
}

export interface MaterialRow {
  qty: string | null;
  designation: string | null;
  reference: string | null;
  price: number | null;
  price_raw: string | null;
}

export interface ExtractionResult {
  document_type: string;
  fields: Record<string, FieldValue>;
  material_sold: MaterialRow[];
}

export interface ValidationIssue {
  field: string;
  level: "error" | "warning";
  message: string;
}

export interface LLMValidationReport {
  used_llm: boolean;
  confidence_score: number;
  issues: string[];
}

export interface ConfidenceComponents {
  ocr: number;
  template: number;
  rules: number;
  llm: number | null;
  llm_used: boolean;
  global: number;
}

export interface PipelineResult {
  engine_used: EngineUsed;
  requires_review: boolean;
  review_reasons: string[];
  document_type: string;
  classification_score: number;
  document_detected: boolean;
  document_detection_confidence: number;
  template_aligned: boolean;
  template_matched: boolean;
  template_match_score: number;
  deskew_angle: number;
  extraction: ExtractionResult;
  validation_issues: ValidationIssue[];
  llm_validation: LLMValidationReport;
  confidence_components: ConfidenceComponents;
  global_confidence_score: number;
  processing_time_s: number;
}

export interface ProcessedDocument {
  name: string;
  result: PipelineResult;
  /** Id du WO créé automatiquement en base lors du traitement (voir
   * /api/process côté backend). Null si la persistance a échoué ou en mode
   * démo. Permet de faire un UPDATE plutôt qu'un nouveau CREATE ensuite. */
  dbId?: number | null;
  /** Nom du fichier importé (avant découpage PDF en pages). */
  sourceFile: string;
  /** Numéro de page (1-based) dans le fichier source. */
  pageIndex: number;
  /** Nombre total de pages dans le fichier source. */
  pageCount: number;
}

export const MANUAL_FIELD_KEYS = [
  "order_number",
  "date",
  "lieu_place",
  "ac_type",
  "ac_registration",
  "airline_customer",
  "required_mh",
  "customer_rep_name",
  "customer_rep_date",
  "work_required",
] as const;

export type ManualFieldKey = (typeof MANUAL_FIELD_KEYS)[number];

export type ManualData = Record<ManualFieldKey, string>;

export interface ValidationTuple {
  field: string;
  level: "error" | "warning";
  message: string;
}

export const FIELD_LABELS: Record<string, string> = {
  order_number: "N° d'ordre",
  date: "Date",
  lieu_place: "Lieu",
  ac_type: "Type avion",
  ac_registration: "Immatriculation",
  airline_customer: "Client / Compagnie",
  required_mh: "MH requis",
  work_required: "Travaux demandés",
  customer_rep_name: "Représentant client",
  customer_rep_date: "Date représentant",
};

// --------------------------------------------------------------------------
// Base de données des ordres de travail (persistance backend)
// --------------------------------------------------------------------------

export interface MaterialRecord {
  id?: number;
  work_order_id?: number;
  qty: string | null;
  designation: string | null;
  reference: string | null;
  price: number | null;
  price_raw: string | null;
}

// Informations techniques persistées avec chaque WO (identiques à ce que
// PipelineResult contient en session, mais stockées en base pour rester
// accessibles après fermeture de l'application).
export interface WorkOrderTechnical {
  source_file?: string | null;
  page_index?: number | null;
  page_count?: number | null;
  engine_used?: string | null;
  requires_review?: boolean | null;
  review_reasons?: string[] | null;
  document_type?: string | null;
  classification_score?: number | null;
  document_detected?: boolean | null;
  document_detection_confidence?: number | null;
  template_aligned?: boolean | null;
  template_matched?: boolean | null;
  template_match_score?: number | null;
  deskew_angle?: number | null;
  processing_time_s?: number | null;
  confidence_ocr?: number | null;
  confidence_template?: number | null;
  confidence_rules?: number | null;
  confidence_llm?: number | null;
  confidence_llm_used?: boolean | null;
  global_confidence_score?: number | null;
  validation_issues?: ValidationIssue[] | null;
  llm_validation?: LLMValidationReport | null;
  extraction_fields?: Record<string, FieldValue> | null;
}

export interface WorkOrderRecord extends WorkOrderTechnical {
  id: number;
  document_name: string | null;
  order_number: string | null;
  date: string | null;
  lieu_place: string | null;
  ac_type: string | null;
  ac_registration: string | null;
  airline_customer: string | null;
  required_mh: string | null;
  customer_rep_name: string | null;
  customer_rep_date: string | null;
  work_required: string | null;
  created_at?: string;
  updated_at?: string;
  materials: MaterialRecord[];
}

export interface WorkOrderInput extends WorkOrderTechnical {
  document_name?: string;
  order_number?: string;
  date?: string;
  lieu_place?: string;
  ac_type?: string;
  ac_registration?: string;
  airline_customer?: string;
  required_mh?: string;
  customer_rep_name?: string;
  customer_rep_date?: string;
  work_required?: string;
  materials: MaterialRecord[];
}

export type WorkOrderSortKey =
  | "created_at"
  | "date"
  | "order_number"
  | "ac_registration"
  | "global_confidence_score";

export const SORT_LABELS: Record<WorkOrderSortKey, string> = {
  created_at: "Date d'enregistrement",
  date: "Date du CWO",
  order_number: "N° d'ordre",
  ac_registration: "Immatriculation",
  global_confidence_score: "Confiance",
};

export interface DashboardStats {
  total_work_orders: number;
  total_materials_value: number;
  avg_required_mh: number;
  missing_mh_count?: number;
  by_month: [string, number][];
  by_ac_type: [string, number][];
  top_registrations: [string, number][];
  recent: WorkOrderRecord[];
  by_engine?: [string, number][];
  needs_review_count?: number;
  avg_confidence?: number | null;
}

/** Construit l'instantané technique à envoyer au backend lors d'un
 * enregistrement/mise à jour manuel (onglet Export), pour ne PAS écraser
 * les métadonnées techniques auto-enregistrées lors du traitement avec des
 * valeurs vides. */
export function pipelineResultToTechnicalInput(
  result: PipelineResult,
  sourceFile?: string,
  pageIndex?: number,
  pageCount?: number
): WorkOrderTechnical {
  const cc = result.confidence_components;
  return {
    source_file: sourceFile,
    page_index: pageIndex,
    page_count: pageCount,
    engine_used: result.engine_used,
    requires_review: result.requires_review,
    review_reasons: result.review_reasons,
    document_type: result.document_type,
    classification_score: result.classification_score,
    document_detected: result.document_detected,
    document_detection_confidence: result.document_detection_confidence,
    template_aligned: result.template_aligned,
    template_matched: result.template_matched,
    template_match_score: result.template_match_score,
    deskew_angle: result.deskew_angle,
    processing_time_s: result.processing_time_s,
    confidence_ocr: cc.ocr,
    confidence_template: cc.template,
    confidence_rules: cc.rules,
    confidence_llm: cc.llm,
    confidence_llm_used: cc.llm_used,
    global_confidence_score: result.global_confidence_score,
    validation_issues: result.validation_issues,
    llm_validation: result.llm_validation,
    extraction_fields: result.extraction.fields,
  };
}

export interface HoursByWorkRow {
  work_required: string;
  count: number;
  min_mh: number | null;
  max_mh: number | null;
  avg_mh: number | null;
  example_order_numbers: string[];
  example_texts: string[];
}

export interface HoursByWorkStats {
  rows: HoursByWorkRow[];
  overall: {
    count: number;
    min_mh: number | null;
    max_mh: number | null;
    avg_mh: number | null;
  };
}

export interface HoursAnomaly {
  id: number;
  order_number: string | null;
  date: string | null;
  ac_registration: string | null;
  work_required: string | null;
  category: string;
  required_mh: number;
  group_avg_mh: number;
  group_size: number;
  z_score: number;
  direction: "au-dessus" | "en-dessous";
}

export interface PriceMaterialItem {
  id: number;
  qty: string | null;
  designation: string | null;
  reference: string | null;
  price: number;
  price_raw: string | null;
  date: string | null;
  ac_type: string | null;
  ac_registration: string | null;
  order_number: string | null;
  iso_date: string | null;
}

export interface PriceStats {
  n_items: number;
  total_value: number;
  avg_price: number;
  max_item: PriceMaterialItem | null;
  min_item: PriceMaterialItem | null;
  by_month: { month: string; count: number; total: number }[];
  top_designations: { designation: string; count: number; total: number }[];
  by_ac_type: { ac_type: string; total: number }[];
  month_avg_trend: { month: string; avg: number }[];
  trend_pct: number | null;
}

export interface PriceAnalysis {
  stats: PriceStats;
  report: string;
  generated_by: "huggingface" | "ollama" | "template";
  items: PriceMaterialItem[];
}

export interface HoursComparison {
  category: string;
  doc_mh: number | null;
  group_count: number;
  avg_mh: number | null;
  min_mh: number | null;
  max_mh: number | null;
  delta_pct: number | null;
}

export interface DocumentReport {
  report: string;
  generated_by: "huggingface" | "ollama" | "template";
  hours_comparison: HoursComparison | null;
}

/** Reconstruit un PipelineResult "à l'identique" à partir d'un WorkOrderRecord
 * persisté en base, pour réutiliser les mêmes composants d'affichage
 * (données extraites complètes / informations techniques) que ceux utilisés
 * pour un document fraîchement traité en session. */
export function workOrderToPipelineResult(wo: WorkOrderRecord): PipelineResult {
  return {
    engine_used: wo.engine_used ?? "inconnu",
    requires_review: !!wo.requires_review,
    review_reasons: wo.review_reasons ?? [],
    document_type: wo.document_type ?? "sabena_customer_work_order",
    classification_score: wo.classification_score ?? 0,
    document_detected: wo.document_detected ?? true,
    document_detection_confidence: wo.document_detection_confidence ?? 0,
    template_aligned: wo.template_aligned ?? false,
    template_matched: wo.template_matched ?? false,
    template_match_score: wo.template_match_score ?? 0,
    deskew_angle: wo.deskew_angle ?? 0,
    extraction: {
      document_type: wo.document_type ?? "sabena_customer_work_order",
      fields: wo.extraction_fields ?? {},
      material_sold: wo.materials.map((m) => ({
        qty: m.qty,
        designation: m.designation,
        reference: m.reference,
        price: m.price,
        price_raw: m.price_raw,
      })),
    },
    validation_issues: wo.validation_issues ?? [],
    llm_validation: wo.llm_validation ?? { used_llm: false, confidence_score: 0, issues: [] },
    confidence_components: {
      ocr: wo.confidence_ocr ?? 0,
      template: wo.confidence_template ?? 0,
      rules: wo.confidence_rules ?? 0,
      llm: wo.confidence_llm ?? null,
      llm_used: !!wo.confidence_llm_used,
      global: wo.global_confidence_score ?? 0,
    },
    global_confidence_score: wo.global_confidence_score ?? 0,
    processing_time_s: wo.processing_time_s ?? 0,
  };
}

export const ENGINE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  claude: "Claude",
  ollama: "Ollama (local)",
  local_ocr: "OCR local (TrOCR / Tesseract)",
  local_ocr_fallback: "OCR local — repli auto",
};
