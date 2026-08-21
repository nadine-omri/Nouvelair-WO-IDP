"use client";

import { useState } from "react";
import { MaterialRow } from "@/lib/types";

interface Props {
  materials: MaterialRow[];
  onChange: (materials: MaterialRow[]) => void;
}

function emptyRow(): MaterialRow {
  return { qty: "1", designation: "", reference: "", price: 0, price_raw: "" };
}

export default function MaterialsTab({ materials, onChange }: Props) {
  const [justAdded, setJustAdded] = useState<number | null>(null);

  const update = (idx: number, patch: Partial<MaterialRow>) => {
    const next = materials.map((m, i) => (i === idx ? { ...m, ...patch } : m));
    onChange(next);
  };

  const removeRow = (idx: number) => {
    onChange(materials.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    onChange([...materials, emptyRow()]);
    setJustAdded(materials.length);
    setTimeout(() => setJustAdded(null), 600);
  };

  const total = materials.reduce((s, m) => s + (Number(m.price) || 0), 0);

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-violet-900">Matériaux &amp; prix</h3>
          <p className="text-xs text-violet-400">
            Ajoute, modifie ou retire une ligne. Les changements s&apos;appliquent au document sélectionné.
          </p>
        </div>
        <button
          onClick={addRow}
          className="shine flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:from-violet-700 hover:to-violet-600"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          Ajouter une ligne
        </button>
      </div>

      <div className="glass overflow-hidden rounded-2xl shadow-soft">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-violet-50/80 text-left text-xs uppercase tracking-wide text-violet-500">
              <th className="w-20 px-3 py-3 font-semibold">Qté</th>
              <th className="px-3 py-3 font-semibold">Désignation</th>
              <th className="w-36 px-3 py-3 font-semibold">Référence</th>
              <th className="w-36 px-3 py-3 font-semibold">Prix (TND)</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {materials.map((row, i) => (
              <tr
                key={i}
                className={`border-t border-violet-50 transition-colors hover:bg-violet-50/40 ${
                  justAdded === i ? "animate-fade-up bg-violet-50/70" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <Cell
                    value={row.qty ?? ""}
                    onChange={(v) => update(i, { qty: v })}
                    mono
                  />
                </td>
                <td className="px-3 py-2">
                  <Cell
                    value={row.designation ?? ""}
                    onChange={(v) => update(i, { designation: v })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Cell
                    value={row.reference ?? ""}
                    onChange={(v) => update(i, { reference: v })}
                    mono
                  />
                </td>
                <td className="px-3 py-2">
                  <Cell
                    value={row.price !== null && row.price !== undefined ? String(row.price) : ""}
                    onChange={(v) => {
                      const num = parseFloat(v.replace(",", "."));
                      update(i, {
                        price: Number.isNaN(num) ? null : num,
                        price_raw: v,
                      });
                    }}
                    mono
                    numeric
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => removeRow(i)}
                    className="rounded-full p-1.5 text-violet-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
                    aria-label="Supprimer la ligne"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M18 6L6 18M6 6l12 12"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {materials.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-violet-400">
                  Aucun matériau. Clique sur « Ajouter une ligne » pour commencer.
                </td>
              </tr>
            )}
          </tbody>
          {materials.length > 0 && (
            <tfoot>
              <tr className="border-t border-violet-100 bg-violet-50/50">
                <td colSpan={3} className="px-3 py-3 text-right text-xs font-semibold text-violet-500">
                  Total
                </td>
                <td className="px-3 py-3 font-mono text-sm font-bold text-violet-800">
                  {total.toFixed(2)} TND
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-violet-400">
        💾 Ces modifications sont incluses automatiquement dans l&apos;export JSON et
        l&apos;enregistrement en base (onglet Export final).
      </p>
    </div>
  );
}

function Cell({
  value,
  onChange,
  mono,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode={numeric ? "decimal" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-violet-900 transition-all hover:border-violet-100 hover:bg-white/60 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-violet-100 ${
        mono ? "font-mono" : ""
      }`}
    />
  );
}
