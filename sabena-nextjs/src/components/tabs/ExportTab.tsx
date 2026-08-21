"use client";

import { useState } from "react";
import { ManualData, MaterialRow, PipelineResult, ValidationTuple, WorkOrderRecord } from "@/lib/types";
import { saveWorkOrder, updateWorkOrder } from "@/lib/api";

interface Props {
  docName: string;
  result: PipelineResult;
  manualData: ManualData;
  issues: ValidationTuple[];
  materials: MaterialRow[];
  onDemoFallback: () => void;
  savedRecord: WorkOrderRecord | null;
  existingId?: number;
  onSaved: (record: WorkOrderRecord) => void;
}

export default function ExportTab({
  docName,
  result,
  manualData,
  issues,
  materials,
  onDemoFallback,
  savedRecord,
  existingId,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveToDb = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const input = { document_name: docName, ...manualData, materials };
      const record = savedRecord
        ? await updateWorkOrder(savedRecord.id, input, onDemoFallback)
        : existingId
        ? await updateWorkOrder(existingId, input, onDemoFallback)
        : await saveWorkOrder(input, onDemoFallback);
      if (record) onSaved(record);
      else setSaveError("Échec de l'enregistrement.");
    } catch (e) {
      setSaveError("Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const payload = {
    document_name: docName,
    mode: "option_a_human_in_the_loop",
    final_fields: manualData,
    validation_issues: issues.map((i) => ({
      field: i.field,
      level: i.level,
      message: i.message,
    })),
    material_sold: materials,
    ocr_snapshot: Object.fromEntries(
      Object.keys(manualData).map((k) => {
        const fv = result.extraction.fields[k];
        return [
          k,
          {
            value: fv?.value ?? "",
            raw_text: fv?.raw_text ?? "",
            confidence: fv?.confidence ?? 0,
            needs_review: fv?.needs_review ?? false,
          },
        ];
      })
    ),
    exported_at: new Date().toISOString(),
  };

  const nErr = issues.filter((i) => i.level === "error").length;
  const nWarn = issues.filter((i) => i.level === "warning").length;

  const download = () => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docName.replace(/\.[^.]+$/, "")}_final_corrige.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <h3 className="text-base font-semibold text-violet-900">Export final</h3>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Erreurs" value={nErr} tone={nErr > 0 ? "rose" : "emerald"} />
        <StatCard label="Warnings" value={nWarn} tone={nWarn > 0 ? "amber" : "emerald"} />
        <StatCard label="Champs finaux" value={Object.keys(manualData).length} tone="violet" />
      </div>

      <div className="glass rounded-2xl p-5 shadow-soft">
        <pre className="max-h-96 overflow-auto rounded-xl bg-violet-950/95 p-4 text-xs leading-relaxed text-violet-100 scrollbar-thin">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={download}
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
          Télécharger JSON final corrigé
        </button>

        <button
          onClick={handleSaveToDb}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white/70 px-5 py-3 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50 disabled:opacity-60"
        >
          {saving ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 5h11l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM8 5v4h6V5M8 13h8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {savedRecord ? "Mettre à jour dans la base" : "Enregistrer dans la base de données"}
        </button>

        {savedRecord && !saving && (
          <span className="text-xs font-medium text-emerald-600">
            ✓ Enregistré (WO #{savedRecord.id})
          </span>
        )}
        {saveError && <span className="text-xs font-medium text-rose-600">{saveError}</span>}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "emerald" | "violet";
}) {
  const tones: Record<string, string> = {
    rose: "text-rose-600",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    violet: "text-violet-700",
  };
  return (
    <div className="glass rounded-2xl p-4 text-center shadow-soft">
      <p className={`font-display text-3xl font-bold ${tones[tone]}`}>{value}</p>
      <p className="mt-1 text-xs font-medium text-violet-400">{label}</p>
    </div>
  );
}
