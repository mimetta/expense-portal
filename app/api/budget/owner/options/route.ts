import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// Ported from onest-cashflow's /api/pl/owner/options. That app had its own
// `users` table; this project identifies people by email via `roles`
// instead, so "people" here is every distinct email with at least one role.
export async function GET() {
  try {
    await requireUser();
    const admin = createAdminClient();

    const [rolesRes, deptsRes] = await Promise.all([
      admin.from("roles").select("email").order("email"),
      admin.from("cashflow_departments").select("full_name").order("full_name"),
    ]);
    if (rolesRes.error) throw rolesRes.error;
    if (deptsRes.error) throw deptsRes.error;

    const people = Array.from(new Set((rolesRes.data ?? []).map((r) => r.email))).filter(Boolean);
    const depts = (deptsRes.data ?? []).map((d) => `— ${d.full_name} —`);

    return NextResponse.json({ people, depts });
  } catch (err) {
    return handleApiError(err);
  }
}
