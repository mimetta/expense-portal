import { createAdminClient } from "@/lib/supabase/admin";

// Dependency counting and the atomic rename, over the SQL functions added in
// migration 042. Nothing here re-implements the counting in JS: a second copy
// of "what points at this category" would drift from the one the rename acts
// on, and then the confirmation would promise something the write did not do.

export interface CategoryDependencies {
  category_rows: number;
  budget_lines: number;
  request_headers: number;
  request_items: number;
}

export const totalDependants = (d: CategoryDependencies) =>
  d.budget_lines + d.request_headers + d.request_items;

/**
 * What points at this category by name. `catL2` narrows to one sub-category;
 * omitting it counts the whole cat_l1.
 *
 * Scoped by (department, cat_l1[, cat_l2]) and NOT by company — see migration
 * 042: one cat_l1 name spans up to 32 `categories` rows across both
 * companies, and renaming it for one company only would split the category.
 */
export async function categoryDependencies(
  department: string,
  catL1: string,
  catL2?: string | null,
): Promise<CategoryDependencies> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("category_dependencies", {
    p_department: department,
    p_cat_l1: catL1,
    p_cat_l2: catL2 ?? null,
  });
  if (error) throw error;
  return data as CategoryDependencies;
}

export interface RenameResult {
  categories: number;
  budget_lines: number;
  request_headers: number;
  request_items: number;
  cascaded: boolean;
}

/** One transaction. See migration 042 for why this cannot be a loop of PATCHes. */
export async function renameCategory(args: {
  department: string;
  oldCatL1: string;
  newCatL1: string;
  oldCatL2?: string | null;
  newCatL2?: string | null;
  cascade: boolean;
}): Promise<RenameResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("rename_category", {
    p_department: args.department,
    p_old_cat_l1: args.oldCatL1,
    p_new_cat_l1: args.newCatL1,
    p_old_cat_l2: args.oldCatL2 ?? null,
    p_new_cat_l2: args.newCatL2 ?? null,
    p_cascade: args.cascade,
  });
  if (error) throw error;
  return data as RenameResult;
}
