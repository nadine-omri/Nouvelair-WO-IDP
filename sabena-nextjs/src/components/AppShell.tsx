"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ExtractionPreviewTab from "@/components/tabs/ExtractionPreviewTab";
import ManualCorrectionTab from "@/components/tabs/ManualCorrectionTab";
import ExportTab from "@/components/tabs/ExportTab";
import MaterialsTab from "@/components/tabs/MaterialsTab";
import SearchTab from "@/components/tabs/SearchTab";
import DashboardTab from "@/components/tabs/DashboardTab";
import PriceAnalysisTab from "@/components/tabs/PriceAnalysisTab";
import TechnicalTab from "@/components/tabs/TechnicalTab";
import { processAll, fetchHistory } from "@/lib/api";
import { buildInitDataFromOcr } from "@/lib/validation";
import { loadSession, saveSession, clearSession } from "@/lib/persistence";
import { ManualData, MaterialRow, ProcessedDocument, ValidationTuple, WorkOrderRecord } from "@/lib/types";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "search", label: "Historique des WO" },
  { key: "price-analysis", label: "Analyse des prix (IA)" },
  { key: "preview", label: "Données extraites" },
  { key: "correction", label: "Correction manuelle" },
  { key: "materials", label: "Matériaux & prix" },
  { key: "export", label: "Export final" },
  { key: "technical", label: "Informations techniques" },
] as const;

const NO_DOC_REQUIRED: readonly string[] = ["dashboard", "search", "price-analysis"];
/** Onglets du groupe "Traitement du document" (grisés dans la sidebar tant
 * qu'aucun document n'est chargé/sélectionné). */
const DOC_REQUIRED_NAV_TABS: readonly string[] = [
  "preview",
  "correction",
  "materials",
  "export",
  "technical",
];

type TabKey = (typeof TABS)[number]["key"];

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
  const hydrated = useRef(false);

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
    // La BDD devient la source de vérité pour l'historique : après fermeture
    // de l'application, les WO traités restent retrouvables.
    fetchHistory(( ) => setDemoMode(true)).then((history) => {
      if (!history.length) return;
      setDocs((current) => {
        if (current.length) return current;
        return history.map((wo) => {
          let technical: any = {};
          let extraction: any = { fields: {}, material_sold: wo.materials || [] };
          try { technical = wo.technical_json ? JSON.parse(wo.technical_json) : {}; } catch {}
          try { extraction = wo.extraction_json ? JSON.parse(wo.extraction_json) : extraction; } catch {}
          const result: any = {
            ...technical,
            engine_used: wo.engine_used || technical.engine_used || "local_ocr",
            global_confidence_score: technical.global_confidence_score ?? wo.global_confidence ?? 0,
            processing_time_s: technical.processing_time_s ?? wo.processing_time_s ?? 0,
            extraction,
            requires_review: technical.requires_review ?? false,
            review_reasons: technical.review_reasons ?? [],
            document_type: technical.document_type ?? "work_order",
            classification_score: technical.classification_score ?? 0,
            document_detected: technical.document_detected ?? true,
            document_detection_confidence: technical.document_detection_confidence ?? 0,
            template_aligned: technical.template_aligned ?? false,
            template_matched: technical.template_matched ?? false,
            template_match_score: technical.template_match_score ?? 0,
            deskew_angle: technical.deskew_angle ?? 0,
            validation_issues: technical.validation_issues ?? [],
            llm_validation: technical.llm_validation ?? { used_llm: false, confidence_score: 0, issues: [] },
            confidence_components: technical.confidence_components ?? { ocr: 0, template: 0, rules: 0, llm: null, llm_used: false, global: 0 },
          };
          return {
            name: wo.source_page && wo.source_total_pages && wo.source_total_pages > 1
              ? `${wo.document_name || "document"} — page ${wo.source_page}/${wo.source_total_pages}`
              : (wo.document_name || `WO ${wo.order_number || wo.id}`),
            result,
            persisted_work_order_id: wo.id,
            source_file: wo.source_file || wo.document_name || undefined,
            source_page: wo.source_page || 1,
            source_total_pages: wo.source_total_pages || 1,
          } as ProcessedDocument;
        });
      });
    }).finally(() => { hydrated.current = true; });
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
      setDocs(results);
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
      setManualStore(nextManual);
      setIssuesStore(nextIssues);
      setMaterialsStore(nextMaterials);
      setSavedRecordStore(nextSaved);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <div className="hidden w-[300px] shrink-0 border-r border-violet-100/70 lg:block">
        <Sidebar
          files={files}
          onFilesChange={setFiles}
          alignTemplate={alignTemplate}
          onAlignTemplateChange={setAlignTemplate}
          useVision={useVision}
          onUseVisionChange={setUseVision}
          onProcess={handleProcess}
          processing={processing}
          progress={progress}
          activeTab={activeTab}
          onNavigate={(tab) => setActiveTab(tab as TabKey)}
          docRequiredTabs={DOC_REQUIRED_NAV_TABS}
          hasDocs={docs.length > 0}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-violet-100/70 px-6 py-5 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-violet-400 text-white shadow-glow">
              <PlaneIcon />
            </div>
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

        {/* Sidebar mobile inline (au-dessus du contenu sur petit écran) */}
        <div className="border-b border-violet-100/70 lg:hidden">
          <Sidebar
            files={files}
            onFilesChange={setFiles}
            alignTemplate={alignTemplate}
            onAlignTemplateChange={setAlignTemplate}
            useVision={useVision}
            onUseVisionChange={setUseVision}
            onProcess={handleProcess}
            processing={processing}
            progress={progress}
            activeTab={activeTab}
            onNavigate={(tab) => setActiveTab(tab as TabKey)}
            docRequiredTabs={DOC_REQUIRED_NAV_TABS}
            hasDocs={docs.length > 0}
          />
        </div>

        <main className="flex-1 overflow-y-auto scrollbar-thin px-6 py-6 lg:px-10">
          {docs.length === 0 && !NO_DOC_REQUIRED.includes(activeTab) ? (
            <EmptyState
              hasFiles={files.length > 0}
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

              {docs.length > 0 && (
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
                  </div>
                  {!sessionRestored && (
                    <button
                      onClick={handleNewSession}
                      className="text-xs font-medium text-violet-400 underline decoration-violet-200 underline-offset-2 hover:text-violet-600"
                    >
                      Effacer la session en cours
                    </button>
                  )}
                </div>
              )}

              {docs.length > 0 && (
                <div className="h-px bg-violet-100" />
              )}

              {activeTab === "dashboard" && (
                <DashboardTab onDemoFallback={() => setDemoMode(true)} />
              )}

              {activeTab === "search" && <SearchTab onDemoFallback={() => setDemoMode(true)} />}

              {activeTab === "price-analysis" && (
                <PriceAnalysisTab onDemoFallback={() => setDemoMode(true)} />
              )}

              {activeTab !== "search" &&
                activeTab !== "dashboard" &&
                activeTab !== "price-analysis" &&
                selected && (
                <div key={`${selected.name}-${activeTab}`}>
                  {activeTab === "preview" && <ExtractionPreviewTab result={selected.result} />}
                  {activeTab === "technical" && <TechnicalTab result={selected.result} />}
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
                      result={selected.result}
                      manualData={manualStore[selected.name] ?? buildInitDataFromOcr(selected.result)}
                      issues={issuesStore[selected.name] ?? []}
                      materials={
                        materialsStore[selected.name] ?? selected.result.extraction.material_sold
                      }
                      onDemoFallback={() => setDemoMode(true)}
                      savedRecord={savedRecordStore[selected.name] ?? null}
                      existingId={selected.persisted_work_order_id}
                      onSaved={(record) =>
                        setSavedRecordStore((s) => ({ ...s, [selected.name]: record }))
                      }
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
  onOpenSearch,
  onOpenDashboard,
}: {
  hasFiles: boolean;
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
          {hasFiles ? "Prêt à traiter tes documents" : "Aucun document chargé"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-violet-400">
          {hasFiles
            ? "Clique sur « Traiter les documents » dans le panneau de gauche pour lancer le pipeline."
            : "Charge un ou plusieurs documents dans le panneau de gauche, puis lance le traitement."}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
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
