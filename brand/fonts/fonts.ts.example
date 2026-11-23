/**
 * Kindfolks kit 1.0.1 — the app's fonts with next/font/local. Copy this to `app/fonts.ts`.
 *
 * The paths assume the kit sits at `<repo>/brand/` and this file at `<repo>/app/fonts.ts`.
 * In a `src/app/` project, make them `../../brand/fonts/...`. next/font resolves them at build
 * time from the committed woff2 files: never next/font/google (its build-time download broke two
 * builds in Nov 2026), never a <link> to fonts.googleapis.com.
 *
 * The files are @fontsource 5.3.0 (latin / thai subsets), byte for byte what Kindfolks and the
 * Dashboard ship, with their OFL licences beside them.
 *
 * Use in app/layout.tsx:
 *   import { FONT_VARIABLE_CLASSES } from './fonts'
 *   <html lang="en" className={FONT_VARIABLE_CLASSES}>
 * The Tailwind preset's font-sans / font-thai / font-title read these variables.
 */
import localFont from 'next/font/local';

/** Montserrat 300–600: all interface text. No 700 on purpose; a 700 request renders as 600. */
export const montserrat = localFont({
  src: [
    { path: '../brand/fonts/montserrat-latin-300-normal.woff2', weight: '300', style: 'normal' },
    { path: '../brand/fonts/montserrat-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../brand/fonts/montserrat-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../brand/fonts/montserrat-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-montserrat',
  display: 'swap',
});

/**
 * IBM Plex Sans Thai 400–600: Thai and the ฿ sign, which Montserrat lacks. Second in the
 * font-sans stack, so the browser reaches it only for those glyphs; the unicode-range keeps it
 * from loading on a page with no Thai.
 */
export const plexThai = localFont({
  src: [
    { path: '../brand/fonts/ibm-plex-sans-thai-thai-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../brand/fonts/ibm-plex-sans-thai-thai-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../brand/fonts/ibm-plex-sans-thai-thai-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-thai',
  display: 'swap',
  declarations: [{ prop: 'unicode-range', value: 'U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC' }],
});

/** Tinos Italic: page titles and greetings only. The wordmark is an SVG and needs no font. */
export const tinos = localFont({
  src: [{ path: '../brand/fonts/tinos-latin-400-italic.woff2', weight: '400', style: 'italic' }],
  variable: '--font-tinos',
  display: 'swap',
});

/** Every font's CSS variable class, for <html className>. */
export const FONT_VARIABLE_CLASSES = [montserrat.variable, plexThai.variable, tinos.variable].join(' ');
