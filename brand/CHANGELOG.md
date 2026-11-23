# Changelog

## 1.0.1 — 20 Nov 2026

- The on-screen lockup is "kindfolks / \<Module\>", as the Dashboard ships it (approved live 19 Nov);
  the browser tab title stays "Kindfolks · \<Module\>". README, CHECKLIST, BRAND, the wordmark notes
  and the Claude rules file now say both. No token, font, icon or wordmark file changed.

## 1.0.0 — 20 Nov 2026

First version, built from Kindfolks `origin/main` 37a6bd8 and the Dashboard `origin/main` 918c219.

- **Tokens:** 56. The 32-colour palette of the 19 Nov 2026 step-2 record as `--kf-palette-<name>`
  (8 onest, 4 functional, 20 shades), and the 24 role names both apps carry with the same value.
  `border-divider` and `chart-target` (same name, different value in each app) and every app-only
  name stay in their apps.
- **Fonts:** Montserrat latin 300–600, IBM Plex Sans Thai 400–600, Tinos Italic (@fontsource 5.3.0,
  OFL), byte for byte what both apps ship; `fonts.ts.example` for `next/font/local`.
- **Icons:** Kindfolks' `public/icons` set; `favicon.ico` (16 + 32) made from its two favicon PNGs.
- **Wordmark:** "kindfolks" outlined to SVG from the kit's fonts, on light and on dark.
- **Rules:** `BRAND.md`, `CHECKLIST.md`, `claude/kindfolks-ui.md`.
- **Verify:** `scripts/verify-against-apps.mjs`.
