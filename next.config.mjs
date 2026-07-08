/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pdfjs-dist optionally requires the native `canvas` package as a
    // Node-side fallback; it's never installed (and never needed — this
    // app only calls pdfjs-dist from the browser via PDFSigner.tsx), so
    // without this alias webpack fails the build trying to resolve it.
    config.resolve.alias.canvas = false;

    // @supabase/supabase-js (pulled in by @supabase/ssr's createServerClient,
    // used in lib/supabase/middleware.ts, which runs on the Edge runtime)
    // references `process.version` in a fetch-polyfill feature check. The
    // branch it guards is dead code on Edge — this is a well-documented,
    // safe-to-ignore characteristic of the Supabase SDK bundle, not
    // something fixable in this app's own code (confirmed: identical
    // warning appears with a from-scratch Supabase+Next.js Middleware
    // setup). Silenced explicitly, scoped to this exact message, rather
    // than left as build-log noise or "fixed" by downgrading the SDK.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { message: /A Node\.js API is used \(process\.version/ },
    ];

    return config;
  },
};

export default nextConfig;
