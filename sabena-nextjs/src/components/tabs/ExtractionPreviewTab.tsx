import { FIELD_LABELS, PipelineResult } from "@/lib/types";
import EngineBadge from "@/components/EngineBadge";

export default function ExtractionPreviewTab({ result }: { result: PipelineResult }) {
  const fields = Object.entries(result.extraction.fields);

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <EngineBadge engine={result.engine_used} />
        <span className="text-xs text-violet-400">
          Traité en {result.processing_time_s.toFixed(1)}s
        </span>
      </div>

      {result.requires_review ? (
        <div className="animate-fade-up rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <WarnIcon /> À vérifier manuellement avant export
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Ce document ne passe pas le seuil de confiance automatique.
          </p>
          {result.review_reasons.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {result.review_reasons.map((r, i) => (
                <li key={i} className="text-xs text-amber-700">
                  • {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="animate-fade-up rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckIcon /> Fiable — confiance globale{" "}
            {Math.round(result.global_confidence_score * 100)}%
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Vérification rapide recommandée quand même.
          </p>
        </div>
      )}

      <div className="glass rounded-2xl p-1 shadow-soft">
        <div className="overflow-hidden rounded-xl">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-violet-50/80 text-left text-xs uppercase tracking-wide text-violet-500">
                <th className="px-4 py-3 font-semibold">Champ</th>
                <th className="px-4 py-3 font-semibold">Valeur</th>
                <th className="px-4 py-3 font-semibold">Confiance</th>
                <th className="px-4 py-3 font-semibold">Texte brut OCR</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(([key, fv], i) => (
                <tr
                  key={key}
                  className={`border-t border-violet-50 transition-colors hover:bg-violet-50/50 ${
                    fv.needs_review ? "bg-amber-50/40" : ""
                  }`}
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <td className="px-4 py-3 font-medium text-violet-900">
                    {FIELD_LABELS[key] ?? key}
                    {fv.needs_review && (
                      <span className="ml-1.5 text-amber-500" title="À vérifier">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="max-w-[220px] px-4 py-3 font-mono text-[13px] text-violet-800">
                    {fv.value || <span className="text-violet-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
                        fv.confidence >= 80
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : fv.confidence >= 60
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-rose-50 text-rose-700 ring-rose-200"
                      }`}
                    >
                      {Math.round(fv.confidence)}%
                    </span>
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-xs text-violet-400">
                    {fv.raw_text || "—"}
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-violet-400">
                    Aucune donnée d&apos;extraction disponible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {result.extraction.material_sold.length > 0 && (
        <div className="glass rounded-2xl p-1 shadow-soft">
          <div className="overflow-hidden rounded-xl">
            <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-violet-500">
              Matériel vendu
            </p>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-violet-400">
                  <th className="px-4 py-2 font-semibold">Qté</th>
                  <th className="px-4 py-2 font-semibold">Désignation</th>
                  <th className="px-4 py-2 font-semibold">Référence</th>
                  <th className="px-4 py-2 font-semibold">Prix</th>
                </tr>
              </thead>
              <tbody>
                {result.extraction.material_sold.map((row, i) => (
                  <tr key={i} className="border-t border-violet-50">
                    <td className="px-4 py-2.5">{row.qty ?? "—"}</td>
                    <td className="px-4 py-2.5">{row.designation ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.reference ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {row.price !== null ? `${row.price.toFixed(2)} TND` : row.price_raw ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M8 12.5l3 3 5-6.5M12 21a9 9 0 100-18 9 9 0 000 18z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
