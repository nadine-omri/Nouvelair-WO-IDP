import { ENGINE_LABELS, PipelineResult } from "@/lib/types";
import EngineBadge from "@/components/EngineBadge";
import ConfidenceBar from "@/components/ConfidenceBar";

interface Props {
  result: PipelineResult;
  /** Métadonnées d'origine (facultatives) : fichier source + numéro de page,
   * pour identifier de quel PDF/scan ce WO provient. */
  sourceFile?: string;
  pageIndex?: number;
  pageCount?: number;
}

export default function TechnicalInfoTab({ result, sourceFile, pageIndex, pageCount }: Props) {
  const cc = result.confidence_components;
  const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">Informations techniques</h3>
        <p className="text-xs text-violet-400">
          Moteur d&apos;extraction, méthode utilisée et détail des scores de confiance du pipeline
          pour ce document.
        </p>
      </div>

      {/* Origine du document */}
      {(sourceFile || pageCount) && (
        <div className="glass flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl p-4 text-xs shadow-soft">
          {sourceFile && (
            <InfoInline label="Fichier source" value={sourceFile} mono />
          )}
          {pageCount != null && pageCount > 1 && (
            <InfoInline label="Page" value={`${pageIndex ?? "?"} / ${pageCount}`} />
          )}
        </div>
      )}

      {/* Moteur & statut */}
      <div className="glass grid grid-cols-1 gap-5 rounded-2xl p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-4">
        <TechCard label="Moteur / méthode d'extraction">
          <EngineBadge engine={result.engine_used} />
        </TechCard>
        <TechCard label="Type de document détecté">
          <span className="text-sm font-medium text-violet-900">{result.document_type}</span>
        </TechCard>
        <TechCard label="Statut">
          {result.requires_review ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
              À vérifier
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              Fiable
            </span>
          )}
        </TechCard>
        <TechCard label="Temps de traitement">
          <span className="text-sm font-medium text-violet-900">{result.processing_time_s.toFixed(2)}s</span>
        </TechCard>
      </div>

      {/* Détail des scores de confiance */}
      <div className="glass rounded-2xl p-5 shadow-soft">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-violet-500">
          Décomposition du score de confiance
        </p>
        <div className="flex flex-col gap-4">
          <ConfRow label="OCR" value={cc.ocr} />
          <ConfRow label="Alignement / template" value={cc.template} />
          <ConfRow label="Règles métier" value={cc.rules} />
          <ConfRow
            label={`Validation LLM${cc.llm_used ? "" : " (non utilisée)"}`}
            value={cc.llm}
            muted={!cc.llm_used}
          />
          <div className="h-px bg-violet-100" />
          <ConfRow label="Score global" value={cc.global} bold />
        </div>
      </div>

      {/* Diagnostics du pipeline */}
      <div className="glass rounded-2xl p-5 shadow-soft">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-violet-500">
          Diagnostics du pipeline (preprocessing → classification → alignement)
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Diagnostic
            label="Document détecté"
            value={result.document_detected ? "Oui" : "Non"}
            sub={`confiance ${pct(result.document_detection_confidence) ?? "—"}%`}
            positive={result.document_detected}
          />
          <Diagnostic
            label="Classification"
            value="sabena_customer_work_order"
            sub={`score ${pct(result.classification_score) ?? "—"}%`}
          />
          <Diagnostic
            label="Template aligné"
            value={result.template_aligned ? "Oui" : "Non"}
            sub={result.template_matched ? `correspondance ${pct(result.template_match_score) ?? "—"}%` : "non recherché"}
            positive={result.template_aligned}
          />
          <Diagnostic
            label="Angle de redressement (deskew)"
            value={`${result.deskew_angle.toFixed(2)}°`}
          />
          <Diagnostic
            label="Validation LLM utilisée"
            value={result.llm_validation.used_llm ? "Oui" : "Non"}
            sub={
              result.llm_validation.used_llm
                ? `confiance ${pct(result.llm_validation.confidence_score) ?? "—"}%`
                : undefined
            }
          />
          <Diagnostic
            label="Champs à revoir"
            value={String(Object.values(result.extraction.fields).filter((f) => f.needs_review).length)}
            sub={`sur ${Object.keys(result.extraction.fields).length} champs extraits`}
          />
        </div>
      </div>

      {/* Analyse de validation IA (LLM) */}
      {result.llm_validation.used_llm && (
        <div className="glass rounded-2xl p-5 shadow-soft ring-1 ring-violet-200/60">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">
              🤖 Analyse de validation par l&apos;IA (LLM)
            </p>
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
              Confiance IA : {pct(result.llm_validation.confidence_score) ?? "—"}%
            </span>
          </div>
          {result.llm_validation.issues.length === 0 ? (
            <p className="text-xs text-emerald-600">
              ✓ Aucun problème signalé par l&apos;IA sur cette extraction.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {result.llm_validation.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-violet-700">
                  <span className="mt-0.5 text-violet-400">🔎</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Raisons de la revue / issues de validation */}
      {(result.review_reasons.length > 0 || result.validation_issues.length > 0) && (
        <div className="glass rounded-2xl p-5 shadow-soft">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-violet-500">
            ⚙️ Raisons de vérification &amp; règles de validation (pipeline)
          </p>
          <ul className="flex flex-col gap-2">
            {result.review_reasons.map((r, i) => (
              <li key={`rr-${i}`} className="flex items-start gap-2 text-xs text-amber-700">
                <span className="mt-0.5">⚠</span>
                <span>{r}</span>
              </li>
            ))}
            {result.validation_issues.map((v, i) => (
              <li
                key={`vi-${i}`}
                className={`flex items-start gap-2 text-xs ${
                  v.level === "error" ? "text-rose-700" : "text-amber-700"
                }`}
              >
                <span className="mt-0.5">{v.level === "error" ? "✕" : "⚠"}</span>
                <span>
                  <span className="font-mono font-semibold">{v.field}</span> — {v.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confiance par champ */}
      <div className="glass rounded-2xl p-5 shadow-soft">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-violet-500">
          Confiance et moteur par champ extrait
        </p>
        <div className="overflow-hidden rounded-xl">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-violet-50/80 text-left text-xs uppercase tracking-wide text-violet-500">
                <th className="px-4 py-2.5 font-semibold">Champ</th>
                <th className="px-4 py-2.5 font-semibold">Moteur</th>
                <th className="px-4 py-2.5 font-semibold">Confiance</th>
                <th className="px-4 py-2.5 font-semibold">Ratio d&apos;encre</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.extraction.fields).map(([key, fv]) => (
                <tr key={key} className="border-t border-violet-50">
                  <td className="px-4 py-2.5 font-medium text-violet-900">{key}</td>
                  <td className="px-4 py-2.5 text-xs text-violet-500">
                    {ENGINE_LABELS[fv.engine] ?? fv.engine}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-20">
                        <ConfidenceBar value={fv.confidence} size="sm" />
                      </div>
                      <span className="tabular-nums text-xs text-violet-500">
                        {Math.round(fv.confidence)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs tabular-nums text-violet-400">
                    {(fv.ink_ratio * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TechCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-400">{label}</p>
      {children}
    </div>
  );
}

function ConfRow({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: number | null;
  bold?: boolean;
  muted?: boolean;
}) {
  const pct = value == null ? null : Math.round(value * 100);
  return (
    <div className="flex items-center gap-3">
      <span className={`w-56 shrink-0 text-xs ${bold ? "font-semibold text-violet-800" : "text-violet-600"} ${muted ? "opacity-50" : ""}`}>
        {label}
      </span>
      <div className={`flex-1 ${muted ? "opacity-40" : ""}`}>
        <ConfidenceBar value={pct ?? 0} />
      </div>
      <span className={`w-12 shrink-0 text-right text-xs tabular-nums ${bold ? "font-bold text-violet-900" : "text-violet-500"} ${muted ? "opacity-50" : ""}`}>
        {pct == null ? "—" : `${pct}%`}
      </span>
    </div>
  );
}

function Diagnostic({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/60 p-3.5 ring-1 ring-violet-100">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-400">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold ${
          positive === true ? "text-emerald-700" : positive === false ? "text-rose-600" : "text-violet-900"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-violet-400">{sub}</p>}
    </div>
  );
}

function InfoInline({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-semibold text-violet-400">{label}:</span>
      <span className={`text-violet-800 ${mono ? "font-mono" : ""}`}>{value}</span>
    </span>
  );
}
