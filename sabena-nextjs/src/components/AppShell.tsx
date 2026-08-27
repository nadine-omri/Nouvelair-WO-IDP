"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar, { NavIcons, NavItem } from "@/components/Sidebar";
import ImportTab from "@/components/tabs/ImportTab";
import ExtractionPreviewTab from "@/components/tabs/ExtractionPreviewTab";
import TechnicalInfoTab from "@/components/tabs/TechnicalInfoTab";
import ManualCorrectionTab from "@/components/tabs/ManualCorrectionTab";
import ExportTab from "@/components/tabs/ExportTab";
import AnalysisTab from "@/components/tabs/AnalysisTab";
import MaterialsTab from "@/components/tabs/MaterialsTab";
import SearchTab from "@/components/tabs/SearchTab";
import StatisticsTab from "@/components/tabs/StatisticsTab";
import DashboardTab from "@/components/tabs/DashboardTab";
import { getWorkOrder, processAll, searchWorkOrders } from "@/lib/api";
import { buildInitDataFromOcr } from "@/lib/validation";
import { loadSession, saveSession, clearSession } from "@/lib/persistence";
import {
  ManualData,
  MaterialRow,
  ProcessedDocument,
  ValidationTuple,
  WorkOrderRecord,
  workOrderToPipelineResult,
} from "@/lib/types";

const NAV_GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [{ key: "dashboard", label: "Dashboard", icon: NavIcons.dashboard }],
  },
  {
    title: "Traitement",
    items: [
      { key: "import", label: "Importer & traiter", icon: NavIcons.import },
      { key: "preview", label: "Données extraites", icon: NavIcons.extraction },
      { key: "technical", label: "Informations techniques", icon: NavIcons.technical },
      { key: "correction", label: "Correction manuelle", icon: NavIcons.correction },
      { key: "materials", label: "Matériaux & prix", icon: NavIcons.materials },
      { key: "export", label: "Export final", icon: NavIcons.export },
      { key: "analysis", label: "Analyse", icon: NavIcons.analysis },
    ],
  },
  {
    title: "Base de données",
    items: [
      { key: "search", label: "Recherche (BDD)", icon: NavIcons.search },
      { key: "statistics", label: "Statistiques", icon: NavIcons.statistics },
    ],
  },
];

const NO_DOC_REQUIRED: readonly string[] = ["dashboard", "search", "import", "statistics"];

type TabKey =
  | "dashboard"
  | "import"
  | "preview"
  | "technical"
  | "correction"
  | "materials"
  | "export"
  | "analysis"
  | "search"
  | "statistics";

function recordToProcessedDocument(record: WorkOrderRecord): ProcessedDocument {
  const name = record.document_name || record.source_file || `CWO #${record.id}`;
  return {
    name: `${name} — CWO #${record.id}`,
    result: workOrderToPipelineResult(record),
    dbId: record.id,
    sourceFile: record.source_file ?? record.document_name ?? name,
    pageIndex: record.page_index ?? 1,
    pageCount: record.page_count ?? 1,
  };
}

function mergeDocuments(
  current: ProcessedDocument[],
  incoming: ProcessedDocument[]
): ProcessedDocument[] {
  const byId = new Map<number, ProcessedDocument>();
  const withoutId: ProcessedDocument[] = [];

  for (const doc of current) {
    if (doc.dbId != null) byId.set(doc.dbId, doc);
    else withoutId.push(doc);
  }

  for (const doc of incoming) {
    if (doc.dbId != null) byId.set(doc.dbId, doc);
    else {
      const idx = withoutId.findIndex((d) => d.name === doc.name);
      if (idx >= 0) withoutId[idx] = doc;
      else withoutId.push(doc);
    }
  }

  return [...withoutId, ...Array.from(byId.values())];
}

export default function AppShell() {
  const [files, setFiles] = useState<File[]>([]);
  const [alignTemplate, setAlignTemplate] = useState(true);
  const [useVision, setUseVision] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    currentName: string;
  } | null>(null);
  const [docs, setDocs] = useState<ProcessedDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [demoMode, setDemoMode] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const hydrated = useRef(false);

  // Les documents déjà traités sont persistés côté backend. On les recharge
  // au démarrage pour qu'ils restent sélectionnables dans tous les onglets,
  // même après fermeture du navigateur ou changement de session.
  const loadDatabaseDocuments = async () => {
    try {
      const records = await searchWorkOrders({ limit: 200 });
      const databaseDocs = records.map(recordToProcessedDocument);

      setDocs((current) => mergeDocuments(current, databaseDocs));

      const nextManual: Record<string, ManualData> = {};
      const nextIssues: Record<string, ValidationTuple[]> = {};
      const nextMaterials: Record<string, MaterialRow[]> = {};
      const nextSaved: Record<string, WorkOrderRecord | null> = {};

      for (const record of records) {
        const doc = recordToProcessedDocument(record);
        nextManual[doc.name] = {
          order_number: record.order_number ?? "",
          date: record.date ?? "",
          lieu_place: record.lieu_place ?? "",
          ac_type: record.ac_type ?? "",
          ac_registration: record.ac_registration ?? "",
          airline_customer: record.airline_customer ?? "",
          required_mh: record.required_mh ?? "",
          customer_rep_name: record.customer_rep_name ?? "",
          customer_rep_date: record.customer_rep_date ?? "",
          work_required: record.work_required ?? "",
        };
        nextIssues[doc.name] = record.validation_issues ?? [];
        nextMaterials[doc.name] = doc.result.extraction.material_sold;
        nextSaved[doc.name] = record;
      }

      setManualStore((s) => ({ ...nextManual, ...s }));
      setIssuesStore((s) => ({ ...nextIssues, ...s }));
      setMaterialsStore((s) => ({ ...nextMaterials, ...s }));
      setSavedRecordStore((s) => ({ ...nextSaved, ...s }));
    } catch {
      // Le mode démo / backend indisponible est déjà géré par searchWorkOrders.
    }
  };

  const [manualStore, setManualStore] = useState<Record<string, ManualData>>({});
  const [issuesStore, setIssuesStore] = useState<Record<string, ValidationTuple[]>>({});
  const [materialsStore, setMaterialsStore] = useState<Record<string, MaterialRow[]>>({});
  const [savedRecordStore, setSavedRecordStore] = useState<Record<string, WorkOrderRecord | null>>(
    {}
  );

  // Restaure la session de travail en cours (si une a été sauvegardée dans
  // ce navigateur) au tout premier rendu côté client, pour qu'un simple F5
  // ne fasse pas disparaître le travail non encore enregistré en base.
  useEffect(() => {
    const session = loadSession();
    if (session) {
      setDocs(session.docs);
      setSelectedDoc(session.selectedDoc);
      setManualStore(session.manualStore);
      setIssuesStore(session.issuesStore);
      setMaterialsStore(session.materialsStore);
      setSavedRecordStore(session.savedRecordStore);
      setAlignTemplate(session.alignTemplate);
      setUseVision(session.useVision);
      if (session.docs.length > 0) {
        setActiveTab("preview");
        setSessionRestored(true);
      }
    }
    hydrated.current = true;
    void loadDatabaseDocuments();
  }, []);

  // Sauvegarde automatiquement la session à chaque changement significatif
  // (une fois l'hydratation initiale terminée, pour ne pas écraser une
  // session existante avec l'état vide du tout premier rendu).
  useEffect(() => {
    if (!hydrated.current) return;
    saveSession({
      docs,
      selectedDoc,
      manualStore,
      issuesStore,
      materialsStore,
      savedRecordStore,
      alignTemplate,
      useVision,
    });
  }, [docs, selectedDoc, manualStore, issuesStore, materialsStore, savedRecordStore, alignTemplate, useVision]);

  const handleNewSession = () => {
    clearSession();
    setDocs([]);
    setSelectedDoc(null);
    setManualStore({});
    setIssuesStore({});
    setMaterialsStore({});
    setSavedRecordStore({});
    setFiles([]);
    setSessionRestored(false);
    setActiveTab("dashboard");
    void loadDatabaseDocuments();
  };

  const selected = useMemo(
    () => docs.find((d) => d.name === selectedDoc) ?? null,
    [docs, selectedDoc]
  );

  const handleProcess = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress({ done: 0, total: files.length, currentName: files[0]?.name ?? "" });
    try {
      const results = await processAll(
        files,
        { alignTemplate, useVision },
        (done, total, currentName) => setProgress({ done, total, currentName }),
        () => setDemoMode(true)
      );
      setDocs((current) => mergeDocuments(current, results));
      setSelectedDoc(results[0]?.name ?? null);
      setActiveTab("preview");

      const nextManual: Record<string, ManualData> = {};
      const nextIssues: Record<string, ValidationTuple[]> = {};
      const nextMaterials: Record<string, MaterialRow[]> = {};
      const nextSaved: Record<string, WorkOrderRecord | null> = {};
      for (const d of results) {
        nextManual[d.name] = buildInitDataFromOcr(d.result);
        nextIssues[d.name] = [];
        nextMaterials[d.name] = d.result.extraction.material_sold;
        nextSaved[d.name] = null;
      }
      setManualStore((current) => ({ ...current, ...nextManual }));
      setIssuesStore((current) => ({ ...current, ...nextIssues }));
      setMaterialsStore((current) => ({ ...current, ...nextMaterials }));
      setSavedRecordStore((current) => ({ ...current, ...nextSaved }));

      // Chaque page est déjà automatiquement enregistrée en base côté
      // backend (voir /api/process). On récupère ici l'enregistrement
      // complet pour chaque doc.dbId, pour que "Correction manuelle" /
      // "Export" affichent immédiatement "déjà enregistré (WO #id)" et
      // fassent une mise à jour plutôt qu'une nouvelle création.
      for (const d of results) {
        if (d.dbId == null) continue;
        getWorkOrder(d.dbId).then((record) => {
          if (record) {
            setSavedRecordStore((s) => ({ ...s, [d.name]: record }));
          }
        });
      }
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  const navGroupsWithBadges = useMemo(() => {
    const needsReview = docs.filter((d) => d.result.requires_review).length;
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.map((it) =>
        it.key === "correction" && needsReview > 0 ? { ...it, badge: needsReview } : it
      ),
    }));
  }, [docs]);

  const handleSelectTab = (key: string) => {
    setActiveTab(key as TabKey);
    setMobileNavOpen(false);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <div className="hidden w-[280px] shrink-0 border-r border-violet-100/70 lg:block">
        <Sidebar
          activeKey={activeTab}
          onSelect={handleSelectTab}
          groups={navGroupsWithBadges}
          docCount={docs.length}
          onNewSession={handleNewSession}
        />
      </div>

      {/* Sidebar mobile en overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-violet-950/40" onClick={() => setMobileNavOpen(false)} />
          <div className="relative z-10 h-full w-[280px] bg-white shadow-lift">
            <Sidebar
              activeKey={activeTab}
              onSelect={handleSelectTab}
              groups={navGroupsWithBadges}
              docCount={docs.length}
              onNewSession={handleNewSession}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-violet-100/70 px-6 py-5 lg:px-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-violet-600 ring-1 ring-violet-200 lg:hidden"
              aria-label="Ouvrir la navigation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <div>
              <h1 className="font-display text-lg font-semibold leading-tight text-violet-950">
                IDP — Ordre Client Sabena Technics
              </h1>
              <p className="text-xs text-violet-400">
                Preprocessing → OCR par zone → Extraction → Validation → Analyse
              </p>
            </div>
          </div>
          {demoMode && (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-600 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Mode démo (backend Python non détecté)
            </span>
          )}
        </header>

        <main className="flex-1 overflow-y-auto scrollbar-thin px-6 py-6 lg:px-10">
          {docs.length === 0 && !NO_DOC_REQUIRED.includes(activeTab) ? (
            <EmptyState
              hasFiles={files.length > 0}
              onOpenImport={() => setActiveTab("import")}
              onOpenSearch={() => setActiveTab("search")}
              onOpenDashboard={() => setActiveTab("dashboard")}
            />
          ) : (
            <div className="mx-auto flex max-w-5xl flex-col gap-6">
              {sessionRestored && (
                <div className="animate-fade-up flex items-center justify-between gap-3 rounded-xl bg-violet-50 px-4 py-2.5 text-xs text-violet-600 ring-1 ring-violet-100">
                  <span>
                    ↺ Session de travail restaurée (elle avait été sauvegardée automatiquement
                    dans ce navigateur).
                  </span>
                  <button
                    onClick={handleNewSession}
                    className="shrink-0 font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
                  >
                    Démarrer une nouvelle session
                  </button>
                </div>
              )}

              {docs.length > 0 && !NO_DOC_REQUIRED.includes(activeTab) && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs font-semibold text-violet-500">Document</label>
                    <select
                      value={selectedDoc ?? ""}
                      onChange={(e) => setSelectedDoc(e.target.value)}
                      className="rounded-xl border border-violet-100 bg-white/80 px-3.5 py-2 text-sm font-medium text-violet-900 shadow-sm transition-all focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
                    >
                      {docs.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void loadDatabaseDocuments()}
                      className="rounded-xl border border-violet-200 bg-white/70 px-3 py-2 text-xs font-semibold text-violet-600 transition-all hover:bg-violet-50"
                      title="Recharger les documents déjà traités depuis la base"
                    >
                      ↻ Recharger la BDD
                    </button>
                    {selected && selected.pageCount > 1 && (
                      <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-600">
                        Page {selected.pageIndex}/{selected.pageCount} de {selected.sourceFile}
                      </span>
                    )}
                    {selected && savedRecordStore[selected.name] && (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        ✓ Enregistré (CWO #{savedRecordStore[selected.name]?.id})
                      </span>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "dashboard" && (
                <DashboardTab
                  onDemoFallback={() => setDemoMode(true)}
                  onOpenStatistics={() => setActiveTab("statistics")}
                />
              )}

              {activeTab === "import" && (
                <ImportTab
                  files={files}
                  onFilesChange={setFiles}
                  alignTemplate={alignTemplate}
                  onAlignTemplateChange={setAlignTemplate}
                  useVision={useVision}
                  onUseVisionChange={setUseVision}
                  onProcess={handleProcess}
                  processing={processing}
                  progress={progress}
                />
              )}

              {activeTab === "search" && <SearchTab onDemoFallback={() => setDemoMode(true)} />}

              {activeTab === "statistics" && (
                <StatisticsTab onDemoFallback={() => setDemoMode(true)} docs={docs} />
              )}

              {!NO_DOC_REQUIRED.includes(activeTab) && selected && (
                <div key={`${selected.name}-${activeTab}`}>
                  {activeTab === "preview" && <ExtractionPreviewTab result={selected.result} />}
                  {activeTab === "technical" && (
                    <TechnicalInfoTab
                      result={selected.result}
                      sourceFile={selected.sourceFile}
                      pageIndex={selected.pageIndex}
                      pageCount={selected.pageCount}
                    />
                  )}
                  {activeTab === "correction" && (
                    <ManualCorrectionTab
                      docKey={selected.name}
                      result={selected.result}
                      manualData={manualStore[selected.name] ?? buildInitDataFromOcr(selected.result)}
                      onManualDataChange={(d) =>
                        setManualStore((s) => ({ ...s, [selected.name]: d }))
                      }
                      issues={issuesStore[selected.name] ?? []}
                      onIssuesChange={(iss) =>
                        setIssuesStore((s) => ({ ...s, [selected.name]: iss }))
                      }
                    />
                  )}
                  {activeTab === "materials" && (
                    <MaterialsTab
                      materials={
                        materialsStore[selected.name] ?? selected.result.extraction.material_sold
                      }
                      onChange={(m) =>
                        setMaterialsStore((s) => ({ ...s, [selected.name]: m }))
                      }
                    />
                  )}
                  {activeTab === "export" && (
                    <ExportTab
                      docName={selected.name}
                      sourceFile={selected.sourceFile}
                      pageIndex={selected.pageIndex}
                      pageCount={selected.pageCount}
                      result={selected.result}
                      manualData={manualStore[selected.name] ?? buildInitDataFromOcr(selected.result)}
                      issues={issuesStore[selected.name] ?? []}
                      materials={
                        materialsStore[selected.name] ?? selected.result.extraction.material_sold
                      }
                      onDemoFallback={() => setDemoMode(true)}
                      savedRecord={savedRecordStore[selected.name] ?? null}
                      onSaved={(record) =>
                        setSavedRecordStore((s) => ({ ...s, [selected.name]: record }))
                      }
                    />
                  )}
                  {activeTab === "analysis" && (
                    <AnalysisTab
                      docs={docs}
                      selectedDoc={selectedDoc}
                      onSelectDoc={setSelectedDoc}
                      onDemoFallback={() => setDemoMode(true)}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyState({
  hasFiles,
  onOpenImport,
  onOpenSearch,
  onOpenDashboard,
}: {
  hasFiles: boolean;
  onOpenImport: () => void;
  onOpenSearch: () => void;
  onOpenDashboard: () => void;
}) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-violet-300/50" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-violet-400 text-white shadow-glow">
          <PlaneIcon size={26} />
        </div>
      </div>
      <div>
        <p className="font-display text-lg font-semibold text-violet-900">
          {hasFiles ? "Prêt à traiter tes documents" : "Aucun document en session"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-violet-400">
          {hasFiles
            ? "Ouvre « Importer & traiter » pour lancer le pipeline sur les fichiers déjà sélectionnés."
            : "Va dans « Importer & traiter » pour charger un ou plusieurs documents (images ou PDF)."}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={onOpenImport}
          className="shine rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2 text-sm font-semibold text-white shadow-glow transition-all hover:from-violet-700 hover:to-violet-600"
        >
          📥 Importer des documents
        </button>
        <button
          onClick={onOpenDashboard}
          className="rounded-xl border border-violet-200 bg-white/70 px-4 py-2 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50"
        >
          📊 Voir le dashboard
        </button>
        <button
          onClick={onOpenSearch}
          className="rounded-xl border border-violet-200 bg-white/70 px-4 py-2 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50"
        >
          🔎 Consulter la base des ordres de travail
        </button>
      </div>
    </div>
  );
}

function PlaneIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12l18-8-6 8 6 8-18-8zm0 0h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
