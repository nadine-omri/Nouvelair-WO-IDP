"use client";

import { ENGINE_LABELS, ProcessedDocument } from "@/lib/types";
import ConfidenceBar from "@/components/ConfidenceBar";

export default function AnalysisTab({ docs }: { docs: ProcessedDocument[] }) {
  const results = docs.map((d) => d.result);
  const nDocs = results.length;
  const nReview = results.filter((r) => r.requires_review).length;
  const nFallback = results.filter((r) => r.engine_used === "local_ocr_fallback").length;
  const avgConf = nDocs
    ? results.reduce((s, r) => s + r.global_confidence_score, 0) / nDocs
    : 0;
  const avgTime = nDocs
    ? results.reduce((s, r) => s + r.processing_time_s, 0) / nDocs
    : 0;

  const fieldStats: Record<string, { total: number; count: number; flagged: number }> = {};
  for (const r of results) {
    for (const [k, fv] of Object.entries(r.extraction.fields)) {
      fieldStats[k] ??= { total: 0, count: 0, flagged: 0 };
      fieldStats[k].total += fv.confidence;
      fieldStats[k].count += 1;
      if (fv.needs_review) fieldStats[k].flagged += 1;
    }
  }
  const fieldRows = Object.entries(fieldStats)
    .map(([k, s]) => ({ field: k, avg: s.total / s.count, flagged: s.flagged }))
    .sort((a, b) => a.avg - b.avg);

  const downloadAll = () => {
    const exportAll = docs.map(({ name, result }) => ({
      document: name,
      engine_used: result.engine_used,
      requires_review: result.requires_review,
      review_reasons: result.review_reasons,
      global_confidence_score: result.global_confidence_score,
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

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">
          Analyse des résultats — tous les documents traités
        </h3>
        <p className="text-xs text-violet-400">
          Vue groupée de la session en cours.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Documents traités" value={String(nDocs)} />
        <MetricCard
          label="Fiables"
          value={String(nDocs - nReview)}
          sub={nReview ? `-${nReview} à vérifier` : undefined}
          negative={nReview > 0}
        />
        <MetricCard label="Confiance moyenne" value={`${Math.round(avgConf * 100)}%`} />
        <MetricCard label="Temps moyen / doc" value={`${avgTime.toFixed(1)}s`} />
      </div>

      {nFallback > 0 && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50/80 p-4 text-sm text-orange-700">
          ⚠️ {nFallback} document(s) traité(s) en mode dégradé (extraction vision indisponible,
          repli automatique sur l&apos;OCR local) — à revérifier en priorité.
        </div>
      )}

      <div>
        <p className="mb-3 text-sm font-semibold text-violet-800">Vue d&apos;ensemble par document</p>
        <div className="glass overflow-hidden rounded-2xl shadow-soft">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-violet-50/80 text-left text-xs uppercase tracking-wide text-violet-500">
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 font-semibold">Moteur</th>
                <th className="px-4 py-3 font-semibold">Statut</th>
                <th className="px-4 py-3 font-semibold">Confiance</th>
                <th className="px-4 py-3 font-semibold">Champs à revoir</th>
                <th className="px-4 py-3 font-semibold">Temps (s)</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(({ name, result }, i) => (
                <tr key={i} className="border-t border-violet-50 hover:bg-violet-50/50">
                  <td className="max-w-[200px] truncate px-4 py-3 font-medium text-violet-900">
                    {name}
                  </td>
                  <td className="px-4 py-3 text-xs text-violet-500">
                    {ENGINE_LABELS[result.engine_used] ?? result.engine_used}
                  </td>
                  <td className="px-4 py-3">
                    {result.requires_review ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        À vérifier
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        Fiable
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16">
                        <ConfidenceBar value={result.global_confidence_score * 100} size="sm" />
                      </div>
                      <span className="text-xs tabular-nums text-violet-500">
                        {Math.round(result.global_confidence_score * 100)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {Object.values(result.extraction.fields).filter((f) => f.needs_review).length}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    {result.processing_time_s.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {fieldRows.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-semibold text-violet-800">
            Confiance moyenne par champ (tous documents confondus)
          </p>
          <div className="glass flex flex-col gap-3 rounded-2xl p-5 shadow-soft">
            {fieldRows.map((row) => (
              <div key={row.field} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-xs font-medium text-violet-700">
                  {row.field}
                </span>
                <div className="flex-1">
                  <ConfidenceBar value={row.avg} />
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-violet-500">
                  {row.avg.toFixed(0)}%
                </span>
                {row.flagged > 0 && (
                  <span className="shrink-0 text-xs text-amber-500">⚠ {row.flagged}×</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={downloadAll}
        className="shine flex w-fit items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-glow transition-all hover:from-violet-700 hover:to-violet-600 hover:shadow-lift"
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
        Télécharger l&apos;analyse groupée (tous les documents)
      </button>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  negative,
}: {
  label: string;
  value: string;
  sub?: string;
  negative?: boolean;
}) {
  return (
    <div className="glass animate-fade-up rounded-2xl p-4 shadow-soft">
      <p className="text-xs font-medium text-violet-400">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-violet-900">{value}</p>
      {sub && (
        <p className={`mt-0.5 text-xs font-medium ${negative ? "text-rose-500" : "text-emerald-500"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
