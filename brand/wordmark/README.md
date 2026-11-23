# The kindfolks wordmark

| File | Use on | Colours |
|---|---|---|
| `kindfolks-on-light.svg` | cream, white and other light grounds | "kind" and "folks" both deep green `#2C4A44` |
| `kindfolks-on-dark.svg` | deep green `#2C4A44` only (the sidebar, dark headers) | "kind" cream `#FEFFE9`, "folks" lime `#CDF765` |

The wordmark is one lowercase word: "kind" in Montserrat Light, "folks" in Tinos Italic at 1.12×
the size of "kind" (Tinos's lowercase is shorter, so equal sizes make "folks" look small). That is
how Kindfolks (`src/components/Brand.js`) and the Dashboard (`components/ModuleSwitcher.tsx`) set it.
Here the letters are outlined into paths from the kit's own font files, so the SVG needs no font and
looks the same everywhere. The colours inside the SVGs are the logo's identity, not theme tokens:
a theme change never repaints the logo.

The dark version puts lime on deep green, and only there (rule 2). Never put `kindfolks-on-dark.svg`
on any other dark colour, and never recolour either file.

The viewBox is the ink of the letters plus 2 units, with the baseline at y = 0. At a 100-unit
"kind", the file is about 421 × 107 units. Set it by height.

## Setting "kindfolks / \<Module\>"

Two forms, on purpose:
- **Browser tab title** (and metadata): "Kindfolks · \<Module\>".
- **On screen**, top left: the lockup "kindfolks / \<Module\>", as the Dashboard ships it (approved
  live 19 Nov 2026). The wordmark is followed by a slash and the module name in live text:

```
kindfolks / Expenses ⌄
```

- Wordmark: `kindfolks-on-light.svg` at **23 px tall** on desktop, **20 px** on a phone header (the same size as the Dashboard's 22 px and 19 px live-text wordmark; the SVG is 1.07 em tall because the italic f descends).
- Separator `/`: `text-kf-text-hint`, 4 px of space either side (2 px on a phone).
- Module name: Montserrat 400, **14 px** (13 px on a phone), `text-kf-text-muted`, centred on the wordmark.
- The whole lockup is the trigger of the module menu (Projects · OKRs & KPIs · Dashboard · Expenses); the snippet below shows the lockup alone.

```tsx
// Copy the SVG to public/brand/kindfolks-on-light.svg (or import it with your bundler).
<a href="/" className="flex items-center gap-1" aria-label="Kindfolks Expenses">
  <img src="/brand/kindfolks-on-light.svg" alt="" className="h-[20px] sm:h-[23px] w-auto" />
  <span className="text-kf-text-hint mx-0.5 sm:mx-1" aria-hidden="true">/</span>
  <span className="text-[13px] sm:text-[14px] text-kf-text-muted">Expenses</span>
</a>
```

Next to the wordmark, the ripple icon (`icons/icon.svg`) may sit on its left at about 1.5× the
wordmark's height, as in Kindfolks' sidebar.
