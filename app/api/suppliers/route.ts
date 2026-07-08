import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

// Reference data for the /submit form's Supplier/Payee picker. Any signed-in
// @mimetta.co user can read it (same precedent as /api/categories) — GET
// stays open even though Settings > Supplier Management (the mutation path)
// is now also scoped to ACCOUNTING/PROCUREMENT alongside SUPERADMIN, since
// restricting GET would break the Supplier/Payee picker for every ordinary
// EMPLOYEE submitting a request.
export async function GET() {
  try {
    await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin.from("suppliers").select("*").order("name");
    if (error) throw error;
    return NextResponse.json({ suppliers: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreateSupplierBody {
  name: string;
  payment_method?: string;
  bank_name?: string;
  account_no?: string;
  notes?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "ACCOUNTING", "PROCUREMENT"])) throw new ForbiddenError();

    const body = (await request.json()) as CreateSupplierBody;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("suppliers")
      .insert({
        name: body.name,
        payment_method: body.payment_method ?? null,
        bank_name: body.bank_name ?? null,
        account_no: body.account_no ?? null,
        notes: body.notes ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ supplier: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
