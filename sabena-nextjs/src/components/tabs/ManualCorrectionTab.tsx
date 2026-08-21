"use client";

import { useEffect, useState } from "react";
import { FIELD_LABELS, ManualData, PipelineResult, ValidationTuple } from "@/lib/types";
import {
  buildInitDataFromOcr,
  normalizeManualData,
  validateManualData,
} from "@/lib/validation";

interface Props {
  docKey: string;
  result: PipelineResult;
  manualData: ManualData;
  onManualDataChange: (data: ManualData) => void;
  issues: ValidationTuple[];
  onIssuesChange: (issues: ValidationTuple[]) => void;
}

export default function ManualCorrectionTab({
  docKey,
  result,
  manualData,
  onManualDataChange,
  issues,
  onIssuesChange,
}: Props) {
  const [form, setForm] = useState<ManualData>(manualData);
  const [lastValidated, setLastValidated] = useState<"ok" | "error" | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    setForm(manualData);
    setLastValidated(null);
  }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof ManualData, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleValidate = () => {
    const normalized = normalizeManualData(form);
    const newIssues = validateManualData(normalized);
    setForm(normalized);
    onManualDataChange(normalized);
    onIssuesChange(newIssues);
    const hasError = newIssues.some((i) => i.level === "error");
    setLastValidated(hasError ? "error" : "ok");
  };

  const handleReset = () => {
    const init = buildInitDataFromOcr(result);
    setForm(init);
    onManualDataChange(init);
    onIssuesChange([]);
    setLastValidated(null);
  };

  const errorFields = new Set(issues.filter((i) => i.level === "error").map((i) => i.field));
  const warningFields = new Set(issues.filter((i) => i.level === "warning").map((i) => i.field));

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">Correction manuelle assistée</h3>
        <p className="text-xs text-violet-400">
          Pré-rempli avec l&apos;OCR. Corrige les champs critiques, valide puis exporte.
        </p>
      </div>

      <div className="glass grid grid-cols-1 gap-5 rounded-2xl p-6 shadow-soft md:grid-cols-2">
        <Field
          label="N° d'ordre"
          value={form.order_number}
          onChange={(v) => set("order_number", v)}
          mono
        />
        <Field
          label="Date (jj/mm/aaaa) *"
          value={form.date}
          onChange={(v) => set("date", v)}
          error={errorFields.has("date")}
          mono
        />
        <Field label="Lieu" value={form.lieu_place} onChange={(v) => set("lieu_place", v)} />
        <Field
          label="Type avion *"
          value={form.ac_type}
          onChange={(v) => set("ac_type", v)}
          warning={warningFields.has("ac_type")}
          error={errorFields.has("ac_type")}
          mono
        />
        <Field
          label="Immatriculation *"
          value={form.ac_registration}
          onChange={(v) => set("ac_registration", v)}
          warning={warningFields.has("ac_registration")}
          error={errorFields.has("ac_registration")}
          mono
        />
        <Field
          label="Client / Compagnie *"
          value={form.airline_customer}
          onChange={(v) => set("airline_customer", v)}
          error={errorFields.has("airline_customer")}
        />
        <Field
          label="MH requis"
          value={form.required_mh}
          onChange={(v) => set("required_mh", v)}
          warning={warningFields.has("required_mh")}
          mono
        />
        <Field
          label="Représentant client"
          value={form.customer_rep_name}
          onChange={(v) => set("customer_rep_name", v)}
        />
        <Field
          label="Date représentant (jj/mm/aaaa)"
          value={form.customer_rep_date}
          onChange={(v) => set("customer_rep_date", v)}
          warning={warningFields.has("customer_rep_date")}
          mono
        />
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold text-violet-500">
            Travaux demandés
          </label>
          <textarea
            value={form.work_required}
            onChange={(e) => set("work_required", e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-violet-100 bg-white/80 px-3.5 py-2.5 text-sm text-violet-900 shadow-sm transition-all focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
          />
        </div>

        <div className="flex flex-wrap gap-3 md:col-span-2">
          <button
            onClick={handleValidate}
            className="shine rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:from-violet-700 hover:to-violet-600"
          >
            Valider corrections
          </button>
          <button
            onClick={handleReset}
            className="rounded-xl border border-violet-200 bg-white/70 px-5 py-2.5 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50"
          >
            ↺ Recharger depuis OCR
          </button>
        </div>
      </div>

      {lastValidated && (
        <div
          className={`animate-fade-up rounded-2xl p-4 text-sm font-medium ${
            lastValidated === "error"
              ? "border border-rose-200 bg-rose-50/80 text-rose-700"
              : "border border-emerald-200 bg-emerald-50/80 text-emerald-700"
          }`}
        >
          {lastValidated === "error"
            ? "Validation bloquante : corrige les erreurs ci-dessous."
            : "Validation OK (aucune erreur bloquante)."}
          {issues.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs font-normal">
              {issues.map((iss, i) => (
                <li key={i} className={iss.level === "error" ? "text-rose-600" : "text-amber-600"}>
                  <strong>{FIELD_LABELS[iss.field] ?? iss.field}</strong> — {iss.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="glass rounded-2xl shadow-soft">
        <button
          onClick={() => setShowAudit((s) => !s)}
          className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-semibold text-violet-800"
        >
          🔎 Audit OCR (brut vs corrigé)
          <svg
            className={`h-4 w-4 transition-transform duration-300 ${showAudit ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {showAudit && (
          <div className="animate-fade-up flex flex-col gap-3 border-t border-violet-100 px-5 py-4 text-xs">
            {Object.keys(form).map((k) => {
              const fv = result.extraction.fields[k];
              return (
                <div key={k} className="rounded-lg bg-violet-50/50 p-3">
                  <p className="mb-1 font-semibold text-violet-700">{FIELD_LABELS[k] ?? k}</p>
                  <p className="text-violet-500">
                    OCR valeur : <code className="text-violet-700">{fv?.value || "—"}</code>
                  </p>
                  <p className="text-violet-500">
                    OCR brut : <code className="text-violet-700">{fv?.raw_text || "—"}</code>
                  </p>
                  <p className="text-violet-500">
                    Corrigé : <code className="text-violet-700">{form[k as keyof ManualData] || "—"}</code>
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  mono,
  error,
  warning,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  error?: boolean;
  warning?: boolean;
}) {
  const ring = error
    ? "border-rose-300 focus:ring-rose-100 focus:border-rose-400"
    : warning
    ? "border-amber-300 focus:ring-amber-100 focus:border-amber-400"
    : "border-violet-100 focus:ring-violet-100 focus:border-violet-400";
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-violet-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border bg-white/80 px-3.5 py-2.5 text-sm text-violet-900 shadow-sm transition-all focus:outline-none focus:ring-4 ${ring} ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
