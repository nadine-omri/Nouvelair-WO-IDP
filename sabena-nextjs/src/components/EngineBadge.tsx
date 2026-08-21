import { ENGINE_LABELS } from "@/lib/types";

const STYLES: Record<string, string> = {
  gemini: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  claude: "bg-violet-100 text-violet-800 ring-1 ring-violet-300",
  ollama: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  local_ocr: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  local_ocr_fallback: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
};

export default function EngineBadge({ engine }: { engine: string }) {
  const label = ENGINE_LABELS[engine] ?? engine;
  const style = STYLES[engine] ?? "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
