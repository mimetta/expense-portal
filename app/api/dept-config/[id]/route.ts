import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

interface DeptConfigUpdate {
  dept?: string;
  bu?: string;
  cat_l1?: string;
  bo_email?: string | null;
  exceed_amount?: number;
  ceo_signature_required?: boolean;
  skip_bo?: boolean;
  skip_ceo?: boolean;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "CEO"])) throw new ForbiddenError();

    const { id } = await params;
    const body = (await request.json()) as DeptConfigUpdate;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("dept_config")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ dept_config: data });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "CEO"])) throw new ForbiddenError();

    const { id } = await params;
    const admin = createAdminClient();
    const { error } = await admin.from("dept_config").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
