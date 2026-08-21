"use client";

import { useEffect, useState } from "react";
import { DashboardStats } from "@/lib/types";
import { fetchDashboardStats } from "@/lib/api";

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr", "05": "Mai", "06": "Juin",
  "07": "Juil", "08": "Août", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

function monthLabel(ym: string) {
  const [, mm] = ym.split("-");
  return MONTH_LABELS[mm] ?? ym;
}

export default function DashboardTab({ onDemoFallback }: { onDemoFallback: () => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDashboardStats(onDemoFallback).then((s) => {
      if (!cancelled) {
        setStats(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
      </div>
    );
  }

  if (stats.total_work_orders === 0) {
    return <EmptyDashboard />;
  }

  const maxMonth = Math.max(1, ...stats.by_month.map(([, c]) => c));
  const maxType = Math.max(1, ...stats.by_ac_type.map(([, c]) => c));
  const maxReg = Math.max(1, ...stats.top_registrations.map(([, c]) => c));
  const avgValuePerWo = stats.total_work_orders
    ? stats.total_materials_value / stats.total_work_orders
    : 0;

  // Tendance simple : dernier mois vs mois précédent (nombre de WO).
  const lastTwoMonths = stats.by_month.slice(-2);
  let monthTrendLabel: string | undefined;
  let monthTrendNegative = false;
  if (lastTwoMonths.length === 2) {
    const [, prevCount] = lastTwoMonths[0];
    const [, lastCount] = lastTwoMonths[1];
    const diff = lastCount - prevCount;
    if (diff !== 0) {
      monthTrendLabel = `${diff > 0 ? "+" : ""}${diff} vs mois précédent`;
      monthTrendNegative = diff < 0;
    }
  }

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">
          Dashboard — vue d&apos;ensemble
        </h3>
        <p className="text-xs text-violet-400">
          Statistiques agrégées sur tous les ordres de travail enregistrés (toutes sessions confondues).
        </p>
      </div>

      {/* KPI principaux */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Ordres de travail" value={String(stats.total_work_orders)} icon="📋" sub={monthTrendLabel} negative={monthTrendNegative} />
        <Kpi label="Valeur totale matériaux" value={`${stats.total_materials_value.toFixed(2)} TND`} icon="💰" />
        <Kpi label="Valeur moyenne / WO" value={`${avgValuePerWo.toFixed(2)} TND`} icon="📊" />
        <Kpi label="MH moyen requis" value={stats.avg_required_mh.toFixed(2)} icon="⏱️" />
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Ordres de travail par mois" wide>
          {stats.by_month.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="flex h-40 items-end gap-3 px-1">
              {stats.by_month.map(([ym, count]) => (
                <div key={ym} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-violet-600">{count}</span>
                  <div
                    className="w-full max-w-[28px] rounded-t-lg bg-gradient-to-t from-violet-600 to-violet-400 transition-all duration-700"
                    style={{ height: `${Math.max(6, (count / maxMonth) * 100)}%` }}
                  />
                  <span className="text-[10px] text-violet-400">{monthLabel(ym)}</span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Répartition par type avion">
          {stats.by_ac_type.length === 0 ? (
            <EmptyChart />
          ) : (
            <BarList items={stats.by_ac_type} max={maxType} mono />
          )}
        </ChartCard>

        <ChartCard title="Top immatriculations">
          {stats.top_registrations.length === 0 ? (
            <EmptyChart />
          ) : (
            <BarList items={stats.top_registrations} max={maxReg} mono />
          )}
        </ChartCard>

        <ChartCard title="Derniers ordres de travail">
          {stats.recent.length === 0 ? (
            <EmptyChart />
          ) : (
            <RecentTable recent={stats.recent} />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function BarList({ items, max, mono }: { items: [string, number][]; max: number; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map(([label, count]) => (
        <div key={label} className="flex items-center gap-3">
          <span
            className={`w-20 shrink-0 truncate text-xs font-medium text-violet-700 ${
              mono ? "font-mono" : ""
            }`}
          >
            {label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-700"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-violet-500">{count}</span>
        </div>
      ))}
    </div>
  );
}

function RecentTable({ recent }: { recent: DashboardStats["recent"] }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-violet-50">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-violet-50/70 text-left uppercase tracking-wide text-violet-400">
            <th className="px-3 py-2 font-semibold">WO</th>
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold">Avion</th>
            <th className="px-3 py-2 font-semibold">Client</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((wo) => (
            <tr key={wo.id} className="border-t border-violet-50 transition-colors hover:bg-violet-50/50">
              <td className="px-3 py-2.5 font-mono font-semibold text-violet-800">
                {wo.order_number || "—"}
              </td>
              <td className="px-3 py-2.5 text-violet-500">{wo.date || "—"}</td>
              <td className="px-3 py-2.5">
                <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-violet-700">
                  {wo.ac_registration || "—"}
                </span>
              </td>
              <td className="max-w-[140px] truncate px-3 py-2.5 text-violet-400">
                {wo.airline_customer || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  sub,
  negative,
}: {
  label: string;
  value: string;
  icon: string;
  sub?: string;
  negative?: boolean;
}) {
  return (
    <div className="glass animate-fade-up rounded-2xl p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <p className="text-xs font-medium text-violet-400">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-violet-900">{value}</p>
      {sub && (
        <p className={`mt-0.5 text-xs font-medium ${negative ? "text-rose-500" : "text-emerald-500"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

function ChartCard({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`glass rounded-2xl p-5 shadow-soft ${wide ? "lg:col-span-2" : ""}`}>
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-violet-500">{title}</p>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <p className="py-6 text-center text-xs text-violet-300">
      Pas encore de données pour ce graphique.
    </p>
  );
}

function EmptyDashboard() {
  return (
    <div className="animate-fade-up flex flex-col items-center justify-center gap-3 rounded-2xl py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-2xl">
        📋
      </span>
      <p className="text-sm font-semibold text-violet-800">Aucun ordre de travail enregistré</p>
      <p className="max-w-sm text-xs text-violet-400">
        Traite un document puis sauvegarde-le depuis l&apos;onglet Export pour voir apparaître
        les statistiques ici.
      </p>
    </div>
  );
}
