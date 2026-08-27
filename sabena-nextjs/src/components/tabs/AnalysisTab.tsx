"use client";

import { useEffect, useState } from "react";
import { DocumentReport, ProcessedDocument } from "@/lib/types";
import { downloadCSV, downloadTablePdf } from "@/lib/export";
import { fetchDocumentReport } from "@/lib/api";
import MarkdownReport from "@/components/MarkdownReport";

const GENERATED_BY_LABELS: Record<DocumentReport["generated_by"], string> = {
  huggingface: "Rapport généré par Hugging Face",
  ollama: "Rapport généré par Ollama (local)",
  template: "Résumé automatique (LLM indisponible)",
};

export default function AnalysisTab({
  docs,
  selectedDoc,
  onSelectDoc,
  onDemoFallback,
}: {
  docs: ProcessedDocument[];
  selectedDoc?: string | null;
  onSelectDoc?: (name: string) => void;
  onDemoFallback?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(
    selectedDoc ?? docs[0]?.name ?? null
  );

  useEffect(() => {
    const next = selectedDoc ?? docs[0]?.name ?? null;
    setSelected(next);
  }, [selectedDoc, docs]);
  const doc = docs.find((d) => d.name === selected) ?? docs[0];

  const [report, setReport] = useState<DocumentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!doc) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    setReport(null);
    fetchDocumentReport(doc.result, onDemoFallback)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.name]);

  const downloadAll = () => {
    const exportAll = docs.map(({ name, result }) => ({
      document: name,
      engine_used: result.engine_used,
      requires_review: result.requires_review,
      review_reasons: result.review_reasons,
      global_confidence_score: result.global_confidence_score,
      llm_analysis_issues: result.llm_validation.issues,
      fields: Object.fromEntries(
        Object.entries(result.extraction.fields).map(([k, v]) => [k, v.value])
      ),
      material_sold: result.extraction.material_sold,
    }));
    const blob = new Blob([JSON.stringify(exportAll, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    a.download = `analyse_groupee_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsvAll = () => {
    const rows = docs.map(({ name, result }) => ({
      document: name,
      engine_used: result.engine_used,
      status: result.requires_review ? "À vérifier" : "Fiable",
      confidence: Math.round(result.global_confidence_score * 100),
      llm_issues_count: result.llm_validation.issues.length,
    }));
    downloadCSV(
      "analyse_groupee_cwo",
      [
        { key: "document", label: "Document" },
        { key: "engine_used", label: "Moteur" },
        { key: "status", label: "Statut" },
        { key: "confidence", label: "Confiance (%)" },
        { key: "llm_issues_count", label: "Problèmes signalés par l'IA" },
      ],
      rows
    );
  };

  const downloadPdfAll = () => {
    downloadTablePdf(
      "analyse_groupee_cwo",
      "Analyse — session en cours",
      `${docs.length} document(s)`,
      ["Document", "Statut", "Confiance", "Pb. IA"],
      docs.map(({ name, result }) => [
        name,
        result.requires_review ? "À vérifier" : "Fiable",
        `${Math.round(result.global_confidence_score * 100)}%`,
        result.llm_validation.issues.length,
      ])
    );
  };

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">Analyse IA</h3>
        <p className="text-xs text-violet-400">
          Rapport en langage naturel généré par un modèle Hugging Face à partir des données
          extraites. Les statistiques chiffrées (confiance, répartition, temps de traitement…)
          se trouvent maintenant dans l&apos;onglet{" "}
          <span className="font-semibold text-violet-600">Statistiques</span>, pour ne pas
          disperser les chiffres à plusieurs endroits.
        </p>
      </div>

      {docs.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-violet-500">Document</label>
          <select
            value={selected ?? ""}
            onChange={(e) => {
              setSelected(e.target.value);
              onSelectDoc?.(e.target.value);
            }}
            className="rounded-xl border border-violet-100 bg-white/80 px-3.5 py-2 text-sm font-medium text-violet-900 shadow-sm transition-all focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
          >
            {docs.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center shadow-soft">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
          <p className="text-sm font-semibold text-violet-800">Génération du rapport…</p>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700">
          Le rapport n&apos;a pas pu être généré. Vérifie que le backend est joignable, puis
          réessaie en changeant de document.
        </div>
      )}

      {!loading && !error && report && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-violet-800">Rapport IA</p>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-500 ring-1 ring-violet-100">
              {GENERATED_BY_LABELS[report.generated_by]}
            </span>
          </div>
          <div className="glass rounded-2xl p-6 shadow-soft">
            <MarkdownReport text={report.report} />
          </div>

          {report.hours_comparison && (
            <div className="glass mt-4 rounded-2xl p-5 shadow-soft">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-500">
                Comparaison M/H — {report.hours_comparison.category}
              </p>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-violet-700">
                <span>
                  Ce document :{" "}
                  <span className="font-semibold text-violet-900">
                    {report.hours_comparison.doc_mh ?? "—"} h
                  </span>
                </span>
                <span>
                  Moyenne ({report.hours_comparison.group_count} CWO) :{" "}
                  <span className="font-semibold text-violet-900">
                    {report.hours_comparison.avg_mh ?? "—"} h
                  </span>
                </span>
                {report.hours_comparison.delta_pct !== null && (
                  <span
                    className={
                      report.hours_comparison.delta_pct > 0 ? "text-rose-500" : "text-emerald-600"
                    }
                  >
                    {report.hours_comparison.delta_pct > 0 ? "+" : ""}
                    {report.hours_comparison.delta_pct}% vs moyenne
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={downloadAll}
          className="shine flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-glow transition-all hover:from-violet-700 hover:to-violet-600 hover:shadow-lift"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Télécharger l&apos;analyse groupée (JSON)
        </button>

        <button
          onClick={downloadCsvAll}
          className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white/70 px-5 py-3 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50"
        >
          📄 Télécharger CSV
        </button>

        <button
          onClick={downloadPdfAll}
          className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white/70 px-5 py-3 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50"
        >
          🧾 Télécharger PDF
        </button>
      </div>
    </div>
  );
}
