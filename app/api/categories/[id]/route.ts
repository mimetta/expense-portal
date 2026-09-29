import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { requireSettingsTabRole } from "@/lib/settings-permissions";
import { logAudit } from "@/lib/audit";
import { categoryDependencies, renameCategory, totalDependants } from "@/lib/category-guard";

interface UpdateCategoryBody {
  bu?: string;
  department?: string;
  cat_l1?: string | null;
  cat_l2?: string | null;
  product?: string | null;
  active?: boolean;
  /** Rename only: also rewrite budget_lines / requests / items_json. */
  cascade?: boolean;
  /** Rename only: the caller has seen the dependency counts and accepts them. */
  confirmed?: boolean;
}

/** GET — what points at this category, so the UI can say so before acting. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "categories");
    const { id } = await params;
    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("categories").select("*").eq("id", id).single();
    if (error) throw error;
    const whole = await categoryDependencies(row.department, row.cat_l1);
    const thisRow = row.cat_l2
      ? await categoryDependencies(row.department, row.cat_l1, row.cat_l2)
      : whole;
    return NextResponse.json({ category: row, dependencies: { catL1: whole, catL2: thisRow } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "categories");

    const { id } = await params;
    const body = (await request.json()) as UpdateCategoryBody;
    const admin = createAdminClient();

    const { data: before, error: beforeErr } = await admin
      .from("categories").select("*").eq("id", id).single();
    if (beforeErr) throw beforeErr;

    // --- activate / deactivate -------------------------------------------
    // A pure active flip, with no name change, needs no dependency check:
    // nothing is detached. History keeps rendering because the spend report
    // reads budget_lines and v_request_spend, never `categories`.
    const onlyActive =
      typeof body.active === "boolean" &&
      body.cat_l1 === undefined && body.cat_l2 === undefined &&
      body.department === undefined && body.bu === undefined;
    if (onlyActive) {
      const { data, error } = await admin
        .from("categories").update({ active: body.active }).eq("id", id).select().single();
      if (error) throw error;
      await logAudit(user.email, null, body.active ? "CATEGORY_REACTIVATED" : "CATEGORY_DEACTIVATED", {
        id, department: before.department, cat_l1: before.cat_l1, cat_l2: before.cat_l2,
        dependencies: await categoryDependencies(before.department, before.cat_l1, before.cat_l2 || null),
      });
      return NextResponse.json({ category: data });
    }

    // --- rename ------------------------------------------------------------
    const renamingL1 = body.cat_l1 !== undefined && body.cat_l1 !== before.cat_l1;
    const renamingL2 = body.cat_l2 !== undefined && (body.cat_l2 ?? "") !== (before.cat_l2 ?? "");

    if (renamingL1 || renamingL2) {
      // Count against the level actually being renamed: a cat_l1 rename moves
      // everything under it, a cat_l2 rename only that sub-category.
      const deps = renamingL1
        ? await categoryDependencies(before.department, before.cat_l1)
        : await categoryDependencies(before.department, before.cat_l1, before.cat_l2);
      const total = totalDependants(deps);

      // The caller must have been shown the counts. Refusing until then is
      // what makes "the confirmation states exactly how many rows" true even
      // for a client that skipped the dialog.
      if (total > 0 && !body.confirmed) {
        return NextResponse.json(
          {
            error: "confirmation_required",
            message:
              `Renaming ${renamingL1 ? before.cat_l1 : `${before.cat_l1} › ${before.cat_l2}`} affects ` +
              `${total} row(s) that reference it by name.`,
            dependencies: deps,
          },
          { status: 409 },
        );
      }

      const result = await renameCategory({
        department: before.department,
        oldCatL1: before.cat_l1,
        newCatL1: renamingL1 ? String(body.cat_l1) : before.cat_l1,
        oldCatL2: renamingL2 ? before.cat_l2 : null,
        newCatL2: renamingL2 ? String(body.cat_l2 ?? "") : null,
        cascade: !!body.cascade,
      });

      // Recorded either way. When the caller declined the cascade, the audit
      // row is the only place the orphan count is written down — that is the
      // point of it.
      await logAudit(user.email, null, "CATEGORY_RENAMED", {
        id,
        department: before.department,
        before: { cat_l1: before.cat_l1, cat_l2: before.cat_l2 },
        after: {
          cat_l1: renamingL1 ? body.cat_l1 : before.cat_l1,
          cat_l2: renamingL2 ? body.cat_l2 : before.cat_l2,
        },
        level: renamingL1 ? "cat_l1" : "cat_l2",
        dependencies: deps,
        cascaded: result.cascaded,
        rows_updated: result,
        rows_left_pointing_at_old_name: result.cascaded ? 0 : total,
      });
      return NextResponse.json({ ok: true, result, dependencies: deps });
    }

    // --- anything else (bu, product) --------------------------------------
    const { data, error } = await admin
      .from("categories").update(body).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ category: data });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await requireSettingsTabRole(user, "categories");

    const { id } = await params;
    const admin = createAdminClient();
    const { data: before, error: beforeErr } = await admin
      .from("categories").select("*").eq("id", id).single();
    if (beforeErr) throw beforeErr;

    // A hard delete is only ever allowed for a category nothing points at.
    // Anything else would detach rows that cannot be reattached, since there
    // is no key to reattach them by — only the name that is about to vanish.
    const deps = await categoryDependencies(
      before.department, before.cat_l1, before.cat_l2 || null,
    );
    const total = totalDependants(deps);
    if (total > 0) {
      return NextResponse.json(
        {
          error: "has_dependencies",
          message:
            `${before.cat_l1}${before.cat_l2 ? ` › ${before.cat_l2}` : ""} cannot be deleted — ` +
            `${deps.budget_lines} budget line(s), ${deps.request_headers} request(s) and ` +
            `${deps.request_items} request item(s) reference it by name, and there is no key to ` +
            `reattach them by once the name is gone. Deactivate it instead: it disappears from the ` +
            `submit form and from new budgets, and its history stays intact.`,
          dependencies: deps,
        },
        { status: 409 },
      );
    }

    await logAudit(user.email, null, "CATEGORY_DELETED", {
      id, bu: before.bu, department: before.department,
      cat_l1: before.cat_l1, cat_l2: before.cat_l2, dependencies: deps,
    });
    const { error } = await admin.from("categories").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
