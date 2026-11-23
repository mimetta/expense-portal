/**
 * Kindfolks kit 1.0.1 — Tailwind 3 preset.
 *
 *   // tailwind.config.js
 *   module.exports = { presets: [require('./brand/tokens/tailwind-preset.cjs')], content: [...] }
 *
 * Colours: every kit token as `kf-<name>` → `var(--kf-<name>)`, read from tokens.json, so
 * `bg-kf-bg-page`, `text-kf-text-muted`, `border-kf-border-subtle`, `bg-kf-palette-warm-1`.
 * A modifier (`bg-kf-bg-muted/40`, `bg-kf-bg-brand/[0.06]`) compiles to
 * `color-mix(in srgb, var(--kf-x) 40%, transparent)`: Tailwind 3 cannot put an alpha on a
 * variable holding a whole colour, so this is how washes and overlays keep their alpha.
 * The variables themselves come from tokens.css — import it once in globals.css.
 *
 * Fonts: three families, reading the CSS variables that fonts/fonts.ts sets with next/font/local.
 *   font-sans   Montserrat, then IBM Plex Sans Thai for Thai and ฿ (the default for all UI text)
 *   font-thai   IBM Plex Sans Thai alone
 *   font-title  Tinos Italic, page titles and greetings only (use with `italic`)
 */
const { tokens } = require('./tokens.json')

const round = (n) => Math.round(n * 10000) / 100

function color(cssVar) {
  return ({ opacityValue } = {}) =>
    opacityValue === undefined || /var\(--tw-/.test(String(opacityValue))
      ? `var(${cssVar})`
      : `color-mix(in srgb, var(${cssVar}) ${round(Number(opacityValue))}%, transparent)`
}

const colors = Object.fromEntries(tokens.map((t) => [t.name.slice(2), color(t.name)]))

module.exports = {
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: ['var(--font-montserrat)', 'var(--font-plex-thai)', 'system-ui', 'sans-serif'],
        thai: ['var(--font-plex-thai)', 'sans-serif'],
        title: ['var(--font-tinos)', 'Georgia', 'serif'],
      },
    },
  },
}
