import React from "react";

/** Petit rendu markdown maison (## titres, **gras**, listes "- "), suffisant
 * pour le format des rapports générés par LLM (prix, document) ; évite
 * d'ajouter une dépendance externe. */
export default function MarkdownReport({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="ml-4 list-disc space-y-1 text-sm text-violet-700">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushList(`list-${i}`);
      blocks.push(
        <h4 key={i} className="mt-4 text-sm font-bold uppercase tracking-wide text-violet-600 first:mt-0">
          {trimmed.slice(3)}
        </h4>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listBuffer.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushList(`list-${i}`);
    } else {
      flushList(`list-${i}`);
      blocks.push(
        <p key={i} className="text-sm leading-relaxed text-violet-700">
          {renderInline(trimmed)}
        </p>
      );
    }
  });
  flushList("list-end");

  return <div className="flex flex-col gap-2">{blocks}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-violet-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
