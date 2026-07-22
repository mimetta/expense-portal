import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { canManageProducts } from "@/lib/permissions";

// Reference data for the /submit form's Product Code picker. Any signed-in
// @mimetta.co user can read it — GET stays open even though the mutation
// path (Settings > Product/SKU Management) is scoped to SUPERADMIN +
// PROCUREMENT, since restricting GET would break the picker for every
// ordinary EMPLOYEE submitting a request.
export async function GET() {
  try {
    await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin.from("products").select("*").order("product_name");
    if (error) throw error;
    return NextResponse.json({ products: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreateProductBody {
  sku_code?: string;
  product_name: string;
  department?: string;
  bu?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!canManageProducts(user)) throw new ForbiddenError();

    const body = (await request.json()) as CreateProductBody;
    if (!body.product_name?.trim()) {
      return NextResponse.json({ error: "product_name is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("products")
      .insert({
        sku_code: body.sku_code ?? null,
        product_name: body.product_name,
        department: body.department ?? null,
        bu: body.bu ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
