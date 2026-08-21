"use client";

import { useState } from "react";
import { FIELD_LABELS, MaterialRow, WorkOrderRecord } from "@/lib/types";
import { searchWorkOrders, updateWorkOrderMaterials } from "@/lib/api";
import MaterialsTab from "@/components/tabs/MaterialsTab";

export default function SearchTab({ onDemoFallback }: { onDemoFallback: () => void }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [acRegistration, setAcRegistration] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WorkOrderRecord[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "wo">("date");
  const [descending, setDescending] = useState(true);

  const runSearch = async () => {
    setLoading(true);
    try {
      const res = await searchWorkOrders(
        { dateFrom: toFr(dateFrom), dateTo: toFr(dateTo), acRegistration, q: query },
        onDemoFallback
      );
      setResults(res);
    } finally {
      setLoading(false);
    }
  };

  const handleMaterialsChange = (woId: number, materials: MaterialRow[]) => {
    setResults((prev) =>
      prev
        ? prev.map((r) =>
            r.id === woId ? { ...r, materials: materials as WorkOrderRecord["materials"] } : r
          )
        : prev
    );
  };

  const saveMaterials = async (wo: WorkOrderRecord) => {
    setSavingId(wo.id);
    try {
      await updateWorkOrderMaterials(wo.id, wo.materials, onDemoFallback);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">
          Recherche dans la base des ordres de travail
        </h3>
        <p className="text-xs text-violet-400">
          Filtre par date, immatriculation, ou texte libre (N° d&apos;ordre, travaux, client).
        </p>
      </div>

      <div className="glass grid grid-cols-1 gap-4 rounded-2xl p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-4">
        <DateField label="Date début" value={dateFrom} onChange={setDateFrom} />
        <DateField label="Date fin" value={dateTo} onChange={setDateTo} />
        <TextField
          label="Immatriculation"
          value={acRegistration}
          onChange={setAcRegistration}
          placeholder="TS-IMB"
          mono
        />
        <TextField
          label="Recherche libre"
          value={query}
          onChange={setQuery}
          placeholder="N° d'ordre, client, travaux…"
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <button
            onClick={runSearch}
            disabled={loading}
            className="shine flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:from-violet-700 hover:to-violet-600 disabled:opacity-60"
          >
            {loading ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
            Rechercher
          </button>
        </div>
      </div>

      {results !== null && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-violet-400">
            {results.length} ordre{results.length > 1 ? "s" : ""} de travail trouvé
            {results.length > 1 ? "s" : ""}
          </p>

          {results.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center text-sm text-violet-400 shadow-soft">
              Aucun résultat pour ces critères.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-violet-500">Trier par</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "date" | "wo")}
                  className="rounded-lg border border-violet-100 bg-white px-3 py-1.5 text-xs font-medium text-violet-700">
                  <option value="date">Date</option>
                  <option value="wo">N° de WO</option>
                </select>
                <button onClick={() => setDescending(v => !v)}
                  className="rounded-lg border border-violet-100 bg-white px-3 py-1.5 text-xs font-medium text-violet-600">
                  {descending ? "↓ Décroissant" : "↑ Croissant"}
                </button>
              </div>
              {sortWorkOrders(results, sortBy, descending).map((wo) => (
                <div key={wo.id} className="glass overflow-hidden rounded-2xl shadow-soft">
                  <button
                    onClick={() => setExpanded(expanded === wo.id ? null : wo.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-violet-50/40"
                  >
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                      <span className="font-mono text-sm font-semibold text-violet-900">
                        WO {wo.order_number || "—"}
                      </span>
                      <span className="text-xs text-violet-500">{wo.date || "—"}</span>
                      <span className="text-xs text-violet-500">{wo.lieu_place || "—"}</span>
                      <span className="rounded-full bg-violet-100 px-2.5 py-0.5 font-mono text-xs font-medium text-violet-700">
                        {wo.ac_registration || "—"}
                      </span>
                      <span className="text-xs text-violet-400">{wo.airline_customer || "—"}</span>
                    </div>
                    <svg
                      className={`h-4 w-4 shrink-0 text-violet-400 transition-transform duration-300 ${
                        expanded === wo.id ? "rotate-180" : ""
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>

                  {expanded === wo.id && (
                    <div className="animate-fade-up border-t border-violet-100 px-5 py-5">
                      <div className="mb-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                        <Info label={FIELD_LABELS.work_required} value={wo.work_required} full />
                        <Info label={FIELD_LABELS.ac_type} value={wo.ac_type} />
                        <Info label={FIELD_LABELS.required_mh} value={wo.required_mh} />
                        <Info label={FIELD_LABELS.customer_rep_name} value={wo.customer_rep_name} />
                        <Info label={FIELD_LABELS.customer_rep_date} value={wo.customer_rep_date} />
                      </div>

                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-500">
                        Matériaux vendus
                      </p>
                      <MaterialsTab
                        materials={wo.materials}
                        onChange={(m) => handleMaterialsChange(wo.id, m)}
                      />
                      <button
                        onClick={() => saveMaterials(wo)}
                        disabled={savingId === wo.id}
                        className="mt-3 flex items-center gap-2 rounded-xl border border-violet-200 bg-white/70 px-4 py-2 text-xs font-semibold text-violet-700 transition-all hover:bg-violet-50 disabled:opacity-60"
                      >
                        {savingId === wo.id ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
                        ) : (
                          "💾"
                        )}
                        Enregistrer les matériaux dans la base
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function sortWorkOrders(rows: WorkOrderRecord[], by: "date" | "wo", desc: boolean) {
  return [...rows].sort((a, b) => {
    const av = by === "date" ? dateKey(a.date) : (a.order_number || "").toUpperCase();
    const bv = by === "date" ? dateKey(b.date) : (b.order_number || "").toUpperCase();
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return desc ? -cmp : cmp;
  });
}

function dateKey(value: string | null) {
  if (!value) return "";
  const [d, m, y] = value.split("/");
  return y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : value;
}

function toFr(isoDate: string): string {
  if (!isoDate) return "";
  const [yyyy, mm, dd] = isoDate.split("-");
  return yyyy && mm && dd ? `${dd}/${mm}/${yyyy}` : "";
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-violet-500">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-violet-100 bg-white/80 px-3.5 py-2.5 text-sm text-violet-900 shadow-sm transition-all focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-violet-500">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border border-violet-100 bg-white/80 px-3.5 py-2.5 text-sm text-violet-900 shadow-sm transition-all placeholder:text-violet-300 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100 ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

function Info({ label, value, full }: { label: string; value: string | null; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-xs font-semibold text-violet-400">{label}</p>
      <p className="text-sm text-violet-900">{value || "—"}</p>
    </div>
  );
}
