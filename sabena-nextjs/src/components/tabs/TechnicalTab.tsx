"use client";

import { PipelineResult } from "@/lib/types";
import EngineBadge from "@/components/EngineBadge";

function pct(value: number | null | undefined): number {
  const v = value ?? 0;
  return Math.round(v * (v <= 1 ? 100 : 1));
}

/** Badge de confiance (remplace l'ancienne barre horizontale) : couleur +
 * pourcentage, lisible en un coup d'œil sans élément graphique superflu. */
function ConfidenceBadge({ label, value }: { label: string; value: number | null | undefined }) {
  const p = pct(value);
  const tone =
    p >= 80
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : p >= 60
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-rose-50 text-rose-700 ring-rose-200";
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/60 px-4 py-3 ring-1 ring-violet-50">
      <span className="text-xs font-medium text-violet-600">{label}</span>
      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${tone}`}>{p}%</span>
    </div>
  );
}

export default function TechnicalTab({ result }: { result: PipelineResult }) {
  const c = result.confidence_components;

  return (
    <div className="animate-fade-up flex flex-col gap-5">
      {/* Section 1 : identité du traitement */}
      <div className="glass rounded-2xl p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">
              Informations techniques
            </p>
            <p className="mt-1 text-sm text-violet-400">Traçabilité complète du traitement de ce WO.</p>
          </div>
          <EngineBadge engine={result.engine_used} />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <InfoRow label="Type de document" value={result.document_type || "—"} />
          <InfoRow label="Moteur / modèle utilisé" value={result.engine_used || "—"} />
          <InfoRow label="Temps de traitement" value={`${result.processing_time_s?.toFixed(2) ?? "—"} s`} />
          <InfoRow label="Template aligné" value={result.template_aligned ? "Oui" : "Non"} />
          <InfoRow
            label="Template reconnu"
            value={
              result.template_matched
                ? `Oui (${pct(result.template_match_score)}%)`
                : "Non"
            }
          />
          <InfoRow label="Angle de redressement" value={`${(result.deskew_angle ?? 0).toFixed(2)}°`} />
        </div>
      </div>

      {/* Section 2 : confiance — regroupée ici (plus d'onglet "Analyse" séparé) */}
      <div className="glass rounded-2xl p-5 shadow-soft">
        <p className="mb-1 text-sm font-semibold text-violet-800">Confiance</p>
        <p className="mb-4 text-xs text-violet-400">
          Score de fiabilité par composante du pipeline d&apos;extraction.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ConfidenceBadge label="Globale" value={result.global_confidence_score} />
          <ConfidenceBadge label="Détection document" value={result.document_detection_confidence} />
          <ConfidenceBadge label="Classification" value={result.classification_score} />
          <ConfidenceBadge label="OCR" value={c?.ocr} />
          <ConfidenceBadge label="Template" value={c?.template} />
          <ConfidenceBadge label="Règles" value={c?.rules} />
          <ConfidenceBadge label="LLM" value={c?.llm} />
        </div>
      </div>

      {/* Section 3 : validation & pipeline */}
      <div className="grid gap-5 md:grid-cols-2">
        <TechCard title="Validation">
          <InfoLine label="LLM utilisé" value={result.llm_validation?.used_llm ? "Oui" : "Non"} />
          <InfoLine
            label="Confiance validation"
            value={`${pct(result.llm_validation?.confidence_score)}%`}
          />
          <InfoLine
            label="Champs nécessitant une vérification"
            value={String(
              Object.values(result.extraction.fields).filter((f) => f.needs_review).length
            )}
          />
        </TechCard>
        <TechCard title="Pipeline">
          <InfoLine label="Document détecté" value={result.document_detected ? "Oui" : "Non"} />
          <InfoLine label="Revue manuelle requise" value={result.requires_review ? "Oui" : "Non"} />
          <InfoLine label="Raisons" value={String(result.review_reasons?.length || 0)} />
        </TechCard>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-violet-50/60 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-violet-400">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-violet-900">{value}</p>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <p>
      {label} : <b>{value}</b>
    </p>
  );
}

function TechCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5 shadow-soft">
      <p className="mb-3 text-sm font-semibold text-violet-800">{title}</p>
      <div className="flex flex-col gap-2 text-xs text-violet-500">{children}</div>
    </div>
  );
}
