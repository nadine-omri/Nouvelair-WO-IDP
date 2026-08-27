import { ManualData, ValidationTuple, PipelineResult, MANUAL_FIELD_KEYS } from "./types";

export const AC_TYPES = ["A319", "A320", "A321", "A330", "A340", "B737", "B738"];

export function isValidDateFr(v: string): boolean {
  if (!v) return false;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return (
    d.getFullYear() === Number(yyyy) &&
    d.getMonth() === Number(mm) - 1 &&
    d.getDate() === Number(dd)
  );
}

export function normalizeManualData(data: ManualData): ManualData {
  return {
    ...data,
    ac_type: (data.ac_type || "").toUpperCase().trim(),
    ac_registration: (data.ac_registration || "").toUpperCase().replace(/\s/g, "").trim(),
    required_mh: (data.required_mh || "").replace(",", ".").trim(),
  };
}

export function validateManualData(data: ManualData): ValidationTuple[] {
  const issues: ValidationTuple[] = [];

  const required: (keyof ManualData)[] = [
    "date",
    "ac_type",
    "ac_registration",
    "airline_customer",
  ];
  for (const f of required) {
    if (!String(data[f] || "").trim()) {
      issues.push({ field: f, level: "error", message: "Champ obligatoire manquant" });
    }
  }

  if (data.date && !isValidDateFr(data.date)) {
    issues.push({ field: "date", level: "error", message: "Format date attendu : jj/mm/aaaa" });
  }

  if (data.customer_rep_date && !isValidDateFr(data.customer_rep_date)) {
    issues.push({
      field: "customer_rep_date",
      level: "warning",
      message: "Date représentant invalide (jj/mm/aaaa)",
    });
  }

  if (data.ac_type && !AC_TYPES.includes(data.ac_type.toUpperCase())) {
    issues.push({
      field: "ac_type",
      level: "warning",
      message: `Type avion inattendu : ${data.ac_type}`,
    });
  }

  const reg = String(data.ac_registration || "").toUpperCase().replace(/\s/g, "");
  if (reg && !/^TS-[A-Z0-9]{3,5}$/.test(reg)) {
    issues.push({
      field: "ac_registration",
      level: "warning",
      message: "Format recommandé : TS-XXX (3 à 5 caractères)",
    });
  }

  const mh = String(data.required_mh || "").trim();
  if (mh) {
    const v = parseFloat(mh.replace(",", "."));
    if (Number.isNaN(v)) {
      issues.push({ field: "required_mh", level: "warning", message: "MH doit être numérique" });
    } else if (v <= 0 || v > 200) {
      issues.push({ field: "required_mh", level: "warning", message: "MH hors plage raisonnable" });
    }
  }

  return issues;
}

export function buildInitDataFromOcr(result: PipelineResult): ManualData {
  const out = {} as ManualData;
  for (const k of MANUAL_FIELD_KEYS) {
    out[k] = result.extraction.fields[k]?.value ?? "";
  }
  return out;
}
