/**
 * The Kindfolks module list, for the switcher in the sidebar lockup.
 *
 * ===========================================================================
 * THIS FILE IS THE ONLY SOURCE. The switcher reads nothing else.
 * ===========================================================================
 * The shared list will eventually live outside this repo — Kindfolks keeps it
 * in `src/lib/apps.js` and the Dashboard in `lib/otherApps.ts`, and
 * brand/CHECKLIST.md says a module's menu copies the addresses from there.
 * Neither is available to this repo yet, so the list is local. When the
 * shared one exists, THIS FILE is the only thing that changes: no component
 * hardcodes a module name or address.
 *
 * Each entry is `<app url>/?via=switcher` per brand/CHECKLIST.md, except
 * this app's own, which links to its own home with no `via`.
 *
 * `TODO_URL`, `moduleHrefsPending()` and the disabled branch in
 * ModuleSwitcher are dormant now that every address is filled in. They are
 * kept for the next module added before its address exists: give it
 * `TODO_URL` and the switcher lists it as unavailable rather than linking
 * to nowhere.
 */

export interface KindfolksModule {
  /** Shown in the menu. */
  name: string;
  /** Absolute URL for another module; a path for this one. */
  href: string;
  /** True for the module the person is already in. */
  current: boolean;
}

/** The literal every unfilled address carries. */
export const TODO_URL = "TODO_URL";

export const MODULES: KindfolksModule[] = [
  // This app. Its own home, no `via` — per brand/CHECKLIST.md.
  { name: "Expenses", href: "/", current: true },

  { name: "Projects", href: "https://kc-tasks-delta.vercel.app/?via=switcher", current: false },
  { name: "OKRs & KPIs", href: "https://kc-tasks-delta.vercel.app/okrs?via=switcher", current: false },
  { name: "Dashboard", href: "https://kc-dashboard-lyart.vercel.app/?via=switcher", current: false },
];

/** True while any module still carries a placeholder address. */
export const moduleHrefsPending = (): boolean =>
  MODULES.some((m) => m.href === TODO_URL);

/** True for a module that lives outside this app. */
export const isExternalModule = (m: KindfolksModule): boolean =>
  m.href !== TODO_URL && /^https?:\/\//.test(m.href);
