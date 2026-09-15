import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";

// Personal, self-service saved payment details (supabase/migrations/
// 031_payment_presets.sql) — every signed-in user manages only their own
// rows, scoped by owner_email server-side (never trusted from the client).
// No role/Settings-tab gate at all: unlike the shared suppliers table
// (Settings > Supplier Management, SUPERADMIN/ACCOUNTING/PROCUREMENT-only),
// this is deliberately open to every requester so they don't need any
// special permission just to stop retyping their own payment details.
const TABLE_NOT_FOUND = "PGRST205";

export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("payment_presets")
      .select("*")
      .eq("owner_email", user.email)
      .order("created_at", { ascending: true });

    if (error) {
      if (error.code === TABLE_NOT_FOUND) return NextResponse.json({ presets: [] });
      throw error;
    }
    return NextResponse.json({ presets: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreatePresetBody {
  name?: string;
  supplier_name?: string;
  pay_method?: string;
  bank_name?: string;
  card_type?: string;
  account_no?: string;
  slip_receiver_email?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as CreatePresetBody;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("payment_presets")
      .insert({
        owner_email: user.email,
        name: body.name.trim(),
        supplier_name: body.supplier_name || null,
        pay_method: body.pay_method || null,
        bank_name: body.bank_name || null,
        card_type: body.card_type || null,
        account_no: body.account_no || null,
        slip_receiver_email: body.slip_receiver_email || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json(
          { error: "Saved payment details aren't available yet — ask an admin to apply migration 031." },
          { status: 503 },
        );
      }
      throw error;
    }
    return NextResponse.json({ preset: data });
  } catch (err) {
    return handleApiError(err);
  }
}
