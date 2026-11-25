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
 * ===========================================================================
 * THE URLs ARE PLACEHOLDERS AND MUST BE FILLED IN BEFORE THIS SHIPS.
 * ===========================================================================
 * Nothing here was guessed. Every `href` below is the literal string
 * `TODO_URL`, which `moduleHrefsPending()` detects — the switcher renders
 * those entries as visibly unavailable rather than as links to nowhere.
 * Replace each `TODO_URL` with the real address, copied from Kindfolks'
 * `src/lib/apps.js` or the Dashboard's `lib/otherApps.ts`.
 *
 * brand/CHECKLIST.md: each entry is `<app url>/?via=switcher`, except this
 * app's own, which links to its own home with no `via`.
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

  // TODO: replace with `<Projects url>/?via=switcher`
  { name: "Projects", href: TODO_URL, current: false },
  // TODO: replace with `<Kindfolks url>/okrs?via=switcher`
  { name: "OKRs & KPIs", href: TODO_URL, current: false },
  // TODO: replace with `<Dashboard url>/?via=switcher`
  { name: "Dashboard", href: TODO_URL, current: false },
];

/** True while any module still carries a placeholder address. */
export const moduleHrefsPending = (): boolean =>
  MODULES.some((m) => m.href === TODO_URL);

/** True for a module that lives outside this app. */
export const isExternalModule = (m: KindfolksModule): boolean =>
  m.href !== TODO_URL && /^https?:\/\//.test(m.href);
