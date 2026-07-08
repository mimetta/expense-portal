import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// Distinct department values currently configured in the categories table —
// lets /submit's Department picker reflect whatever Settings > Category
// L1/L2 Management has configured, with no code change needed when a
// department's categories are added/removed. The Supabase JS client has no
// native SELECT DISTINCT, so this fetches the department column and dedupes
// in application code (cheap at this table's size); a raw SQL "select
// distinct department from categories order by department" would be the
// equivalent query if this ever needs to move to a DB view/RPC. Excludes
// the '*' wildcard sentinel (see lib/permissions.ts scope-matching
// convention) since it isn't a real department name.
export async function GET() {
  try {
    await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin.from("categories").select("department");
    if (error) throw error;

    const departments = Array.from(
      new Set((data ?? []).map((r) => r.department).filter((d): d is string => !!d && d !== "*")),
    ).sort();

    return NextResponse.json({ departments });
  } catch (err) {
    return handleApiError(err);
  }
}
