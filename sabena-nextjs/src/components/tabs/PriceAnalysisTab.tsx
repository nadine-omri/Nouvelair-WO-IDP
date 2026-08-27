"use client";

import { useState } from "react";
import { PriceAnalysis } from "@/lib/types";
import { fetchPriceAnalysis } from "@/lib/api";
import MarkdownReport from "@/components/MarkdownReport";

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr", "05": "Mai", "06": "Juin",
  "07": "Juil", "08": "Août", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

function monthLabel(ym: string) {
  if (ym === "Date inconnue") return ym;
  const [, mm] = ym.split("-");
  return MONTH_LABELS[mm] ?? ym;
}

function toFr(isoDate: string): string {
  if (!isoDate) return "";
  const [yyyy, mm, dd] = isoDate.split("-");
  return yyyy && mm && dd ? `${dd}/${mm}/${yyyy}` : "";
}

const GENERATED_BY_LABELS: Record<PriceAnalysis["generated_by"], string> = {
  huggingface: "Rapport généré par Hugging Face",
  ollama: "Rapport généré par Ollama (local)",
  template: "Résumé automatique (LLM indisponible)",
};

export default function PriceAnalysisTab({ onDemoFallback }: { onDemoFallback: () => void }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PriceAnalysis | null>(null);
  const [error, setError] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetchPriceAnalysis(
        { dateFrom: toFr(dateFrom), dateTo: toFr(dateTo) },
        onDemoFallback
      );
      setData(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const stats = data?.stats;
  const maxMonth = Math.max(1, ...(stats?.by_month.map((m) => m.total) ?? [1]));
  const maxDesignation = Math.max(1, ...(stats?.top_designations.map((d) => d.total) ?? [1]));
  const maxAcType = Math.max(1, ...(stats?.by_ac_type.map((d) => d.total) ?? [1]));

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">
          Analyse des prix (IA) — statistiques &amp; rapport par période
        </h3>
        <p className="text-xs text-violet-400">
          Diagrammes et rapport en langage naturel générés par IA sur les matériaux facturés,
          filtrables par date.
        </p>
      </div>

      <div className="glass grid grid-cols-1 gap-4 rounded-2xl p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-4">
        <DateField label="Date début" value={dateFrom} onChange={setDateFrom} />
        <DateField label="Date fin" value={dateTo} onChange={setDateTo} />
        <div className="flex items-end sm:col-span-2 lg:col-span-2">
          <button
            onClick={run}
            disabled={loading}
            className="shine flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:from-violet-700 hover:to-violet-600 disabled:opacity-60"
          >
            {loading ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {loading ? "Analyse en cours…" : "Générer l'analyse"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700">
          L&apos;analyse a échoué. Réessaie, ou vérifie que le backend est joignable.
        </div>
      )}

      {!data && !loading && !error && (
        <div className="glass flex h-40 items-center justify-center rounded-2xl p-5 text-sm text-violet-300 shadow-soft">
          Choisis une période (facultatif) puis clique sur &quot;Générer l&apos;analyse&quot;.
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard label="Pièces facturées" value={String(stats.n_items)} />
            <MetricCard label="Valeur totale" value={`${stats.total_value.toFixed(2)} TND`} />
            <MetricCard label="Prix moyen / pièce" value={`${stats.avg_price.toFixed(2)} TND`} />
            <MetricCard
              label="Tendance prix moyen"
              value={stats.trend_pct === null ? "—" : `${stats.trend_pct > 0 ? "+" : ""}${stats.trend_pct}%`}
              negative={typeof stats.trend_pct === "number" && stats.trend_pct > 0}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard title="Valeur facturée par mois">
              {stats.by_month.length === 0 ? (
                <EmptyChart />
              ) : (
                <div className="flex h-40 items-end gap-3 overflow-x-auto px-1">
                  {stats.by_month.map((m) => (
                    <div key={m.month} className="flex flex-1 min-w-[36px] flex-col items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-violet-600">
                        {m.total.toFixed(0)}
                      </span>
                      <div
                        className="w-full max-w-[28px] rounded-t-lg bg-gradient-to-t from-violet-600 to-violet-400 transition-all duration-700"
                        style={{ height: `${Math.max(6, (m.total / maxMonth) * 100)}%` }}
                      />
                      <span className="text-[10px] text-violet-400">{monthLabel(m.month)}</span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Top matériaux (valeur cumulée)">
              {stats.top_designations.length === 0 ? (
                <EmptyChart />
              ) : (
                <div className="flex flex-col gap-3">
                  {stats.top_designations.map((d) => (
                    <div key={d.designation} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-xs font-medium text-violet-700">
                        {d.designation}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-700"
                          style={{ width: `${(d.total / maxDesignation) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-violet-500">
                        {d.total.toFixed(0)} TND
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Valeur facturée par type avion">
              {stats.by_ac_type.length === 0 ? (
                <EmptyChart />
              ) : (
                <div className="flex flex-col gap-3">
                  {stats.by_ac_type.map((t) => (
                    <div key={t.ac_type} className="flex items-center gap-3">
                      <span className="w-14 shrink-0 font-mono text-xs font-medium text-violet-700">
                        {t.ac_type}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-700"
                          style={{ width: `${(t.total / maxAcType) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-violet-500">
                        {t.total.toFixed(0)} TND
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Extrêmes de prix">
              {!stats.max_item && !stats.min_item ? (
                <EmptyChart />
              ) : (
                <div className="flex flex-col gap-3 text-xs">
                  {stats.max_item && (
                    <ExtremeRow
                      label="Prix le plus élevé"
                      designation={stats.max_item.designation}
                      price={stats.max_item.price}
                      date={stats.max_item.date}
                      order={stats.max_item.order_number}
                    />
                  )}
                  {stats.min_item && (
                    <ExtremeRow
                      label="Prix le plus bas"
                      designation={stats.min_item.designation}
                      price={stats.min_item.price}
                      date={stats.min_item.date}
                      order={stats.min_item.order_number}
                    />
                  )}
                </div>
              )}
            </ChartCard>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-violet-800">Rapport IA</p>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-500 ring-1 ring-violet-100">
                {GENERATED_BY_LABELS[data!.generated_by]}
              </span>
            </div>
            <div className="glass rounded-2xl p-6 shadow-soft">
              <MarkdownReport text={data!.report} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ExtremeRow({
  label,
  designation,
  price,
  date,
  order,
}: {
  label: string;
  designation: string | null;
  price: number;
  date: string | null;
  order: string | null;
}) {
  return (
    <div className="rounded-xl bg-violet-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-400">{label}</p>
      <p className="mt-1 font-medium text-violet-900">{designation || "—"}</p>
      <div className="mt-1 flex items-center justify-between text-violet-500">
        <span>
          {date ? `${date} · ` : ""}WO {order || "—"}
        </span>
        <span className="font-display font-bold text-violet-700">{price.toFixed(2)} TND</span>
      </div>
    </div>
  );
}

/** Petit rendu markdown maison (## titres, **gras**, listes "- "), suffisant
 * pour le format du rapport LLM ; déplacé dans @/components/MarkdownReport
 * pour être partagé avec AnalysisTab.tsx. */

function MetricCard({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="glass animate-fade-up rounded-2xl p-4 shadow-soft">
      <p className="text-xs font-medium text-violet-400">{label}</p>
      <p
        className={`mt-1 font-display text-2xl font-bold ${
          negative ? "text-rose-500" : "text-violet-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5 shadow-soft">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-violet-500">{title}</p>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <p className="py-6 text-center text-xs text-violet-300">
      Pas de données pour cette période.
    </p>
  );
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
