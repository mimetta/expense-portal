import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { getRequestOrThrow } from "@/lib/request-repo";
import { resubmitRequest, type EditableRequestBody } from "@/lib/resubmit";

// Thin wrapper — the same logic is also reachable via
// PATCH /api/requests/[id] with { resubmit: true } in the body (see that
// route). Both exist: this one for backward compatibility with existing
// callers, the unified route for new UI (RequestDetailModal / edit forms)
// that also needs plain in-place edits on the same endpoint.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);
    const body = (await request.json()) as EditableRequestBody;

    const updated = await resubmitRequest(admin, existing, user, body);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
