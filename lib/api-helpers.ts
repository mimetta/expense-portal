import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { ConflictError, NotFoundError } from "@/lib/request-repo";

// Postgrest errors (@supabase/postgrest-js) are Error subclasses that also
// carry `code`/`details`/`hint` — per that library's own doc comment, `hint`
// is usually the single most useful field (e.g. the literal GRANT statement
// to fix a permission error, or the column name you probably meant), and is
// silently lost if only `.message` is read. Every unhandled 500 across every
// route goes through this function, so surfacing those fields here fixes it
// everywhere at once instead of needing every route to know to do this.
function isPostgrestLikeError(err: unknown): err is { message: string; code?: string; details?: string; hint?: string } {
  return typeof err === "object" && err !== null && "message" in err;
}

// Next.js throws this internally (from `cookies()`/`headers()`) when it
// tries to statically prerender a route during `next build` and discovers
// mid-render that the route actually needs per-request data — it's not an
// application error, just Next's own signal to itself to bail out of static
// generation and mark the route dynamic (which it then does correctly
// regardless of what happens to this exception downstream). Every route in
// this app is auth-gated via cookies, so every one of them trips this
// during the build's prerender pass. Swallowing it here and returning a
// fake 500 — which is what happened before this check existed — doesn't
// break anything at runtime, but it does spam the build log with a
// misleading "Unhandled API error" stack trace for every single route, on
// every build. Rethrowing lets Next's own machinery handle it silently.
function isNextDynamicUsageError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    (err as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE"
  );
}

export function handleApiError(err: unknown) {
  if (isNextDynamicUsageError(err)) {
    throw err;
  }
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }

  // Log the full object, not just .message — for a PostgrestError, .message
  // alone can be a generic wrapper while the actionable info is in .hint.
  console.error("Unhandled API error:", err);

  if (isPostgrestLikeError(err)) {
    return NextResponse.json(
      {
        error: err.message || "Internal server error",
        code: err.code,
        details: err.details,
        hint: err.hint,
      },
      { status: 500 },
    );
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
