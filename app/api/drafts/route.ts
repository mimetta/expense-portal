import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

const TABLE_NOT_FOUND = "PGRST205";

// Only the signed-in user's own drafts — no admin/cross-user visibility, a
// draft is scratch state for one person's in-progress submission.
export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("drafts")
      .select("*")
      .eq("owner_email", user.email)
      .order("updated_at", { ascending: false });

    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json({ drafts: [] });
      }
      throw error;
    }
    return NextResponse.json({ drafts: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface SaveDraftBody {
  id?: number;
  title?: string | null;
  form_data?: Record<string, unknown>;
}

// Create/update: a body with an `id` updates that draft (only if it's
// owned by the caller); without one, inserts a new draft. This is what
// /submit's autosave and "Save draft" button both call — the client keeps
// track of the draft id it's editing (if any) once the first save returns
// one, so repeated saves become updates rather than a pile of new rows.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as SaveDraftBody;

    const admin = createAdminClient();

    if (body.id) {
      const { data, error } = await admin
        .from("drafts")
        .update({
          title: body.title ?? null,
          form_data: body.form_data ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.id)
        .eq("owner_email", user.email)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ draft: data });
    }

    const { data, error } = await admin
      .from("drafts")
      .insert({
        owner_email: user.email,
        title: body.title ?? null,
        form_data: body.form_data ?? {},
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ draft: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
