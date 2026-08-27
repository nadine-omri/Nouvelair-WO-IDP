import { ManualData, MaterialRow, ProcessedDocument, ValidationTuple, WorkOrderRecord } from "./types";

/**
 * Persiste la session de travail EN COURS (documents traités, corrections,
 * matériaux, options) dans le navigateur, pour ne pas tout perdre lors d'un
 * simple rafraîchissement de page.
 *
 * Ceci est complémentaire à la vraie base de données côté backend
 * (data/sabena_wo.db) : la base garde les WO explicitement "Enregistrés"
 * (bouton dans l'onglet Export), potentiellement pour toujours et partagés
 * entre postes. Cette persistance locale garde, elle, le travail en cours
 * de traitement/correction — avant même l'enregistrement en base — pour que
 * F5 ne fasse pas tout disparaître.
 */
const KEY = "sabena_idp_session_v1";

export interface PersistedSession {
  docs: ProcessedDocument[];
  selectedDoc: string | null;
  manualStore: Record<string, ManualData>;
  issuesStore: Record<string, ValidationTuple[]>;
  materialsStore: Record<string, MaterialRow[]>;
  savedRecordStore: Record<string, WorkOrderRecord | null>;
  alignTemplate: boolean;
  useVision: boolean;
  savedAt: string;
}

export function loadSession(): PersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export function saveSession(data: Omit<PersistedSession, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...data, savedAt: new Date().toISOString() })
    );
  } catch {
    // Quota dépassé ou stockage bloqué (navigation privée) -> on ignore
    // silencieusement, ce n'est pas bloquant pour l'utilisation de l'app.
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
