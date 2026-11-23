---
# Kindfolks kit 1.0.1 — copy to .claude/rules/kindfolks-ui.md and set these globs to YOUR app's UI files.
paths:
  - "app/**/*.{ts,tsx,js,jsx,css}"
  - "components/**/*.{ts,tsx,js,jsx,css}"
  - "src/**/*.{ts,tsx,js,jsx,css}"
  - "tailwind.config.*"
---

# Kindfolks look (kit 1.0.1)

This app is a Kindfolks module. Its look comes from the Kindfolks kit, copied in at `brand/` at the
version in `brand/KIT_VERSION`. **Never edit files under `brand/`**; a change to the look is a new kit
version, copied in. The full guide is `brand/BRAND.md`; the module checklist is `brand/CHECKLIST.md`.

## Colour
- **Every colour comes from a token.** No hex, `rgb()`, `hsl()` or named colour in components, and no
  Tailwind palette class (`text-white`, `bg-black/40`, `text-red-600`, `border-gray-200`).
  Use `kf-` classes (`bg-kf-bg-surface`, `text-kf-text-muted`) or `var(--kf-…)`.
- Pick a **role name** by what the colour is for (`bg-page`, `text-muted`, `border-subtle`,
  `status-late-strong`). A **palette name** (`kf-palette-warm-1`) only where no role fits. Never a hex.
  If the app needs a role the kit lacks, add it to the app's own token file with a palette value.
- Where CSS can't read a variable (canvas charts, SVG attributes), read the value from
  `brand/tokens/tokens.json` by name in one helper; never retype a hex.
- **Lime `#CDF765` only on deep green `#2C4A44`.**
- **A mark is not text.** Dots, bars, edges and fills use the status colour (`status-late`); text uses
  the `-strong` shade (`status-late-strong`). Brown, olive and terracotta-on-a-tint never carry text.
- Every text colour reaches **4.5:1** on its background (faint notes 3:1). `text-hint` and terracotta
  `#B4533A` reach it only on white or cream, not on `bg-muted`.
- **Pills use solid tints** (`kf-palette-olive-tint`, `-brown-tint`, `-terracotta-tint`, `bg-selected`).
  **Washes and overlays keep their alpha** (`bg-kf-palette-ink/20`); never an alpha on a hairline or a
  pill tint, and never a new token for an alpha.
- **Terracotta only for late, overdue, errors and delete.** Never decoration. Terracotta text is
  `terracotta-text` / `status-late-strong` `#964834`.
- Lines: `border-subtle` inside cards and forms and between rows; `border` for card edges and chart
  rules; `border-strong` for the heavier hairline. A chart target line is `kf-palette-warm-9`, dashed.

## Type
- Montserrat 300–600 for all interface text (`font-sans`, the default); IBM Plex Sans Thai 400–600
  fills in for Thai and ฿ by itself. No 700.
- Tinos Italic (`font-title italic`) only for page titles and greetings.
- Fonts load with `next/font/local` from `brand/fonts/`. **Never `next/font/google`**, never a Google
  Fonts `<link>` or `@import`.
- `tabular-nums` wherever numbers line up.

## Name, icon, menu
- The tab title and metadata say "Kindfolks · \<Module\>"; on screen, top left, the lockup is
  "kindfolks / \<Module\>" (wordmark, slash, module name; `brand/wordmark/README.md`), with the wordmark SVG from
  `brand/wordmark/` top left and the ripple icon from `brand/icons/` as favicon and apple-touch-icon.
  Icons load without a session.
- **No web manifest.** Only Kindfolks installs as an app.
- The module menu lists Projects · OKRs & KPIs · Dashboard · Expenses, each `<app url>/?via=switcher`.

Before finishing UI work, search the changed files for `#`, `rgb(`, `rgba(`, `hsl(`,
`fonts.googleapis`, `next/font/google` and Tailwind palette classes, and fix any you find.
