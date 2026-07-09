import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-dm-sans)", "var(--font-noto-thai)", "sans-serif"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Mimetta brand palette (see CLAUDE.md "Brand"). Token keys kept as
        // the original brown/cream/border/dark names even though the
        // values no longer literally match (e.g. `brown` is now forest
        // green) — renaming the keys would mean touching every
        // bg-brand-brown/text-brand-brown/border-brand-border usage
        // app-wide for no functional benefit; only the values needed to
        // change for the rebrand.
        brand: {
          brown: "#1F3A2B", // forest green — primary actions, active nav, buttons
          cream: "#FAF8F4", // warm off-white — page backgrounds ONLY (never cards/inputs)
          border: "#D8CBB0", // sandstone beige — borders, cards, dividers
          dark: "#1A1A1A", // near-black — body text
          accent: "#BD5A2E", // burnt terracotta — hover states, badges, highlights
          sage: "#9CAE8C", // muted sage — success/approved/positive indicators
          muted: "#6B7280", // secondary text, inactive nav/tabs, labels
          subtle: "#9CA3AF", // placeholder text, uppercase section labels, counts
        },
      },
    },
  },
  plugins: [],
};
export default config;
