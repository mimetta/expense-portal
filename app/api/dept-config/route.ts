import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";

// dept_config drives skip_bo/skip_ceo/CEO-signature rules, so exposing it
// more broadly would leak approval thresholds to staff. GET is restricted
// too (not just mutations) for the same reason — unlike
// suppliers/products/categories, nothing outside Settings needs to read
// this table, so there's no submit-form picker to keep open for everyone
// the way there is for those. Routed through the same
// requireSettingsTabRole check as the mutations below (not just the
// literal mutation routes) — this GET is how the CEO Signature Rules tab
// actually loads its data, so "can see this tab" (settings_tab_permissions)
// and "can call this GET" need to stay the same rule, or a role newly
// granted the tab via Settings > Permissions would see it in the nav but
// get a 403 the moment they open it.
export async function GET() {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "deptconfig");

    const admin = createAdminClient();
    const { data, error } = await admin.from("dept_config").select("*");
    if (error) throw error;
    return NextResponse.json({ dept_config: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface DeptConfigInput {
  dept?: string;
  bu?: string;
  cat_l1?: string;
  bo_email?: string;
  exceed_amount?: number;
  ceo_signature_required?: boolean;
  skip_bo?: boolean;
  skip_ceo?: boolean;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "deptconfig");

    const body = (await request.json()) as DeptConfigInput;
    if (!body.dept?.trim()) {
      return NextResponse.json({ error: "dept is required (or '*' for the fallback row)" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("dept_config")
      .insert({
        dept: body.dept,
        bu: body.bu || "*",
        cat_l1: body.cat_l1 || "*",
        bo_email: body.bo_email || null,
        exceed_amount: body.exceed_amount ?? 0,
        ceo_signature_required: body.ceo_signature_required ?? false,
        skip_bo: body.skip_bo ?? false,
        skip_ceo: body.skip_ceo ?? false,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ dept_config: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
