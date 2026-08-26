import { NextRequest, NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "CEO", "ACCOUNTING"])) throw new ForbiddenError();

    const body = (await req.json()) as { type: string; id: string; owner_name: string | null };
    const { type, id, owner_name } = body;
    if (!type || !id) return NextResponse.json({ error: "Missing type or id" }, { status: 400 });

    const admin = createAdminClient();
    const table =
      type === "department" ? "cashflow_departments" :
      type === "category"   ? "cashflow_categories"  :
      type === "line_item"  ? "cashflow_line_items"   : null;
    if (!table) return NextResponse.json({ error: "Invalid type" }, { status: 400 });

    const { error } = await admin.from(table).update({ owner_name }).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}
