import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";

const TABLE_NOT_FOUND = "PGRST205";

// GET stays open to every signed-in user by default (active-only) — feeds
// /submit's "Petty cash holder" dropdown for any EMPLOYEE submitting a
// Petty Cash request, same convention as suppliers/products/categories
// staying open despite their mutations being role-restricted below.
// ?all=1 (SUPERADMIN/ACCOUNTING only) also returns inactive rows, for the
// Settings > Petty Cash Custodians management table — same pattern
// /api/announcements uses for its own management-table superset.
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const all = searchParams.get("all") === "1";
    if (all && !hasAnyRole(user, ["SUPERADMIN", "ACCOUNTING"])) throw new ForbiddenError();

    const admin = createAdminClient();
    let query = admin.from("petty_cash_custodians").select("*").order("name", { ascending: true });
    if (!all) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json({ custodians: [] });
      }
      throw error;
    }
    return NextResponse.json({ custodians: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreateCustodianBody {
  name?: string;
  email?: string;
  company?: string;
  segment?: string;
  amount_limit?: number;
  is_active?: boolean;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, ["SUPERADMIN", "ACCOUNTING"])) throw new ForbiddenError();

    const body = (await request.json()) as CreateCustodianBody;
    if (!body.name?.trim() || !body.email?.trim() || !body.company?.trim() || !body.segment?.trim()) {
      return NextResponse.json(
        { error: "name, email, company, and segment are required" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("petty_cash_custodians")
      .insert({
        name: body.name,
        email: body.email,
        company: body.company,
        segment: body.segment,
        amount_limit: body.amount_limit ?? 0,
        is_active: body.is_active ?? true,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ custodian: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
