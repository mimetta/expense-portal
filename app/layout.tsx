import type { Metadata, Viewport } from "next";
import AppShell from "@/components/nav/AppShell";
import { FONT_VARIABLE_CLASSES } from "./fonts";
import tokensJson from "@/brand/tokens/tokens.json";
import "./globals.css";

// Fonts are the kit's committed woff2 files, loaded with next/font/local
// from app/fonts.ts — never next/font/google and never a Google Fonts
// <link>, so the build never fetches a font (brand/BRAND.md rule 6).

export const metadata: Metadata = {
  title: "Kindfolks · Expenses",
  description: "Kindfolks Expenses",
};

// Metadata can't read a CSS variable, so the browser theme colour is read
// from the kit's tokens.json by name rather than retyped as a hex.
export const viewport: Viewport = {
  themeColor: tokensJson.tokens.find((t) => t.name === "--kf-bg-brand")!.value,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={FONT_VARIABLE_CLASSES}>
      <body className="font-sans antialiased">
        {/* Sidebar, page header and the page itself. AppShell also renders
            <main>, so sign-in pages keep the exact wrapper they had when the
            old top Nav returned null. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
