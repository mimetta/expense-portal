import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// Same "table not in schema cache" code used by /api/announcements and
// /api/calendar-events — what PostgREST returns before
// supabase/migrations/012_new_features.sql has been applied.
const TABLE_NOT_FOUND = "PGRST205";

// Feeds /submit's "Use for company" dropdown (always visible, every expense
// type) — any signed-in user can read it, same convention as
// suppliers/products/categories (harmless reference data, unlike
// dept_config which stays restricted). Only SV and ONEST rows ever exist
// (see PATCH /api/companies/[id] — no POST/DELETE, fixed set by design).
export async function GET() {
  try {
    await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin.from("companies").select("*").order("bu", { ascending: true });
    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json({ companies: [] });
      }
      throw error;
    }
    return NextResponse.json({ companies: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}
