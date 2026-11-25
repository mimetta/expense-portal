"use client";

import { useEffect, useRef, useState } from "react";
import { MODULES, TODO_URL, isExternalModule } from "@/lib/modules";

/**
 * The kindfolks lockup at the top of the sidebar, which is also the module
 * switcher (docs/sidebar-nav-mockup.html, tab 3).
 *
 * The list comes from lib/modules.ts and nowhere else, so swapping in the
 * shared Kindfolks module list later touches that one file.
 *
 * External modules open in the SAME TAB — switching module is navigation,
 * not opening a reference, so a new tab would leave a trail of stale ones.
 *
 * Keyboard: Enter/Space opens (native, it is a <button>), Escape closes,
 * Up/Down move between entries, and focus returns to the lockup on close.
 */
export default function ModuleSwitcher({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | HTMLSpanElement | null)[]>([]);

  // Focus the first entry when the menu opens.
  useEffect(() => {
    if (open) itemRefs.current.find(Boolean)?.focus();
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // the drawer also listens for Escape
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = itemRefs.current.filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next].focus();
  };

  const ring =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kf-palette-lime)]";

  return (
    <div
      ref={rootRef}
      className="relative border-b px-3 pb-3 pt-3.5"
      style={{ borderColor: "color-mix(in srgb, var(--kf-text-on-brand) 13%, transparent)" }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) close(true);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Kindfolks Expenses — switch module"
        className={`flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-kf-text-on-brand hover:bg-kf-palette-deep-green-hover ${ring} ${
          collapsed ? "justify-center" : ""
        }`}
        style={open ? { background: "var(--kf-palette-deep-green-hover)" } : undefined}
      >
        {/* The ripple mark. Lime on deep green is the one place the kit
            allows lime (BRAND.md rule 2). */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--kf-palette-lime)"
          strokeWidth="1.6"
          className="shrink-0"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="7.2" opacity=".62" />
          <circle cx="12" cy="12" r="10.8" opacity=".3" />
        </svg>
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-col leading-[1.15]">
              <span
                className="text-[10px] font-medium lowercase tracking-[0.14em]"
                style={{ color: "var(--kf-palette-on-green-faint)" }}
              >
                kindfolks
              </span>
              <span className="whitespace-nowrap text-[13.5px] font-semibold">Expenses</span>
            </span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              className="ml-auto shrink-0"
              style={{
                color: "var(--kf-palette-on-green-muted)",
                transform: open ? "rotate(180deg)" : undefined,
              }}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch module"
          onKeyDown={onMenuKeyDown}
          // Collapsed, the rail is 56px, so a menu clamped to it is ~32px
          // wide and unreadable. It flies out to the right of the rail at a
          // fixed width instead; expanded, it sits under the lockup as the
          // mockup draws it.
          className={`absolute z-30 rounded-[10px] border border-kf-border bg-kf-bg-surface p-1.5 shadow-lg ${
            collapsed
              ? "left-[calc(100%-4px)] top-2 w-56"
              : "left-3 right-3 top-[calc(100%-4px)]"
          }`}
        >
          <p className="px-2 pb-1 pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.11em] text-kf-text-hint">
            Switch module
          </p>
          {MODULES.map((m, i) => {
            const pending = m.href === TODO_URL;
            const dot = (
              <span
                aria-hidden
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{
                  background: m.current
                    ? "var(--kf-palette-deep-green)"
                    : "var(--kf-palette-warm-4)",
                }}
              />
            );
            const label = (
              <>
                {dot}
                <span className="truncate">{m.name}</span>
                {isExternalModule(m) && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="ml-auto shrink-0 text-kf-text-hint"
                    aria-hidden
                  >
                    <path d="M14 4h6v6M20 4l-8.5 8.5" />
                    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                  </svg>
                )}
              </>
            );

            // An address nobody has filled in yet is shown, and plainly
            // disabled. Rendering it as a link would send someone to a 404
            // and inventing a URL would be worse.
            if (pending) {
              return (
                <span
                  key={m.name}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  role="menuitem"
                  aria-disabled="true"
                  tabIndex={-1}
                  title="Address not configured yet — see lib/modules.ts"
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-2 text-[12.5px] font-medium text-kf-text-hint"
                >
                  {label}
                  <span className="ml-auto text-[9.5px] uppercase tracking-[0.08em]">
                    not set up
                  </span>
                </span>
              );
            }

            return (
              <a
                key={m.name}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="menuitem"
                href={m.href}
                aria-current={m.current ? "true" : undefined}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-[12.5px] font-medium no-underline hover:bg-kf-bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--kf-border-focus)] ${
                  m.current
                    ? "bg-kf-bg-selected text-kf-text-brand"
                    : "text-kf-text-primary"
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
