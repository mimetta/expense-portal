import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

interface UpdateSupplierBody {
  name?: string;
  payment_method?: string | null;
  bank_name?: string | null;
  account_no?: string | null;
  email?: string | null;
  notes?: string | null;
}

// See app/api/suppliers/route.ts — same lightweight single-retry pattern
// for supabase/migrations/015_supplier_email.sql not necessarily being
// applied yet. PGRST204, not 42703 — verified directly against the live
// table; an update body naming an unknown column returns PGRST204, not
// the 42703 a SELECT referencing one would.
const UNKNOWN_COLUMN_IN_BODY = "PGRST204";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "ACCOUNTING", "PROCUREMENT"])) throw new ForbiddenError();

    const { id } = await params;
    const body = (await request.json()) as UpdateSupplierBody;

    const admin = createAdminClient();
    let { data, error } = await admin
      .from("suppliers")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error?.code === UNKNOWN_COLUMN_IN_BODY) {
      const withoutEmail = { ...body };
      delete withoutEmail.email;
      ({ data, error } = await admin
        .from("suppliers")
        .update(withoutEmail)
        .eq("id", id)
        .select()
        .single());
    }

    if (error) throw error;
    return NextResponse.json({ supplier: data });
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
    if (!hasAnyRole(user, ["SUPERADMIN", "ACCOUNTING", "PROCUREMENT"])) throw new ForbiddenError();

    const { id } = await params;
    const admin = createAdminClient();
    const { error } = await admin.from("suppliers").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
