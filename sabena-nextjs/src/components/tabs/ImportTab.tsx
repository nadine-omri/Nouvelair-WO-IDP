"use client";

import { useCallback, useRef, useState } from "react";

interface ImportTabProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  alignTemplate: boolean;
  onAlignTemplateChange: (v: boolean) => void;
  useVision: boolean;
  onUseVisionChange: (v: boolean) => void;
  onProcess: () => void;
  processing: boolean;
  progress: { done: number; total: number; currentName: string } | null;
}

const ACCEPTED = [".png", ".jpg", ".jpeg", ".pdf"];

export default function ImportTab({
  files,
  onFilesChange,
  alignTemplate,
  onAlignTemplateChange,
  useVision,
  onUseVisionChange,
  onProcess,
  processing,
  progress,
}: ImportTabProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming) return;
      const valid = Array.from(incoming).filter((f) =>
        ACCEPTED.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      onFilesChange([...files, ...valid]);
    },
    [files, onFilesChange]
  );

  const removeFile = (idx: number) => {
    onFilesChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold text-violet-900">Importer &amp; traiter des documents</h3>
        <p className="text-xs text-violet-400">
          Images ou PDF scannés. Un PDF contenant plusieurs ordres de travail scannés est détecté
          intelligemment : chaque page est traitée et enregistrée séparément comme un CWO distinct.
        </p>
      </div>

      <div className="glass rounded-2xl p-5 shadow-soft">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-500">Import</p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`group cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 ${
            dragOver
              ? "border-violet-500 bg-violet-100/70 scale-[1.01]"
              : "border-violet-200 bg-white/50 hover:border-violet-400 hover:bg-violet-50/70"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 transition-transform duration-300 group-hover:scale-110">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 16V4M12 4l-4 4M12 4l4 4M5 20h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-violet-900">Dépose tes fichiers ici</p>
          <p className="mt-1 text-xs text-violet-400">
            Images ou PDF scannés — plusieurs fichiers acceptés, clique ou glisse-dépose
          </p>
        </div>

        {files.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="animate-fade-up flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-violet-900 shadow-sm ring-1 ring-violet-100"
              >
                <span className="truncate font-medium">{f.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  className="shrink-0 rounded-full p-1 text-violet-300 transition-colors hover:bg-violet-100 hover:text-violet-600"
                  aria-label={`Retirer ${f.name}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass rounded-2xl p-5 shadow-soft">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-500">Options</p>
        <div className="flex flex-col gap-3">
          <ToggleRow
            label="Aligner sur le template de référence"
            checked={alignTemplate}
            onChange={onAlignTemplateChange}
          />
          <ToggleRow
            label="Extraction vision (Gemini → Ollama → local)"
            hint="Chaîne de secours automatique. Décoche pour forcer le pipeline 100% local (TrOCR/Tesseract)."
            checked={useVision}
            onChange={onUseVisionChange}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 text-xs text-violet-600">
        💾 Chaque page traitée est automatiquement enregistrée dans la base de données — accessible
        depuis « Recherche (base de données) », même après fermeture de l&apos;application.
      </div>

      <div className="flex flex-col gap-3">
        {processing && progress && (
          <div className="animate-fade-in rounded-xl bg-violet-50 px-3 py-2.5 text-xs text-violet-700 ring-1 ring-violet-100">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="truncate font-medium">{progress.currentName || "Finalisation…"}</span>
              <span className="shrink-0 tabular-nums text-violet-400">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all duration-500"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={onProcess}
          disabled={files.length === 0 || processing}
          className="shine relative flex w-fit items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-glow transition-all duration-300 hover:from-violet-700 hover:to-violet-600 hover:shadow-lift disabled:cursor-not-allowed disabled:from-violet-200 disabled:to-violet-200 disabled:text-violet-400 disabled:shadow-none"
        >
          {processing ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Traitement…
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
              </svg>
              Traiter les documents
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/50 p-3 ring-1 ring-violet-100 transition-colors hover:bg-white/80">
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="absolute inset-0 rounded-full bg-violet-200 transition-colors duration-300 peer-checked:bg-violet-600" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-300 peer-checked:translate-x-4" />
      </span>
      <span>
        <span className="block text-sm font-medium text-violet-900">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-violet-400">{hint}</span>}
      </span>
    </label>
  );
}
