"use client";

import { ReactNode } from "react";

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  badge?: number;
}

interface SidebarProps {
  activeKey: string;
  onSelect: (key: string) => void;
  groups: { title?: string; items: NavItem[] }[];
  docCount: number;
  onNewSession: () => void;
}

export default function Sidebar({ activeKey, onSelect, groups, docCount, onNewSession }: SidebarProps) {
  return (
    <aside className="flex h-full w-full flex-col gap-6 overflow-y-auto scrollbar-thin p-5">
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-violet-400 text-white shadow-glow">
          <PlaneIcon />
        </div>
        <div className="min-w-0">
          <p className="font-display truncate text-sm font-semibold leading-tight text-violet-950">
            Sabena IDP
          </p>
          <p className="truncate text-[11px] text-violet-400">Ordre Client — Work Orders</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-5">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.title && (
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-violet-400">
                {group.title}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => {
                const active = activeKey === item.key;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => !item.disabled && onSelect(item.key)}
                      disabled={item.disabled}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 ${
                        item.disabled
                          ? "cursor-not-allowed text-violet-200"
                          : active
                          ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-glow"
                          : "text-violet-600 hover:bg-violet-50 hover:text-violet-900"
                      }`}
                    >
                      <span
                        className={`shrink-0 ${
                          item.disabled ? "text-violet-200" : active ? "text-white" : "text-violet-400 group-hover:text-violet-600"
                        }`}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {typeof item.badge === "number" && item.badge > 0 && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                            active ? "bg-white/25 text-white" : "bg-violet-100 text-violet-600"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-violet-100 pt-4">
        <div className="flex items-center justify-between px-1 text-[11px] text-violet-400">
          <span>{docCount} document{docCount > 1 ? "s" : ""} disponible{docCount > 1 ? "s" : ""}</span>
          {docCount > 0 && (
            <button
              onClick={onNewSession}
              className="font-semibold text-violet-500 underline decoration-violet-200 underline-offset-2 hover:text-violet-700"
            >
              Nouvelle session
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function PlaneIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12l18-8-6 8 6 8-18-8zm0 0h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --------------------------------------------------------------------------
// Icônes de navigation (traits simples, cohérentes avec le reste de l'UI)
// --------------------------------------------------------------------------

const iconProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none" } as const;
const strokeProps = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const NavIcons = {
  dashboard: (
    <svg {...iconProps}>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" {...strokeProps} />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" {...strokeProps} />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" {...strokeProps} />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" {...strokeProps} />
    </svg>
  ),
  import: (
    <svg {...iconProps}>
      <path d="M12 16V4M12 4l-4 4M12 4l4 4M5 20h14" {...strokeProps} />
    </svg>
  ),
  extraction: (
    <svg {...iconProps}>
      <path d="M4 6h16M4 12h16M4 18h10" {...strokeProps} />
    </svg>
  ),
  technical: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" {...strokeProps} />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
        {...strokeProps}
      />
    </svg>
  ),
  correction: (
    <svg {...iconProps}>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" {...strokeProps} />
    </svg>
  ),
  materials: (
    <svg {...iconProps}>
      <path d="M20 7L12 3 4 7m16 0l-8 4m8-4v10l-8 4M4 7l8 4m-8-4v10l8 4m0-10v10" {...strokeProps} />
    </svg>
  ),
  export: (
    <svg {...iconProps}>
      <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" {...strokeProps} />
    </svg>
  ),
  analysis: (
    <svg {...iconProps}>
      <path d="M4 19V9m6 10V4m6 15v-7" {...strokeProps} />
    </svg>
  ),
  statistics: (
    <svg {...iconProps}>
      <path d="M4 19V9m6 10V4m6 15v-7" {...strokeProps} />
      <circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="2.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16" cy="9" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  search: (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" {...strokeProps} />
      <path d="M21 21l-4.3-4.3" {...strokeProps} />
    </svg>
  ),
};
