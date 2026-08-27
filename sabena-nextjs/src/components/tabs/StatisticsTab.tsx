"use client";

import { useEffect, useState } from "react";
import { fetchDashboardStats, fetchHoursAnomalies, fetchHoursByWork } from "@/lib/api";
import {
  DashboardStats,
  ENGINE_LABELS,
  HoursAnomaly,
  HoursByWorkRow,
  HoursByWorkStats,
  ProcessedDocument,
} from "@/lib/types";
import { downloadCSV, downloadTablePdf } from "@/lib/export";
import ConfidenceBar from "@/components/ConfidenceBar";

const CSV_COLUMNS = [
  { key: "work_required", label: "Catégorie de travaux" },
  { key: "count", label: "Nb de CWO" },
  { key: "min_mh", label: "MH min" },
  { key: "max_mh", label: "MH max" },
  { key: "avg_mh", label: "MH moyen" },
];

const ANOMALY_CSV_COLUMNS = [
  { key: "order_number", label: "N° d'ordre" },
  { key: "date", label: "Date" },
  { key: "ac_registration", label: "Immatriculation" },
  { key: "category", label: "Catégorie" },
  { key: "required_mh", label: "MH observé" },
  { key: "group_avg_mh", label: "MH moyen du groupe" },
  { key: "z_score", label: "Écart (z-score)" },
  { key: "direction", label: "Sens" },
];

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr", "05": "Mai", "06": "Juin",
  "07": "Juil", "08": "Août", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};
function monthLabel(ym: string) {
  const [, mm] = ym.split("-");
  return MONTH_LABELS[mm] ?? ym;
}

export default function StatisticsTab({
  onDemoFallback,
  docs,
}: {
  onDemoFallback: () => void;
  docs: ProcessedDocument[];
}) {
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  const [dashLoading, setDashLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<HoursByWorkStats | null>(null);
  const [anomalies, setAnomalies] = useState<HoursAnomaly[]>([]);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);

  const load = async (q?: string) => {
    setLoading(true);
    try {
      const s = await fetchHoursByWork(q, onDemoFallback);
      setStats(s);
    } finally {
      setLoading(false);
    }
  };

  const loadAnomalies = async () => {
    setAnomaliesLoading(true);
    try {
      const a = await fetchHoursAnomalies(onDemoFallback);
      setAnomalies(a);
    } finally {
      setAnomaliesLoading(false);
    }
  };

  useEffect(() => {
    setDashLoading(true);
    fetchDashboardStats(onDemoFallback).then((s) => {
      setDashStats(s);
      setDashLoading(false);
    });
    load();
    loadAnomalies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = stats?.rows ?? [];
  const overall = stats?.overall;

  const exportRows = () =>
    rows.map((r) => ({
      work_required: r.work_required,
      count: r.count,
      min_mh: r.min_mh ?? "",
      max_mh: r.max_mh ?? "",
      avg_mh: r.avg_mh ?? "",
    }));

  const totalCwo = dashStats?.total_work_orders ?? 0;
  const missingMh = dashStats?.missing_mh_count ?? 0;

  return (
    <div className="animate-fade-up flex flex-col gap-10">
      <div>
        <h3 className="text-base font-semibold text-violet-900">Statistiques</h3>
        <p className="text-xs text-violet-400">
          Toutes les statistiques de l&apos;application sont regroupées ici : vue d&apos;ensemble de
          la base, session de traitement en cours, marge des heures par travail demandé, et
          anomalies détectées.
        </p>
      </div>

      {/* ============ VUE D'ENSEMBLE (base persistante) ============ */}
      <Section title="Vue d'ensemble de la base">
        {dashLoading || !dashStats ? (
          <Loading />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Kpi label="MH moyen requis" value={dashStats.avg_required_mh.toFixed(2)} icon="⏱️" />
              <Kpi
                label="Confiance moyenne"
                value={dashStats.avg_confidence != null ? `${Math.round(dashStats.avg_confidence * 100)}%` : "—"}
                icon="🎯"
              />
              <Kpi label="À vérifier" value={String(dashStats.needs_review_count ?? 0)} icon="⚠️" />
              <Kpi label="CWO enregistrés" value={String(totalCwo)} icon="📋" />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ChartCard title="Ordres de travail par mois">
                {dashStats.by_month.length === 0 ? (
                  <EmptyChart />
                ) : (
                  <BarsChart data={dashStats.by_month} labelFn={monthLabel} />
                )}
              </ChartCard>

              <ChartCard title="Répartition par type avion">
                {dashStats.by_ac_type.length === 0 ? <EmptyChart /> : <HBarsChart data={dashStats.by_ac_type} mono />}
              </ChartCard>

              <ChartCard title="Top immatriculations">
                {dashStats.top_registrations.length === 0 ? (
                  <EmptyChart />
                ) : (
                  <HBarsChart data={dashStats.top_registrations} mono />
                )}
              </ChartCard>

              {dashStats.by_engine && dashStats.by_engine.length > 0 && (
                <ChartCard title="Moteur d'extraction utilisé">
                  <HBarsChart data={dashStats.by_engine} />
                </ChartCard>
              )}
            </div>
          </>
        )}
      </Section>

      {/* ============ SESSION EN COURS ============ */}
      {docs.length > 0 && <SessionSection docs={docs} />}

      {/* ============ MARGE DES HEURES PAR TRAVAIL DEMANDÉ ============ */}
      <Section title="Marge des heures par travail demandé">
        <p className="-mt-2 mb-4 text-xs text-violet-400">
          Les travaux demandés sont regroupés par <strong>catégorie</strong> (action + pièce/zone
          reconnue par mots-clés — ex. &quot;Remplacement joint hublot FWD&quot; et &quot;remplacement joint
          hublot fwd + ctrl&quot; tombent dans la même catégorie), pas par correspondance texte
          strictement identique.
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label="CWO avec MH renseigné" value={String(overall?.count ?? 0)} icon="📋" />
          <Kpi label="MH minimum" value={overall?.min_mh != null ? overall.min_mh.toFixed(2) : "—"} icon="⬇️" />
          <Kpi label="MH maximum" value={overall?.max_mh != null ? overall.max_mh.toFixed(2) : "—"} icon="⬆️" />
          <Kpi label="MH moyen" value={overall?.avg_mh != null ? overall.avg_mh.toFixed(2) : "—"} icon="📊" />
        </div>

        {!dashLoading && totalCwo > 0 && missingMh > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700 ring-1 ring-amber-200">
            ⚠️ {missingMh} CWO sur {totalCwo} ont un travail demandé renseigné mais{" "}
            <strong>pas de MH (heures) exploitable</strong> — champ vide ou format non reconnu sur
            le document source. C&apos;est pour ça que le MH min/max peut rester à «&nbsp;—&nbsp;»
            pour certaines catégories : ce n&apos;est pas un bug, il manque juste la donnée source.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(query)}
              placeholder="Filtrer par mot-clé (catégorie ou texte brut)…"
              className="w-72 rounded-xl border border-violet-100 bg-white/80 px-3.5 py-2.5 text-sm text-violet-900 shadow-sm transition-all placeholder:text-violet-300 focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
            />
            <button
              onClick={() => load(query)}
              className="rounded-xl border border-violet-200 bg-white/70 px-4 py-2.5 text-sm font-semibold text-violet-700 transition-all hover:bg-violet-50"
            >
              Filtrer
            </button>
          </div>

          {rows.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadCSV("statistiques_heures_par_travail", CSV_COLUMNS, exportRows())}
                className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-all hover:bg-violet-50"
              >
                📄 CSV
              </button>
              <button
                onClick={() =>
                  downloadTablePdf(
                    "statistiques_heures_par_travail",
                    "Marge des heures par catégorie de travaux",
                    `${rows.length} catégorie(s) — MH global : min ${overall?.min_mh?.toFixed(2) ?? "—"} / max ${overall?.max_mh?.toFixed(2) ?? "—"} / moyen ${overall?.avg_mh?.toFixed(2) ?? "—"}`,
                    ["Catégorie", "Nb de CWO", "MH min", "MH max", "MH moyen"],
                    rows.map((r) => [
                      r.work_required,
                      r.count,
                      r.min_mh?.toFixed(2) ?? "—",
                      r.max_mh?.toFixed(2) ?? "—",
                      r.avg_mh?.toFixed(2) ?? "—",
                    ])
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-all hover:bg-violet-50"
              >
                🧾 PDF
              </button>
            </div>
          )}
        </div>

        <div className="glass mt-4 overflow-hidden rounded-2xl shadow-soft">
          {loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-violet-400">
              Aucune donnée. Traite quelques CWO puis reviens ici pour voir apparaître la
              statistique.
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-violet-50/80 text-left text-xs uppercase tracking-wide text-violet-500">
                  <th className="px-4 py-3 font-semibold">Catégorie de travaux</th>
                  <th className="px-4 py-3 font-semibold">Nb de CWO</th>
                  <th className="px-4 py-3 font-semibold">MH min</th>
                  <th className="px-4 py-3 font-semibold">MH max</th>
                  <th className="px-4 py-3 font-semibold">MH moyen</th>
                  <th className="px-4 py-3 font-semibold">Libellés bruts (exemples)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <RowLine key={`${r.work_required}-${i}`} row={r} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      {/* ============ ANOMALIES ============ */}
      <Section title="Anomalies détectées">
        <p className="-mt-2 mb-4 text-xs text-violet-400">
          CWO dont le MH requis s&apos;écarte fortement (≥ 1,8 écart-type) de la moyenne observée
          pour leur catégorie de travaux — à vérifier manuellement (saisie erronée, ou cas
          réellement exceptionnel).
        </p>

        <div className="mb-3 flex items-center justify-end gap-2">
          {anomalies.length > 0 && (
            <>
              <button
                onClick={() =>
                  downloadCSV(
                    "anomalies_heures",
                    ANOMALY_CSV_COLUMNS,
                    anomalies.map((a) => ({ ...a, order_number: a.order_number || "" }))
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-all hover:bg-violet-50"
              >
                📄 CSV
              </button>
              <button
                onClick={() =>
                  downloadTablePdf(
                    "anomalies_heures",
                    "Anomalies — MH hors norme par catégorie",
                    `${anomalies.length} anomalie(s) détectée(s)`,
                    ["N° d'ordre", "Date", "Immat.", "Catégorie", "MH observé", "MH moyen groupe", "Écart (z)"],
                    anomalies.map((a) => [
                      a.order_number || "—",
                      a.date || "—",
                      a.ac_registration || "—",
                      a.category,
                      a.required_mh.toFixed(2),
                      a.group_avg_mh.toFixed(2),
                      `${a.z_score > 0 ? "+" : ""}${a.z_score}`,
                    ])
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-all hover:bg-violet-50"
              >
                🧾 PDF
              </button>
            </>
          )}
        </div>

        <div className="glass overflow-hidden rounded-2xl shadow-soft">
          {anomaliesLoading ? (
            <Loading />
          ) : anomalies.length === 0 ? (
            <div className="p-10 text-center text-sm text-violet-400">
              Aucune anomalie détectée pour l&apos;instant (il faut au moins 3 CWO avec MH renseigné
              dans une même catégorie pour qu&apos;une anomalie puisse être calculée).
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-violet-50/80 text-left text-xs uppercase tracking-wide text-violet-500">
                  <th className="px-4 py-3 font-semibold">N° d&apos;ordre</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Immat.</th>
                  <th className="px-4 py-3 font-semibold">Catégorie</th>
                  <th className="px-4 py-3 font-semibold">MH observé</th>
                  <th className="px-4 py-3 font-semibold">MH moyen (groupe)</th>
                  <th className="px-4 py-3 font-semibold">Écart</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a) => (
                  <tr key={a.id} className="border-t border-violet-50 hover:bg-violet-50/30">
                    <td className="px-4 py-3 font-mono text-violet-900">{a.order_number || "—"}</td>
                    <td className="px-4 py-3 text-violet-700">{a.date || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-violet-600">
                      {a.ac_registration || "—"}
                    </td>
                    <td className="px-4 py-3 text-violet-700">{a.category}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-violet-900">
                      {a.required_mh.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-violet-500">
                      {a.group_avg_mh.toFixed(2)} (n={a.group_size})
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                          a.direction === "au-dessus"
                            ? "bg-rose-50 text-rose-700 ring-rose-200"
                            : "bg-sky-50 text-sky-700 ring-sky-200"
                        }`}
                      >
                        {a.z_score > 0 ? "+" : ""}
                        {a.z_score}σ {a.direction}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>
    </div>
  );
}

// --------------------------------------------------------------------------
// Session en cours — déplacé depuis l'ancien onglet "Analyse"
// --------------------------------------------------------------------------

function SessionSection({ docs }: { docs: ProcessedDocument[] }) {
  const results = docs.map((d) => d.result);
  const nDocs = results.length;
  const nReview = results.filter((r) => r.requires_review).length;
  const avgConf = nDocs ? results.reduce((s, r) => s + r.global_confidence_score, 0) / nDocs : 0;
  const avgTime = nDocs ? results.reduce((s, r) => s + r.processing_time_s, 0) / nDocs : 0;

  const fieldStats: Record<string, { total: number; count: number; flagged: number }> = {};
  for (const r of results) {
    for (const [k, fv] of Object.entries(r.extraction.fields)) {
      fieldStats[k] ??= { total: 0, count: 0, flagged: 0 };
      fieldStats[k].total += fv.confidence;
      fieldStats[k].count += 1;
      if (fv.needs_review) fieldStats[k].flagged += 1;
    }
  }
  const fieldRows = Object.entries(fieldStats)
    .map(([k, s]) => ({ field: k, avg: s.total / s.count, flagged: s.flagged }))
    .sort((a, b) => a.avg - b.avg);

  return (
    <Section title="Session de traitement en cours">
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Documents traités" value={String(nDocs)} icon="📄" />
        <Kpi label="Fiables" value={String(nDocs - nReview)} icon="✅" />
        <Kpi label="Confiance moyenne" value={`${Math.round(avgConf * 100)}%`} icon="🎯" />
        <Kpi label="Temps moyen / doc" value={`${avgTime.toFixed(1)}s`} icon="⏱️" />
      </div>

      <div className="glass mb-5 overflow-hidden rounded-2xl shadow-soft">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-violet-50/80 text-left text-xs uppercase tracking-wide text-violet-500">
              <th className="px-4 py-3 font-semibold">Document</th>
              <th className="px-4 py-3 font-semibold">Moteur</th>
              <th className="px-4 py-3 font-semibold">Statut</th>
              <th className="px-4 py-3 font-semibold">Confiance</th>
              <th className="px-4 py-3 font-semibold">Champs à revoir</th>
              <th className="px-4 py-3 font-semibold">Temps (s)</th>
            </tr>
          </thead>
          <tbody>
            {docs.map(({ name, result }, i) => (
              <tr key={i} className="border-t border-violet-50 hover:bg-violet-50/50">
                <td className="max-w-[200px] truncate px-4 py-3 font-medium text-violet-900">{name}</td>
                <td className="px-4 py-3 text-xs text-violet-500">
                  {ENGINE_LABELS[result.engine_used] ?? result.engine_used}
                </td>
                <td className="px-4 py-3">
                  {result.requires_review ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                      À vérifier
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      Fiable
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16">
                      <ConfidenceBar value={result.global_confidence_score * 100} size="sm" />
                    </div>
                    <span className="text-xs tabular-nums text-violet-500">
                      {Math.round(result.global_confidence_score * 100)}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  {Object.values(result.extraction.fields).filter((f) => f.needs_review).length}
                </td>
                <td className="px-4 py-3 text-xs tabular-nums">{result.processing_time_s.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fieldRows.length > 0 && (
        <div className="glass flex flex-col gap-3 rounded-2xl p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-500">
            Confiance moyenne par champ (tous documents de la session)
          </p>
          {fieldRows.map((row) => (
            <div key={row.field} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-xs font-medium text-violet-700">{row.field}</span>
              <div className="flex-1">
                <ConfidenceBar value={row.avg} />
              </div>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-violet-500">
                {row.avg.toFixed(0)}%
              </span>
              {row.flagged > 0 && <span className="shrink-0 text-xs text-amber-500">⚠ {row.flagged}×</span>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// --------------------------------------------------------------------------
// Composants utilitaires
// --------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-4 text-sm font-semibold text-violet-800">{title}</p>
      {children}
    </section>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-violet-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
      Chargement…
    </div>
  );
}

function BarsChart({ data, labelFn }: { data: [string, number][]; labelFn: (k: string) => string }) {
  const max = Math.max(1, ...data.map(([, c]) => c));
  return (
    <div className="flex h-40 items-end gap-3 px-1">
      {data.map(([k, count]) => (
        <div key={k} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="text-[11px] font-semibold text-violet-600">{count}</span>
          <div
            className="w-full max-w-[28px] rounded-t-lg bg-gradient-to-t from-violet-600 to-violet-400 transition-all duration-700"
            style={{ height: `${Math.max(6, (count / max) * 100)}%` }}
          />
          <span className="text-[10px] text-violet-400">{labelFn(k)}</span>
        </div>
      ))}
    </div>
  );
}

function HBarsChart({ data, mono }: { data: [string, number][]; mono?: boolean }) {
  const max = Math.max(1, ...data.map(([, c]) => c));
  return (
    <div className="flex flex-col gap-3">
      {data.map(([label, count]) => (
        <div key={label} className="flex items-center gap-3">
          <span className={`w-24 shrink-0 truncate text-xs font-medium text-violet-700 ${mono ? "font-mono" : ""}`}>
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
      Pas encore de données — enregistre des ordres de travail depuis l&apos;onglet Export final.
    </p>
  );
}

function RowLine({ row }: { row: HoursByWorkRow }) {
  return (
    <tr className="border-t border-violet-50 hover:bg-violet-50/30">
      <td className="px-4 py-3 font-medium text-violet-900">{row.work_required}</td>
      <td className="px-4 py-3 tabular-nums text-violet-700">{row.count}</td>
      <td className="px-4 py-3 tabular-nums text-violet-700">{row.min_mh?.toFixed(2) ?? "—"}</td>
      <td className="px-4 py-3 tabular-nums text-violet-700">{row.max_mh?.toFixed(2) ?? "—"}</td>
      <td className="px-4 py-3 tabular-nums font-semibold text-violet-900">
        {row.avg_mh?.toFixed(2) ?? "—"}
      </td>
      <td className="max-w-sm px-4 py-3 text-xs text-violet-400">
        <span className="line-clamp-2">{row.example_texts.join(" · ") || "—"}</span>
      </td>
    </tr>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-xl bg-white/60 p-4 text-center ring-1 ring-violet-100">
      <p className="text-xl">{icon}</p>
      <p className="font-display mt-1 text-2xl font-bold text-violet-900">{value}</p>
      <p className="mt-0.5 text-[11px] font-medium text-violet-400">{label}</p>
    </div>
  );
}
