import { createAdminClient } from "@/lib/supabase/admin";
import { ForbiddenError } from "@/lib/auth";
import { isSuperadmin } from "@/lib/permissions";
import type { CurrentUser } from "@/types/database";

// A budget owner's own category order. See migration 041 for why this is its
// own table rather than anything attached to a revision.

export type { CategoryOrderRow } from "@/lib/budget-order-shared";
export { applyCategoryOrder } from "@/lib/budget-order-shared";
import type { CategoryOrderRow } from "@/lib/budget-order-shared";

/** Only the owner themselves, or a SUPERADMIN acting on their behalf. */
function assertCanOrderFor(viewer: CurrentUser, ownerEmail: string): void {
  if (isSuperadmin(viewer)) return;
  if (viewer.email !== ownerEmail) {
    throw new ForbiddenError(
      "You can only reorder your own budget. An order belongs to the owner it was made by.",
    );
  }
}

export async function getCategoryOrder(ownerEmail: string): Promise<CategoryOrderRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("budget_category_order")
    .select("department, cat_l1, sort_order")
    .eq("owner_email", ownerEmail)
    .order("department")
    .order("sort_order");
  if (error) {
    // Degrade to the default order rather than breaking the page if migration
    // 041 has not been applied yet — same pattern as every other new table in
    // this project.
    if ((error as { code?: string }).code === "PGRST205") return [];
    throw error;
  }
  return (data ?? []) as CategoryOrderRow[];
}

/**
 * Replaces the order for ONE department. The department is the unit of write
 * precisely so a category cannot be moved between departments: a payload
 * naming a different department simply rewrites that other department's rows,
 * and a cat_l1 never changes which department it belongs to — that comes from
 * `categories`, not from here.
 *
 * Writes NO audit_log row, and touches no revision and no figure. This is a
 * display preference; auditing it against a financial record would imply it
 * was part of one.
 */
export async function saveCategoryOrder(
  ownerEmail: string,
  department: string,
  catL1sInOrder: string[],
  viewer: CurrentUser,
): Promise<{ saved: number }> {
  assertCanOrderFor(viewer, ownerEmail);
  const dept = String(department ?? "").trim();
  if (!dept) throw new ForbiddenError("A department is required.");

  const seen = new Set<string>();
  const clean = catL1sInOrder
    .map((c) => String(c ?? "").trim())
    .filter((c) => c && !seen.has(c) && seen.add(c));

  const admin = createAdminClient();
  // Delete-then-insert for this one department only: a category removed from
  // the payload should lose its stored position and fall back to the
  // alphabetical tail, not keep a stale one.
  const { error: delErr } = await admin
    .from("budget_category_order")
    .delete()
    .eq("owner_email", ownerEmail)
    .eq("department", dept);
  if (delErr) throw delErr;

  if (clean.length === 0) return { saved: 0 };
  const { error } = await admin.from("budget_category_order").insert(
    clean.map((cat_l1, i) => ({
      owner_email: ownerEmail,
      department: dept,
      cat_l1,
      sort_order: i,
      updated_at: new Date().toISOString(),
    })),
  );
  if (error) throw error;
  return { saved: clean.length };
}
