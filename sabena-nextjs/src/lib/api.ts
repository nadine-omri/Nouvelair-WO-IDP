import {
  DashboardStats,
  DocumentReport,
  HoursByWorkStats,
  HoursAnomaly,
  PipelineResult,
  PriceAnalysis,
  ProcessedDocument,
  WorkOrderInput,
  WorkOrderRecord,
  WorkOrderSortKey,
} from "./types";
import {
  mockCreateWorkOrder,
  mockDashboardStats,
  mockDocumentReport,
  mockHoursByWorkStats,
  mockHoursAnomalies,
  mockPipelineResult,
  mockPriceAnalysis,
  mockSearchWorkOrders,
  mockUpdateMaterials,
  mockUpdateWorkOrder,
} from "./mock";

// URL du backend FastAPI qui enveloppe le pipeline Python existant
// (voir api_server.py fourni à la racine du projet Python).
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ProcessOptions {
  alignTemplate: boolean;
  useVision: boolean;
}

/**
 * Traite un document via le backend Python réel s'il est joignable.
 * Retourne TOUJOURS un tableau de pages : 1 seule pour une image, N pour un
 * PDF contenant N ordres de travail (chaque page est traitée séparément
 * côté backend). Si le backend n'est pas démarré (dev sans Python, démo UI),
 * on retombe sur des données simulées pour ne jamais bloquer l'interface.
 */
// Une "page" telle que renvoyée par /api/process : le PipelineResult, plus
// les métadonnées d'origine ajoutées par le backend (persistance auto).
type ProcessedPage = PipelineResult & {
  db_id?: number | null;
  source_file?: string;
  page_index?: number;
  page_count?: number;
};

export async function processDocumentPages(
  file: File,
  options: ProcessOptions,
  onDemoFallback?: () => void
): Promise<ProcessedPage[]> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("align_template", String(options.alignTemplate));
    formData.append("use_vision", String(options.useVision));

    const res = await fetch(`${API_URL}/api/process`, {
      method: "POST",
      body: formData,
      // Un PDF multi-pages peut prendre nettement plus de temps qu'une image.
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      throw new Error(`Backend a répondu ${res.status}`);
    }
    const data = await res.json();
    const pages: ProcessedPage[] = Array.isArray(data?.pages) ? data.pages : [data];
    if (pages.length === 0) {
      throw new Error("Le backend n'a retourné aucune page");
    }
    return pages;
  } catch (err) {
    // Backend Python indisponible (ex: pas encore lancé) -> mode démo
    onDemoFallback?.();
    return [{ ...mockPipelineResult(file.name), db_id: null, source_file: file.name, page_index: 1, page_count: 1 }];
  }
}

/**
 * Traite tous les fichiers et retourne une entrée par page (1 image = 1
 * page = 1 WO ; 1 PDF de N scans = N pages = N WO séparés). Chaque page est
 * déjà automatiquement enregistrée en base côté backend (voir
 * /api/process) : `dbId` référence cette ligne pour permettre ensuite une
 * mise à jour (correction manuelle, export) plutôt qu'une nouvelle
 * création.
 */
export async function processAll(
  files: File[],
  options: ProcessOptions,
  onProgress?: (done: number, total: number, currentName: string) => void,
  onDemoFallback?: () => void
): Promise<ProcessedDocument[]> {
  const out: ProcessedDocument[] = [];
  let usedDemo = false;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.(i, files.length, f.name);
    const pages = await processDocumentPages(f, options, () => {
      usedDemo = true;
    });
    const pageCount = pages.length;
    pages.forEach((page, pageIdx) => {
      const { db_id, source_file, page_index, page_count, ...result } = page;
      out.push({
        name: pageCount === 1 ? f.name : `${f.name} — page ${pageIdx + 1}/${pageCount}`,
        result,
        dbId: db_id ?? null,
        sourceFile: source_file ?? f.name,
        pageIndex: page_index ?? pageIdx + 1,
        pageCount: page_count ?? pageCount,
      });
    });
  }
  onProgress?.(files.length, files.length, "");
  if (usedDemo) onDemoFallback?.();
  return out;
}

// --------------------------------------------------------------------------
// Base de données des ordres de travail (Work Orders) + matériaux vendus
// --------------------------------------------------------------------------

export async function saveWorkOrder(
  input: WorkOrderInput,
  onDemoFallback?: () => void
): Promise<WorkOrderRecord> {
  try {
    const res = await fetch(`${API_URL}/api/work-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as WorkOrderRecord;
  } catch {
    onDemoFallback?.();
    return mockCreateWorkOrder(input);
  }
}

export async function updateWorkOrder(
  id: number,
  input: WorkOrderInput,
  onDemoFallback?: () => void
): Promise<WorkOrderRecord | null> {
  try {
    const res = await fetch(`${API_URL}/api/work-orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as WorkOrderRecord;
  } catch {
    onDemoFallback?.();
    return mockUpdateWorkOrder(id, input);
  }
}

export async function updateWorkOrderMaterials(
  id: number,
  materials: WorkOrderRecord["materials"],
  onDemoFallback?: () => void
): Promise<WorkOrderRecord | null> {
  try {
    const res = await fetch(`${API_URL}/api/work-orders/${id}/materials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(materials),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as WorkOrderRecord;
  } catch {
    onDemoFallback?.();
    return mockUpdateMaterials(id, materials);
  }
}

export async function getWorkOrder(
  id: number,
  onDemoFallback?: () => void
): Promise<WorkOrderRecord | null> {
  try {
    const res = await fetch(`${API_URL}/api/work-orders/${id}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as WorkOrderRecord;
  } catch {
    onDemoFallback?.();
    return null;
  }
}

export interface SearchWorkOrdersParams {
  dateFrom?: string;
  dateTo?: string;
  acRegistration?: string;
  q?: string;
  sourceFile?: string;
  sortBy?: WorkOrderSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
}

export async function searchWorkOrders(
  params: SearchWorkOrdersParams,
  onDemoFallback?: () => void
): Promise<WorkOrderRecord[]> {
  try {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set("date_from", params.dateFrom);
    if (params.dateTo) qs.set("date_to", params.dateTo);
    if (params.acRegistration) qs.set("ac_registration", params.acRegistration);
    if (params.q) qs.set("q", params.q);
    if (params.sourceFile) qs.set("source_file", params.sourceFile);
    if (params.sortBy) qs.set("order_by", params.sortBy);
    if (params.sortDir) qs.set("order_dir", params.sortDir);
    if (params.limit) qs.set("limit", String(params.limit));
    const res = await fetch(`${API_URL}/api/work-orders?${qs.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as WorkOrderRecord[];
  } catch {
    onDemoFallback?.();
    return mockSearchWorkOrders(params);
  }
}

// --------------------------------------------------------------------------
// Dashboard (statistiques agrégées, toutes sessions confondues)
// --------------------------------------------------------------------------

export async function fetchDashboardStats(
  onDemoFallback?: () => void
): Promise<DashboardStats> {
  try {
    const res = await fetch(`${API_URL}/api/dashboard`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as DashboardStats;
  } catch {
    onDemoFallback?.();
    return mockDashboardStats();
  }
}

/** Marge des heures (MH requis) selon le travail demandé : count + min/max/
 * moyenne de MH par libellé de travaux, calculée sur tous les CWO en base. */
export async function fetchHoursByWork(
  query?: string,
  onDemoFallback?: () => void
): Promise<HoursByWorkStats> {
  try {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    const res = await fetch(`${API_URL}/api/stats/hours-by-work?${qs.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as HoursByWorkStats;
  } catch {
    onDemoFallback?.();
    return mockHoursByWorkStats(query);
  }
}

/** CWO dont le MH requis s'écarte fortement de la moyenne de leur catégorie
 * de travaux (détection d'anomalies, regroupement par mots-clés locaux). */
export async function fetchHoursAnomalies(
  onDemoFallback?: () => void
): Promise<HoursAnomaly[]> {
  try {
    const res = await fetch(`${API_URL}/api/stats/anomalies`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as HoursAnomaly[];
  } catch {
    onDemoFallback?.();
    return mockHoursAnomalies();
  }
}

/** Statistiques + rapport IA sur les matériaux vendus/facturés, filtrable
 * par période (jj/mm/aaaa, bornes incluses). Voir /api/price-analysis
 * (api_server.py) et app/analysis/price_analyzer.py. */
export async function fetchPriceAnalysis(
  params: { dateFrom?: string; dateTo?: string },
  onDemoFallback?: () => void
): Promise<PriceAnalysis> {
  try {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set("date_from", params.dateFrom);
    if (params.dateTo) qs.set("date_to", params.dateTo);
    const res = await fetch(`${API_URL}/api/price-analysis?${qs.toString()}`, {
      // Le rapport passe par un LLM (Hugging Face/Ollama) : peut prendre
      // plus de temps qu'un simple appel de stats.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as PriceAnalysis;
  } catch {
    onDemoFallback?.();
    return mockPriceAnalysis(params);
  }
}

/** Rapport IA en langage naturel pour UN document déjà traité (résumé,
 * points d'attention, comparaison M/H) — voir /api/document-report
 * (api_server.py) et app/analysis/document_report.py. */
export async function fetchDocumentReport(
  result: PipelineResult,
  onDemoFallback?: () => void
): Promise<DocumentReport> {
  const fields = Object.fromEntries(
    Object.entries(result.extraction.fields).map(([k, v]) => [k, v.value])
  );
  const body = {
    fields,
    materials: result.extraction.material_sold,
    validation_issues: result.validation_issues,
    llm_issues: result.llm_validation.issues,
  };
  try {
    const res = await fetch(`${API_URL}/api/document-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Appel LLM (Hugging Face/Ollama) : peut prendre plus de temps qu'un
      // simple appel de stats.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as DocumentReport;
  } catch {
    onDemoFallback?.();
    return mockDocumentReport(result);
  }
}
