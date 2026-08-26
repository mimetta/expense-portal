# Mimetta Design System — Color Palette

Tailwind tokens (`tailwind.config.ts` → `theme.extend.colors.brand`):

| Token | Hex | Role |
|---|---|---|
| `brand.brown` | `#1F3A2B` | Primary actions — primary buttons, active nav underline, active tab underline, small circular status indicators. Never used as a background on cards, page sections, or the nav bar. |
| `brand.accent` | `#BD5A2E` | Hover state for primary buttons (swap, not dim), pinned badges, "Clear all" link. |
| `brand.cream` | `#FAF8F4` | Page/body background **only** — never a card, input, or table background. |
| `brand.border` | `#D8CBB0` | The one border color everywhere — cards, inputs, tables, dividers, nav bottom border. |
| `brand.sage` | `#9CAE8C` | Success/positive indicators, e.g. a "Paid"/"Approved" badge. |
| `brand.dark` | `#1A1A1A` | Body text, headings. |
| `brand.muted` | `#6B7280` | Secondary text, inactive nav/tab labels. |
| `brand.subtle` | `#9CA3AF` | Placeholder text, uppercase section labels/counts. |

## Non-token, context-specific hexes

- White (`#FFFFFF`) — the only card / input / nav / modal background.
- `#F9F8F6` — table header row background, table/panel-specific light-neutral shade (not a general brand color).
- `#DC2626` — destructive actions (delete, sign-out hover text-only, notification unread dot uses accent instead).
- `#DBEAFE` bg / `#3B82F6` border — one-off informational banner color (not part of the general rulebook).
- `#FEF3C7` bg / `#F59E0B` border / `#92400E` text — warning/attention banner (e.g. "account not yet assigned").
- `#D1FAE5` bg / `#065F46` text — "signed" success badge.
- `#FEF2F2` — softened danger-button hover background.

## Color usage rules

1. Cream (`brand.cream`) is page background only — never a card, input, or table surface.
2. White is the only card/input/nav/modal background.
3. Green (`brand.brown`) is never a background on a card, page section, or nav bar — only buttons, active-state underlines, and small status dots.
4. Sand (`brand.border`) is the single border color used everywhere — no other border colors except deliberate one-off banners (warning/info) listed above.
5. Hover states generally swap to a distinct color (e.g. green → terracotta) rather than just dimming opacity.

## Typography

Font: **DM Sans** (weights 400/500/600/700) + Noto Sans Thai fallback, loaded via `next/font/google` (self-hosted at build, no runtime Google Fonts request).

## Layout basics

- Nav height: 56px (`h-14`)
- Page content max width: 1280px, centered
- Card border radius: 10px
- Input height: 36px
- Card padding: 24px/20px (`px-6 py-5`)
