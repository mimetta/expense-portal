// The PURE half of the category-order feature: no imports, so a client
// component can use it.
//
// lib/budget-order.ts holds the server half and re-exports these. It reaches
// lib/auth and therefore next/headers, so importing it from a client
// component breaks the build — the same trap that moved ALL_MONTHS out of
// lib/spend. Keeping the pure function here means there is still one
// implementation of the ordering rule, used by both sides.

export interface CategoryOrderRow {
  department: string;
  cat_l1: string;
  sort_order: number;
}

/**
 * Orders `cats` within one department using the owner's stored order.
 *
 * A category WITH a stored position keeps it. A category WITHOUT one — added
 * in Settings since the owner last arranged things — sorts after every
 * positioned one, alphabetically. That is the "lands at the bottom" rule: a
 * hand-made arrangement is never silently rearranged by a category appearing
 * elsewhere in the system.
 */
export function applyCategoryOrder(
  cats: string[],
  order: CategoryOrderRow[],
  department: string,
): string[] {
  const pos = new Map<string, number>();
  for (const o of order) if (o.department === department) pos.set(o.cat_l1, o.sort_order);
  return [...cats].sort((a, b) => {
    const pa = pos.get(a), pb = pos.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;   // positioned sorts before unpositioned
    if (pb !== undefined) return 1;
    return a.localeCompare(b);         // both new: alphabetical, stable
  });
}
