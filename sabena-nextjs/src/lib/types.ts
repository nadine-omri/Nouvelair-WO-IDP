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
  _persisted_work_order_id?: number;
  _source_file?: string;
  _source_page?: number;
  _source_total_pages?: number;
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
  persisted_work_order_id?: number;
  source_file?: string;
  source_page?: number;
  source_total_pages?: number;
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

export interface WorkOrderRecord {
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
  source_file?: string | null;
  source_page?: number | null;
  source_total_pages?: number | null;
  engine_used?: string | null;
  global_confidence?: number | null;
  processing_time_s?: number | null;
  technical_json?: string | null;
  extraction_json?: string | null;
}

export interface WorkOrderInput {
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

export interface DashboardStats {
  total_work_orders: number;
  total_materials_value: number;
  avg_required_mh: number;
  by_month: [string, number][];
  by_ac_type: [string, number][];
  top_registrations: [string, number][];
  recent: WorkOrderRecord[];
}

// --------------------------------------------------------------------------
// Analyse des prix (IA) — onglet "Analyse des prix"
// --------------------------------------------------------------------------

export interface PriceAnalysisItem {
  date: string | null;
  iso_date: string | null;
  order_number: string | null;
  ac_registration: string | null;
  ac_type: string | null;
  airline_customer: string | null;
  designation: string;
  reference: string | null;
  qty: string | null;
  price: number;
}

export interface PriceMonthPoint {
  month: string; // "YYYY-MM" ou "Date inconnue"
  count: number;
  total: number;
}

export interface PriceMonthAvgPoint {
  month: string;
  avg: number;
}

export interface PriceDesignationStat {
  designation: string;
  count: number;
  total: number;
}

export interface PriceAcTypeStat {
  ac_type: string;
  total: number;
}

export interface PriceStats {
  n_items: number;
  total_value: number;
  avg_price: number;
  max_item: PriceAnalysisItem | null;
  min_item: PriceAnalysisItem | null;
  by_month: PriceMonthPoint[];
  top_designations: PriceDesignationStat[];
  by_ac_type: PriceAcTypeStat[];
  month_avg_trend: PriceMonthAvgPoint[];
  trend_pct: number | null;
}

export interface PriceAnalysis {
  stats: PriceStats;
  report: string; // Markdown généré par le LLM (ou fallback template)
  generated_by: "huggingface" | "ollama" | "template";
  items: PriceAnalysisItem[];
}

export const ENGINE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  claude: "Claude",
  ollama: "Ollama (local)",
  local_ocr: "OCR local (TrOCR / Tesseract)",
  local_ocr_fallback: "OCR local — repli auto",
};
