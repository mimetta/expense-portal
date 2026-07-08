import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import { getRequestOrThrow, updateRequest, ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/discord";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user) && !hasRole(user, "ACCOUNTING")) {
      throw new ForbiddenError();
    }

    const { id } = await params;
    const body = (await request.json()) as { paid?: boolean };
    const markPaid = body.paid ?? true;

    const admin = createAdminClient();
    const existing = await getRequestOrThrow(admin, id);

    if (markPaid) {
      if (existing.status !== "CEO_APPROVED") {
        throw new ConflictError(
          `Request ${id} is not awaiting payment (status: ${existing.status})`,
        );
      }
      const updated = await updateRequest(admin, id, {
        status: "PAID",
        accounting_user: user.email,
        paid_at: new Date().toISOString(),
      });
      await logAudit(user.email, id, "PAID", {});
      await notify("PAID", updated);
      return NextResponse.json({ request: updated });
    }

    if (existing.status !== "PAID") {
      throw new ConflictError(`Request ${id} is not marked paid`);
    }
    const updated = await updateRequest(admin, id, {
      status: "CEO_APPROVED",
      accounting_user: null,
      paid_at: null,
    });
    await logAudit(user.email, id, "PAID_REVERTED", {});
    return NextResponse.json({ request: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
