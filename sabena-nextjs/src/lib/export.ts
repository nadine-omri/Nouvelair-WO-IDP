import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FIELD_LABELS, ManualData, MaterialRow, WorkOrderRecord } from "./types";

// --------------------------------------------------------------------------
// CSV
// --------------------------------------------------------------------------

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Génère et déclenche le téléchargement d'un fichier CSV à partir de lignes
 * (tableau d'objets) et d'une liste ordonnée de colonnes {key, label}. */
export function downloadCSV(
  filename: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[]
) {
  const header = columns.map((c) => csvEscape(c.label)).join(";");
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c.key])).join(";"));
  // BOM UTF-8 pour qu'Excel (FR) affiche correctement les accents.
  const csv = "\uFEFF" + [header, ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------------------------
// PDF — fiche CWO (un seul document)
// --------------------------------------------------------------------------

const BRAND_VIOLET: [number, number, number] = [124, 58, 237];
const BRAND_VIOLET_DARK: [number, number, number] = [76, 29, 149];

function pdfHeader(doc: jsPDF, title: string, subtitle?: string) {
  doc.setFillColor(...BRAND_VIOLET);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 14, 13);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(subtitle, 14, 19);
  }
  doc.setTextColor(30, 20, 60);
}

function pdfFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 130, 160);
    doc.text(
      `Sabena IDP — Ordre Client — généré le ${new Date().toLocaleString("fr-FR")} — page ${i}/${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    );
  }
}

/** Génère et télécharge une fiche PDF complète (données extraites +
 * matériaux) pour un seul CWO, en session (ManualData) ou depuis la base
 * (WorkOrderRecord). */
export function downloadWorkOrderPdf(
  docName: string,
  fields: ManualData | Record<string, string | null>,
  materials: MaterialRow[],
  meta?: { engineUsed?: string | null; globalConfidence?: number | null; woId?: number | null }
) {
  const doc = new jsPDF();
  pdfHeader(
    doc,
    `Ordre Client (CWO) — ${meta?.woId ? `#${meta.woId}` : docName}`,
    docName
  );

  const fieldRows = Object.entries(FIELD_LABELS).map(([key, label]) => [
    label,
    (fields as Record<string, string | null | undefined>)[key] || "—",
  ]);

  autoTable(doc, {
    startY: 28,
    head: [["Champ", "Valeur"]],
    body: fieldRows,
    headStyles: { fillColor: BRAND_VIOLET_DARK },
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
  });

  const afterFieldsY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  if (materials.length > 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Matériaux vendus", 14, afterFieldsY + 10);
    autoTable(doc, {
      startY: afterFieldsY + 14,
      head: [["Qté", "Désignation", "Référence", "Prix"]],
      body: materials.map((m) => [
        m.qty || "—",
        m.designation || "—",
        m.reference || "—",
        m.price != null ? `${m.price.toFixed(2)}` : m.price_raw || "—",
      ]),
      headStyles: { fillColor: BRAND_VIOLET_DARK },
      styles: { fontSize: 9, cellPadding: 2.5 },
    });
  }

  if (meta?.engineUsed || meta?.globalConfidence != null) {
    const y =
      materials.length > 0
        ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
        : afterFieldsY + 10;
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 110, 150);
    const parts = [];
    if (meta.engineUsed) parts.push(`Moteur d'extraction : ${meta.engineUsed}`);
    if (meta.globalConfidence != null) parts.push(`Confiance globale : ${Math.round(meta.globalConfidence * 100)}%`);
    doc.text(parts.join("   —   "), 14, y);
  }

  pdfFooter(doc);
  doc.save(`${docName.replace(/\.[^.]+$/, "")}_cwo.pdf`);
}

// --------------------------------------------------------------------------
// PDF — tableau générique (résultats de recherche / statistiques)
// --------------------------------------------------------------------------

export function downloadTablePdf(
  filename: string,
  title: string,
  subtitle: string | undefined,
  columns: string[],
  rows: (string | number)[][]
) {
  const doc = new jsPDF({ orientation: columns.length > 5 ? "landscape" : "portrait" });
  pdfHeader(doc, title, subtitle);
  autoTable(doc, {
    startY: 28,
    head: [columns],
    body: rows,
    headStyles: { fillColor: BRAND_VIOLET_DARK },
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    alternateRowStyles: { fillColor: [246, 243, 255] },
  });
  pdfFooter(doc);
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

// --------------------------------------------------------------------------
// Adaptateurs pour les résultats de recherche (WorkOrderRecord[])
// --------------------------------------------------------------------------

export const SEARCH_EXPORT_COLUMNS: { key: string; label: string }[] = [
  { key: "id", label: "ID CWO" },
  { key: "order_number", label: FIELD_LABELS.order_number },
  { key: "date", label: FIELD_LABELS.date },
  { key: "lieu_place", label: FIELD_LABELS.lieu_place },
  { key: "ac_type", label: FIELD_LABELS.ac_type },
  { key: "ac_registration", label: FIELD_LABELS.ac_registration },
  { key: "airline_customer", label: FIELD_LABELS.airline_customer },
  { key: "required_mh", label: FIELD_LABELS.required_mh },
  { key: "work_required", label: FIELD_LABELS.work_required },
  { key: "customer_rep_name", label: FIELD_LABELS.customer_rep_name },
  { key: "customer_rep_date", label: FIELD_LABELS.customer_rep_date },
  { key: "engine_used", label: "Moteur d'extraction" },
  { key: "global_confidence_score", label: "Confiance" },
];

export function workOrdersToCsvRows(records: WorkOrderRecord[]): Record<string, unknown>[] {
  return records.map((r) => ({
    ...r,
    global_confidence_score:
      r.global_confidence_score != null ? `${Math.round(r.global_confidence_score * 100)}%` : "",
  }));
}

export function workOrdersToPdfRows(records: WorkOrderRecord[]): (string | number)[][] {
  return records.map((r) => [
    r.id,
    r.order_number || "—",
    r.date || "—",
    r.ac_type || "—",
    r.ac_registration || "—",
    r.airline_customer || "—",
    r.required_mh || "—",
  ]);
}
