import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";

interface UpdateCompanyBody {
  name_en?: string;
  name_th?: string | null;
  address?: string;
}

// SUPERADMIN only, per Settings > Companies (see CLAUDE.md-style note: no
// POST/DELETE — SV and ONEST are the only two rows, seeded by the
// migration, and this tab only ever edits their name/address fields).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError();

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
