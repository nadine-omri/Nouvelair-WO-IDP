"use client";

import { useEffect, useState } from "react";
import { DashboardStats } from "@/lib/types";
import { fetchDashboardStats } from "@/lib/api";

export default function DashboardTab({
  onDemoFallback,
  onOpenStatistics,
}: {
  onDemoFallback: () => void;
  onOpenStatistics: () => void;
}) {
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

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-violet-900">
            Dashboard — vue d&apos;ensemble
          </h3>
          <p className="text-xs text-violet-400">
            Aperçu rapide de la base. Pour les répartitions détaillées (par mois, type avion,
            immatriculation, moteur, marge des heures…), direction l&apos;onglet Statistiques.
          </p>
        </div>
        <button
          onClick={onOpenStatistics}
          className="shrink-0 flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white/70 px-4 py-2 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50"
        >
          📊 Voir toutes les statistiques
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Kpi label="Ordres de travail enregistrés" value={String(stats.total_work_orders)} icon="📋" />
        <Kpi
          label="Valeur totale matériaux"
          value={`${stats.total_materials_value.toFixed(2)} TND`}
          icon="💰"
        />
        <Kpi label="À vérifier" value={String(stats.needs_review_count ?? 0)} icon="⚠️" />
      </div>

      <div className="glass rounded-2xl p-5 shadow-soft">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-violet-500">
          Derniers ordres de travail enregistrés
        </p>
        {stats.recent.length === 0 ? (
          <p className="py-6 text-center text-xs text-violet-300">
            Pas encore de données — traite un document depuis l&apos;onglet Importer &amp; traiter.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-violet-50">
            {stats.recent.map((wo) => (
              <li key={wo.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                <span className="font-mono font-semibold text-violet-800">
                  CWO {wo.order_number || "—"}
                </span>
                <span className="text-violet-400">{wo.date || "—"}</span>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-violet-700">
                  {wo.ac_registration || "—"}
                </span>
                <span className="truncate text-violet-400">{wo.airline_customer || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="glass animate-fade-up rounded-2xl p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <p className="text-xs font-medium text-violet-400">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-violet-900">{value}</p>
    </div>
  );
}
