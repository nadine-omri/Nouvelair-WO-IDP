import { DashboardStats, PriceAnalysis, PipelineResult, ProcessedDocument, WorkOrderInput, WorkOrderRecord } from "./types";
import {
  mockCreateWorkOrder,
  mockDashboardStats,
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
export async function processDocumentPages(
  file: File,
  options: ProcessOptions,
  onDemoFallback?: () => void
): Promise<PipelineResult[]> {
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
    const pages: PipelineResult[] = Array.isArray(data?.pages) ? data.pages : [data];
    if (pages.length === 0) {
      throw new Error("Le backend n'a retourné aucune page");
    }
    return pages;
  } catch (err) {
    // Backend Python indisponible (ex: pas encore lancé) -> mode démo
    onDemoFallback?.();
    return [mockPipelineResult(file.name)];
  }
}

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
    if (pages.length === 1) {
      const result = pages[0];
      out.push({
        name: f.name,
        result,
        persisted_work_order_id: result._persisted_work_order_id,
        source_file: result._source_file,
        source_page: result._source_page,
        source_total_pages: result._source_total_pages,
      });
    } else {
      // PDF contenant plusieurs ordres de travail : une entrée par page.
      pages.forEach((result, pageIdx) => {
        out.push({
          name: `${f.name} — page ${pageIdx + 1}/${pages.length}`,
          result,
          persisted_work_order_id: result._persisted_work_order_id,
          source_file: result._source_file,
          source_page: result._source_page,
          source_total_pages: result._source_total_pages,
        });
      });
    }
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

export async function fetchHistory(
  onDemoFallback?: () => void
): Promise<WorkOrderRecord[]> {
  try {
    const res = await fetch(`${API_URL}/api/work-orders/history?limit=500`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as WorkOrderRecord[];
  } catch {
    onDemoFallback?.();
    return [];
  }
}

export async function fetchWorkOrderTechnical(
  id: number,
  onDemoFallback?: () => void
) {
  try {
    const res = await fetch(`${API_URL}/api/work-orders/${id}/technical`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return await res.json();
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

// --------------------------------------------------------------------------
// Analyse des prix (IA) — statistiques + rapport LLM sur une période
// --------------------------------------------------------------------------

export interface PriceAnalysisParams {
  dateFrom?: string; // jj/mm/aaaa
  dateTo?: string; // jj/mm/aaaa
}

export async function fetchPriceAnalysis(
  params: PriceAnalysisParams,
  onDemoFallback?: () => void
): Promise<PriceAnalysis> {
  try {
    const qs = new URLSearchParams();
    if (params.dateFrom) qs.set("date_from", params.dateFrom);
    if (params.dateTo) qs.set("date_to", params.dateTo);
    const res = await fetch(`${API_URL}/api/analysis/prices?${qs.toString()}`, {
      // Le rapport LLM peut prendre du temps (Hugging Face + repli Ollama) ;
      // le backend a ses propres timeouts internes (~20s HF + ~15s Ollama),
      // on laisse une marge confortable ici.
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Backend a répondu ${res.status}`);
    return (await res.json()) as PriceAnalysis;
  } catch {
    onDemoFallback?.();
    return mockPriceAnalysis(params);
  }
}
