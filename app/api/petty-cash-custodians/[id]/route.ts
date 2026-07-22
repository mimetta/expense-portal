import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";

interface UpdateCustodianBody {
  name?: string;
  email?: string;
  company?: string;
  segment?: string;
  amount_limit?: number;
  is_active?: boolean;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "pettycash");

    const { id } = await params;
    const body = (await request.json()) as UpdateCustodianBody;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("petty_cash_custodians")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ custodian: data });
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
    await requireSettingsTabRole(user, "pettycash");

    const { id } = await params;
    const admin = createAdminClient();
    const { error } = await admin.from("petty_cash_custodians").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
