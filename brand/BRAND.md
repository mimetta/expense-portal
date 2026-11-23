# The Kindfolks look

Kit 1.0.1 · 20 Nov 2026. The values are onest's palette as Port approved it on 19 Nov 2026 (brand CI
step 2), the record both Kindfolks and the Dashboard were built from. Every Mimetta app takes its look
from this kit.

## The rules

1. **Every colour comes from a token.** No hex, `rgb()` or named colour (`white`, `text-red-600`,
   `bg-black/40`) in components. Use the Tailwind class (`bg-kf-bg-surface`) or `var(--kf-…)`. Where
   CSS can't read a variable (a canvas chart, an SVG attribute), read the value from
   `tokens/tokens.json` by name in one helper file, never retype the hex.
2. **Lime `#CDF765` only ever sits on deep green `#2C4A44`.**
3. **A mark is not text.** Dots, bars, edges and fills use the status colour; text uses the `-strong`
   shade (`text-kf-status-late-strong`, never `text-kf-status-late`). Every text colour reaches
   **4.5:1** on its background; faint notes (separators, history notes) **3:1**.
4. **Pills use solid tints; washes and overlays keep their alpha.** A pill's fill is an opaque tint
   (`olive-tint`, `brown-tint`, `terracotta-tint`, `sage-light`). A scrim, shadow, hover well or row
   wash is a token at an alpha (`bg-kf-palette-ink/20`). Never put an alpha on a hairline or a pill tint.
5. **Terracotta only for late, overdue, errors and delete.** Never as decoration.
6. **Fonts:** Montserrat 300–600 for the interface, IBM Plex Sans Thai 400–600 for Thai and the ฿ sign,
   Tinos Italic only for page titles and greetings. Fonts are local files, never fetched from Google
   at build time.
7. **The app is called "Kindfolks · \<Module\>"** in the browser tab; on screen, top left, the lockup
   reads "kindfolks / \<Module\>". It uses the kindfolks wordmark and the ripple icon.
   Only Kindfolks itself installs as an app (Port, 20 Nov): a module adds no web manifest of its own,
   and people reach it from the Kindfolks menu.

## Colour

### Roles first, palette second, hex never

Components use **role names**: they say what a colour is for (`bg-page`, `text-muted`,
`status-late-strong`). Use a **palette name** (`--kf-palette-<name>`) only where no role fits.
Never write a hex. Several roles share a value on purpose (`bg-brand`, `bg-active`, `text-brand` are
all deep green): they are different jobs that look alike today. Never merge two roles because their
values match.

If your app needs a role the kit doesn't have, add it to the app's own token file with a palette
value, and propose it for the kit if another app would use it.

### The palette: 32 colours

| Source | Name | Hex | For |
|---|---|---|---|
| onest | `deep-green` | `#2C4A44` | Brand chrome, active and primary fills, brand text |
| onest | `cream` | `#FEFFE9` | Page background; text on deep green |
| onest | `lime` | `#CDF765` | Only on deep green |
| onest | `sage` | `#C7DBD4` | onest brand pill fill; a light comparison series |
| onest | `olive` | `#C1CC7C` | Quiet olive edges; never text |
| onest | `beige` | `#DFD5BC` | Outlines |
| onest | `brown` | `#9F8361` | At-risk and warning marks; never text |
| onest | `ink` | `#1E1E1E` | Primary text; scrims, shadows, gridlines at alpha |
| functional | `white` | `#FFFFFF` | Surfaces; text on solid coloured fills |
| functional | `terracotta` | `#B4533A` | Late, overdue, errors, delete: marks and fills |
| functional | `brown-text` | `#776146` | Labels; at-risk and warning text |
| functional | `olive-strong` | `#6E7A35` | On-track and success marks and fills |
| shade | `deep-green-hover` | `#3D5A54` | Hover on a deep-green fill |
| shade | `sage-light` | `#E0EBE7` | Selected rows; deep-green pill fills |
| shade | `olive-tint` | `#E9EDD1` | On-track and success pill fill |
| shade | `olive-text` | `#5E6830` | On-track and positive text |
| shade | `brown-tint` | `#F0EBE6` | At-risk and warning pill fill |
| shade | `terracotta-text` | `#964834` | Terracotta read as text |
| shade | `terracotta-deep` | `#7E3C2B` | Hover on a destructive button |
| shade | `terracotta-tint` | `#F7ECE9` | Late and error pill fill |
| shade | `warm-1` | `#FAF8F3` | Hover on surfaces |
| shade | `warm-2` | `#F5F2EB` | Muted fills, tracks, inner sections |
| shade | `warm-3` | `#EDE8DA` | The lightest hairline |
| shade | `warm-4` | `#D3C7B0` | The heavier hairline |
| shade | `warm-5` | `#C5B5A0` | Faint outlines; settled dots |
| shade | `warm-6` | `#9A9282` | Faintest notes (3:1) |
| shade | `warm-7` | `#8E887A` | Neutral marks, muted outlines |
| shade | `warm-8` | `#7A7465` | Hints, placeholders |
| shade | `warm-9` | `#6B6659` | Secondary text; a target line |
| shade | `warm-10` | `#5C574C` | Text on neutral pills |
| shade | `on-green-muted` | `#BFC9B8` | Secondary text on deep green |
| shade | `on-green-faint` | `#A6B8AD` | Faint text on deep green |

"onest" are the brand's own eight; "functional" are four added in Figma for states the brand
colours can't carry; "shades" are derived from those twelve.

### The 24 shared roles

| Role | Value | For |
|---|---|---|
| `bg-page` | cream | Page background |
| `bg-surface` | white | Cards, panels, modals, inputs |
| `bg-muted` | warm-2 | Inner sections, tracks, neutral fills; hover wells at alpha |
| `bg-brand` | deep-green | Sidebar, app chrome, avatar; the browser theme colour |
| `bg-selected` | sage-light | A selected row or segment |
| `bg-active` | deep-green | The active control: chosen view, filter, toggle segment |
| `text-primary` | ink | Primary text |
| `text-muted` | warm-9 | Secondary text, metadata |
| `text-hint` | warm-8 | Hints, placeholders, empty values |
| `text-accent` | brown-text | Small uppercase labels and captions |
| `text-brand` | deep-green | Brand text: the wordmark, emphasis that grades nothing, action links |
| `text-on-brand` | cream | Text on `bg-brand` |
| `text-on-active` | cream | Text on `bg-active` |
| `text-positive` | olive-text | Done, approved, a change in the good direction |
| `border` | beige | Card edges, controls, pills, chart rules |
| `border-strong` | warm-4 | The heavier hairline |
| `border-subtle` | warm-3 | Dividers inside cards and forms; lines between rows |
| `border-focus` | deep-green | Focused input outline and focus ring |
| `status-on-track` / `-strong` | olive-strong / olive-text | On track: mark / text |
| `status-at-risk` / `-strong` | brown / brown-text | At risk: mark / text |
| `status-late` / `-strong` | terracotta / terracotta-text | Late: mark / text |

Each app has more roles of its own (Kindfolks 159, the Dashboard 22). They stay in the apps.

### Lines

Three steps, all solid: **`border-subtle`** (warm-3) for dividers inside cards and forms and lines
between rows; **`border`** (beige) for card edges and chart rules; **`border-strong`** (warm-4) for the
heavier hairline. (The two apps both have a `border-divider` name, pointing at different steps; it is
not in the kit. Pick the step by what the line does.)

### Terracotta as text

Terracotta read as text uses **`terracotta-text` `#964834`** (`status-late-strong`). `#B4533A` itself
carries text only on white or cream (4.95:1 and 4.88:1); on muted fills and on its own tint it falls
under 4.5 (4.43 and 4.28), so never there.

### Charts

Chart colours stay in each app for now (no chart name is shared). Two shared rules: a **target line
is warm-9 `#6B6659`, drawn dashed**; gridlines are ink at a low alpha (0.04–0.10).

### Contrast (WCAG 2)

| Text | on white | on cream | on warm-2 |
|---|---|---|---|
| ink | 16.67 | 16.43 | 14.91 |
| deep-green | 9.68 | 9.54 | 8.66 |
| warm-10 | 7.19 | 7.08 | 6.43 |
| terracotta-text | 6.42 | 6.32 | 5.74 |
| olive-text | 6.00 | 5.91 | 5.37 |
| brown-text | 5.86 | 5.78 | 5.24 |
| warm-9 (`text-muted`) | 5.72 | 5.64 | 5.12 |
| terracotta | 4.95 | 4.88 | **4.43** ✗ |
| warm-8 (`text-hint`) | 4.65 | 4.59 | **4.16** ✗ |
| warm-6 (faint notes, 3:1) | 3.08 | 3.04 | **2.76** ✗ |

Pills: olive-text on olive-tint 5.00 · brown-text on brown-tint 4.95 · terracotta-text on
terracotta-tint 5.54 · deep-green on sage-light 7.93. On deep green: cream 9.54 · lime 7.87 ·
on-green-muted 5.65 · on-green-faint 4.65. White on terracotta 4.95.

## Type

| Face | Weights | For |
|---|---|---|
| Montserrat (latin) | 300, 400, 500, 600 | All interface text (`font-sans`, the default) |
| IBM Plex Sans Thai (thai) | 400, 500, 600 | Thai and the ฿ sign; second in `font-sans`, so it fills in by itself |
| Tinos Italic | 400 italic | Page titles and greetings only (`font-title italic`) |

No 700: a bold request renders as 600. The files are in `fonts/` (@fontsource 5.3.0, OFL), loaded with
`next/font/local` (`fonts/fonts.ts.example`).

The scale the two apps set down today (where it comes from in brackets):

| Use | Size | Set |
|---|---|---|
| Page title | 24 px desktop, 18 px phone, line-height 30 px | Tinos Italic 400, `text-primary` (Kindfolks page `<h1>`) |
| Headline number (KPI) | 22 px, letter-spacing −0.01em, `tabular-nums` | Montserrat (Dashboard `text-kpi`) |
| Primary value | 15 px | Montserrat 500 (Kindfolks) |
| Card title | 12.5–13 px | Montserrat (Kindfolks) |
| Label, column header | 11 px (9.5 px at the smallest), uppercase, wide tracking (0.12em in the Dashboard) | Montserrat, `text-accent` (Dashboard `kc-label`, Kindfolks labels) |

Keep `tabular-nums` wherever numbers line up in a column.

## Do and don't

| Do | Don't |
|---|---|
| `text-kf-status-late-strong` for "3 days late" | `text-kf-status-late` (a mark colour) on text |
| `bg-kf-palette-terracotta-tint` pill with `terracotta-text` | `#B4533A` text on the tint (4.28:1) |
| Lime only on deep green | Lime as a highlight on cream or white |
| `bg-kf-palette-ink/20` for a scrim | A new "scrim-20" token or `rgba(0,0,0,.2)` |
| `border-kf-border-subtle` between rows | `border-black/5` |
| Terracotta for overdue, error, delete | Terracotta as an accent, a chart series, a heading |
| Tinos Italic for the page `<h1>` | Tinos in buttons, tables or body text |
| Local font files via `next/font/local` | `next/font/google` or a Google Fonts `<link>` |
| "Kindfolks · Expenses" as the tab title | "Expense Portal", a separate logo, a web manifest |
