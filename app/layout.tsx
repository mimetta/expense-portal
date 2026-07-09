import type { Metadata } from "next";
import { DM_Sans, Noto_Sans_Thai } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

// next/font self-hosts and optimizes the font at build time (no runtime
// Google Fonts request, no FOUC) — kept over a manual <link>/@import for
// that reason; DM Sans replaces Inter as the primary typeface, Noto Sans
// Thai stays as the fallback for Thai text.
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans",
});
const notoSansThai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-noto-thai" });

export const metadata: Metadata = {
  title: "Mimetta Expense Portal",
  description: "Internal expense request and approval portal for Mimetta",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${notoSansThai.variable} font-sans antialiased`}>
        <Nav />
        <main className="mx-auto max-w-[1200px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
