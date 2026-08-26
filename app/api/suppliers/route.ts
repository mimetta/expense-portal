import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";

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
  email?: string;
  notes?: string;
}

// supabase/migrations/015_supplier_email.sql hasn't necessarily been
// applied yet (see that file's header comment). Unlike roles.chapter,
// this isn't on a required-on-every-load auth path, so a lightweight
// single retry-without-email is enough — no need for lib/auth.ts's
// heavier 3-tier fallback.
//
// PGRST204, not 42703: verified directly against the live (currently
// un-migrated) suppliers table before assuming this — Postgrest returns
// 42703 ("column does not exist") for a query that *references* a
// missing column (e.g. select=email), but an insert/update body naming a
// column absent from its schema cache returns PGRST204 ("Could not find
// the 'X' column ... in the schema cache") instead. This route does an
// insert, so it needs PGRST204, not the 42703 other routes in this
// codebase check for their own SELECT-based fallbacks (e.g.
// petty-cash-usage/route.ts).
const UNKNOWN_COLUMN_IN_BODY = "PGRST204";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "suppliers");

    const body = (await request.json()) as CreateSupplierBody;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    let { data, error } = await admin
      .from("suppliers")
      .insert({
        name: body.name,
        payment_method: body.payment_method ?? null,
        bank_name: body.bank_name ?? null,
        account_no: body.account_no ?? null,
        email: body.email ?? null,
        notes: body.notes ?? null,
      })
      .select()
      .single();

    if (error?.code === UNKNOWN_COLUMN_IN_BODY) {
      ({ data, error } = await admin
        .from("suppliers")
        .insert({
          name: body.name,
          payment_method: body.payment_method ?? null,
          bank_name: body.bank_name ?? null,
          account_no: body.account_no ?? null,
          notes: body.notes ?? null,
        })
        .select()
        .single());
    }

    if (error) throw error;
    return NextResponse.json({ supplier: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
