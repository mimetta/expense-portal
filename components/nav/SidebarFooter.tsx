"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Person, role, and the collapse toggle, at the foot of the sidebar
 * (docs/sidebar-nav-mockup.html).
 *
 * The mockup shows the person row but not where Sign out went — the old top
 * bar carried the email and a Sign out button, and both still have to be
 * reachable. So the person row is a button that opens a small popover with
 * the full email and Sign out. That is the only piece of chrome here the
 * mockup does not draw; nothing was removed.
 */
export default function SidebarFooter({
  name,
  email,
  role,
  collapsed,
  onToggleCollapse,
  onSignOut,
  /** The drawer has no collapse toggle — it is open or it is not. */
  showCollapseToggle = true,
}: {
  name: string;
  email: string;
  role: string;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onSignOut: () => void;
  showCollapseToggle?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const initials =
    (name || email)
      .split(/[\s.@]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const ring =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--kf-palette-lime)]";

  return (
    <div
      ref={rootRef}
      className={`relative border-t py-2 ${collapsed ? "px-1.5" : "px-2.5"}`}
      style={{ borderColor: "color-mix(in srgb, var(--kf-text-on-brand) 13%, transparent)" }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
            buttonRef.current?.focus();
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? `${name || email} — ${role}` : undefined}
        aria-label={collapsed ? `${name || email}, ${role} — account menu` : undefined}
        className={`flex w-full items-center gap-2.5 rounded-md py-1.5 text-left hover:bg-kf-palette-deep-green-hover ${ring} ${
          collapsed ? "justify-center px-0" : "px-2"
        }`}
        style={{ color: "var(--kf-palette-on-green-muted)" }}
      >
        <span
          aria-hidden
          className="flex h-[25px] w-[25px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold"
          style={{
            background: "var(--kf-palette-sage)",
            color: "var(--kf-palette-deep-green)",
          }}
        >
          {initials}
        </span>
        {!collapsed && (
          <span className="flex min-w-0 flex-col leading-[1.25]">
            <span className="truncate text-[12px] font-semibold text-kf-text-on-brand">
              {name || email}
            </span>
            <span className="text-[10px]" style={{ color: "var(--kf-palette-on-green-faint)" }}>
              {role}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%-4px)] left-2.5 right-2.5 z-30 rounded-[10px] border border-kf-border bg-kf-bg-surface p-1.5 shadow-lg"
        >
          <p className="truncate px-2 pb-1.5 pt-1 text-[11px] text-kf-text-hint">{email}</p>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center rounded-md px-2 py-2 text-left text-[12.5px] font-medium text-kf-text-primary hover:bg-kf-bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--kf-border-focus)]"
          >
            Sign out
          </button>
        </div>
      )}

      {showCollapseToggle && onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className={`mt-0.5 flex w-full items-center gap-2.5 rounded-md py-1.5 text-[11.5px] hover:bg-kf-palette-deep-green-hover hover:text-kf-text-on-brand ${ring} ${
            collapsed ? "justify-center px-0" : "px-2.5"
          }`}
          style={{ color: "var(--kf-palette-on-green-faint)" }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0"
            aria-hidden
          >
            {collapsed ? <path d="M10 7l5 5-5 5" /> : <path d="M14 7l-5 5 5 5" />}
            <path d={collapsed ? "M4.5 4v16" : "M19.5 4v16"} />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      )}
    </div>
  );
}
