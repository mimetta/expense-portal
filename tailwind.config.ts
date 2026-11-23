import type { Config } from "tailwindcss";

// Colours and font families come from the Kindfolks kit preset
// (brand/tokens/tailwind-preset.cjs, pinned in brand/KIT_VERSION). It
// defines every `kf-*` colour as `var(--kf-*)` — the variables themselves
// live in brand/tokens/tokens.css, imported once at the top of
// app/globals.css — plus `font-sans` / `font-thai` / `font-title`.
//
// There is deliberately no `colors.brand` block any more. The old
// brown/cream/border/dark/accent/sage/muted/subtle keys held raw hex and
// were the app's own palette; every call site now uses a kit role name
// instead, so a second vocabulary pointing at the same colours would just
// be a way to bypass the kit. Never add a hex here — a colour the kit
// lacks goes in an app token file with a palette value (brand/BRAND.md).
const config: Config = {
  presets: [require("./brand/tokens/tailwind-preset.cjs")],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--kf-bg-page)",
        foreground: "var(--kf-text-primary)",
      },
    },
  },
  plugins: [],
};
export default config;
