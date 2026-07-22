import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";

interface UpdateCompanyBody {
  name_en?: string;
  name_th?: string | null;
  address?: string;
}

// SUPERADMIN-only by default (see supabase/migrations/016_settings_tab_permissions.sql's
// seed data), configurable via Settings > Permissions like the other 7
// managed tabs. No POST/DELETE — SV and ONEST are the only two rows,
// seeded by an earlier migration, and this tab only ever edits their
// name/address fields.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "companies");

    const { id } = await params;
    const body = (await request.json()) as UpdateCompanyBody;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("companies")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ company: data });
  } catch (err) {
    return handleApiError(err);
  }
}
