import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";

// Reference data for the /submit form's cascading BU -> department ->
// product -> cat_l1 -> cat_l2 pickers. Any signed-in @mimetta.co user can
// read it — it's not sensitive, and everyone needs it to submit a request.
// Optional ?bu=&dept= narrow the result (dept filters the `department`
// column — named "dept" in the query string to match the Settings UI).
export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const bu = searchParams.get("bu");
    const dept = searchParams.get("dept");

    const admin = createAdminClient();
    let query = admin.from("categories").select("*");
    if (bu) query = query.eq("bu", bu);
    if (dept) query = query.eq("department", dept);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ categories: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CategoryInput {
  bu?: string;
  department?: string;
  cat_l1?: string;
  cat_l2?: string;
  product?: string;
}

function toRow(input: CategoryInput) {
  return {
    bu: input.bu ?? "",
    department: input.department ?? "",
    cat_l1: input.cat_l1 || null,
    cat_l2: input.cat_l2 || null,
    product: input.product || null,
  };
}

// Dedup key over (bu, department, cat_l1, cat_l2) — deliberately excludes
// `product`, so two rows that only differ by product still count as the
// same category combination. There's no DB unique constraint to upsert
// against (categories has none), so dedup is done in the application layer
// by comparing against what's already in the table — see POST below.
function dedupeKey(row: { bu: string; department: string; cat_l1: string | null; cat_l2: string | null }) {
  return `${row.bu}||${row.department}||${row.cat_l1 ?? ""}||${row.cat_l2 ?? ""}`;
}

// Single create: { bu, department, cat_l1?, cat_l2?, product? }
// Bulk create (Settings > Category L1/L2 Management import):
//   { bulk: true, rows: [{ bu, department, cat_l1?, cat_l2?, product? }, ...] }
//
// Bulk import is duplicate-safe: existing (bu, department, cat_l1, cat_l2)
// combinations are fetched once up front, incoming rows are filtered down
// to only the combinations not already present (also deduping within the
// uploaded batch itself), and only the new rows are inserted in one batch.
// Re-uploading the same file is always a no-op on the second pass.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "categories");

    const body = (await request.json()) as CategoryInput & { bulk?: boolean; rows?: CategoryInput[] };
    const admin = createAdminClient();

    if (body.bulk === true) {
      if (!Array.isArray(body.rows)) {
        return NextResponse.json({ error: "bulk: true requires a rows array" }, { status: 400 });
      }

      const validInput = body.rows.filter((r) => r.bu?.trim() && r.department?.trim());
      const invalid = body.rows.length - validInput.length;
      if (validInput.length === 0) {
        return NextResponse.json({ error: "No valid rows (bu and department are required)" }, { status: 400 });
      }

      const { data: existing, error: existingError } = await admin
        .from("categories")
        .select("bu, department, cat_l1, cat_l2");
      if (existingError) throw existingError;

      const existingKeys = new Set((existing ?? []).map(dedupeKey));
      const seenInBatch = new Set<string>();
      const newRows: ReturnType<typeof toRow>[] = [];
      let duplicates = 0;

      for (const input of validInput) {
        const row = toRow(input);
        const key = dedupeKey(row);
        if (existingKeys.has(key) || seenInBatch.has(key)) {
          duplicates++;
          continue;
        }
        seenInBatch.add(key);
        newRows.push(row);
      }

      if (newRows.length === 0) {
        return NextResponse.json(
          { categories: [], inserted: 0, skipped: duplicates, invalid },
          { status: 200 },
        );
      }

      const { data, error } = await admin.from("categories").insert(newRows).select();
      if (error) throw error;
      return NextResponse.json(
        { categories: data ?? [], inserted: data?.length ?? 0, skipped: duplicates, invalid },
        { status: 201 },
      );
    }

    if (!body.bu?.trim() || !body.department?.trim()) {
      return NextResponse.json({ error: "bu and department are required" }, { status: 400 });
    }
    const { data, error } = await admin.from("categories").insert(toRow(body)).select().single();
    if (error) throw error;
    return NextResponse.json({ category: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
