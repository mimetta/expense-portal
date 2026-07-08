import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canAccessPage } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!canAccessPage(user, "dashboard")) throw new ForbiddenError();

    const { searchParams } = new URL(request.url);
    const bu = searchParams.get("bu");
    const year = searchParams.get("year") ?? String(new Date().getFullYear());

    const admin = createAdminClient();
    let query = admin.from("revenue").select("*").eq("year", Number(year));
    if (bu) query = query.eq("bu", bu);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ revenue: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}
