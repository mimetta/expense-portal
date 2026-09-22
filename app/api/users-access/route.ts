import { NextRequest, NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { ConflictError } from "@/lib/request-repo";
import { logAudit } from "@/lib/audit";
import { DEPARTMENTS } from "@/lib/constants";
import { boScopeMatchesRequest } from "@/lib/scope-match";
import { ROLES_V2, type RoleV2Name } from "@/lib/roles-compat";
import { WORKFLOW_MENUS, FREE_MENU_DEFAULTS, menuDefault, type PersonV2 } from "@/lib/access-v2";
import type { ExpenseRequest, RoleRow } from "@/types/database";

// Settings > Users & access. SUPERADMIN only, both verbs.
//
// One save per person, covering roles, BU, spend visibility, BO ownership and
// menu overrides together — so a half-applied change is impossible.

const localPart = (e: string) => e.split("@")[0].toLowerCase();

async function assertAdmin() {
  const user = await requireUser();
  if (!isSuperadmin(user)) throw new ForbiddenError("Only an admin can manage users and access.");
  return user;
}

export async function GET() {
  try {
    await assertAdmin();
    const admin = createAdminClient();
    const [{ data: people }, { data: roles }, { data: scopes }, { data: ovr }, { data: cats }] =
      await Promise.all([
        admin.from("people").select("*"),
        admin.from("person_roles").select("email, role"),
        admin.from("bo_scopes").select("*"),
        admin.from("person_menu_overrides").select("*"),
        admin.from("categories").select("bu, department, cat_l1"),
      ]);

    const reqs: { requester_email: string; timestamp: string; budget_period: string }[] = [];
    for (let f = 0; ; f += 1000) {
      const { data } = await admin
        .from("requests").select("requester_email, timestamp, budget_period").range(f, f + 999);
      reqs.push(...((data ?? []) as unknown as typeof reqs)); if ((data ?? []).length < 1000) break;
    }
    const FY = new Date().getFullYear();
    const counts = new Map<string, number>();
    for (const r of reqs) {
      if (!r.requester_email) continue;
      if (!String(r.budget_period ?? "").startsWith(String(FY)) && !String(r.timestamp ?? "").startsWith(String(FY))) continue;
      counts.set(r.requester_email, (counts.get(r.requester_email) ?? 0) + 1);
    }

    const byLocal = new Map<string, string[]>();
    for (const p of people ?? []) {
      const k = localPart(p.email as string);
      byLocal.set(k, [...(byLocal.get(k) ?? []), p.email as string]);
    }

    const rows = (people ?? []).map((p) => {
      const email = p.email as string;
      return {
        ...p,
        roles: (roles ?? []).filter((r) => r.email === email).map((r) => r.role),
        boScopes: (scopes ?? []).filter((s) => s.email === email),
        overrides: (ovr ?? []).filter((o) => o.email === email),
        active: p.active !== false,
        fy_count: counts.get(email) ?? 0,
        duplicateOf: (byLocal.get(localPart(email)) ?? []).filter((e) => e !== email),
      };
    }).sort((a, b) => b.fy_count - a.fy_count || a.email.localeCompare(b.email));

    // department -> its cat_l1 values, per BU, for the Budget ownership rows.
    const catTree: Record<string, Record<string, string[]>> = {};
    for (const c of cats ?? []) {
      const bu = String(c.bu), dept = String(c.department), l1 = String(c.cat_l1 ?? "");
      if (!l1) continue;
      (catTree[bu] ??= {});
      ((catTree[bu][dept] ??= []));
      if (!catTree[bu][dept].includes(l1)) catTree[bu][dept].push(l1);
    }
    for (const bu of Object.keys(catTree)) for (const d of Object.keys(catTree[bu])) catTree[bu][d].sort();

    return NextResponse.json({
      people: rows,
      departments: DEPARTMENTS,
      roles: ROLES_V2,
      workflowMenus: WORKFLOW_MENUS,
      freeMenus: Object.keys(FREE_MENU_DEFAULTS),
      freeMenuDefaults: FREE_MENU_DEFAULTS,
      catTree,
      fiscalYear: FY,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

interface SavePayload {
  email: string;
  roles: string[];
  bu: "ONEST" | "SV" | "BOTH";
  visible_departments: string[];
  boScopes: { bu_scope: string; dept_scope: string; cat_l1_scope: string }[];
  /** menu -> allowed. Only entries differing from the default are stored. */
  menus: Record<string, boolean>;
  /** Set once the warning about open budget revisions has been shown. */
  confirmDropBo?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await assertAdmin();
    const { email } = (await req.json()) as { email?: string };
    const clean = String(email ?? "").trim().toLowerCase();
    if (!clean.includes("@")) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    const admin = createAdminClient();
    const { data: existing } = await admin.from("people").select("email").eq("email", clean).maybeSingle();
    if (existing) throw new ConflictError(`${clean} already exists.`);
    const { error } = await admin.from("people").insert({
      email: clean, bu: "ONEST", bu_defaulted: true, visible_departments: "",
    });
    if (error) throw error;
    await admin.from("person_roles").insert({ email: clean, role: "EMPLOYEE" });
    await logAudit(actor.email, null, "PERSON_CREATED", {
      email: clean,
      from: { roles: [], bu: null, bu_defaulted: null, visible_departments: null, boScopes: [], overrides: [] },
      to: { roles: ["EMPLOYEE"], bu: "ONEST", bu_defaulted: true, visible_departments: "", boScopes: [], overrides: [] },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await assertAdmin();
    const body = (await req.json()) as SavePayload;
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const admin = createAdminClient();
    const nextRoles = Array.from(new Set((body.roles ?? []).filter((r) => (ROLES_V2 as readonly string[]).includes(r)))) as RoleV2Name[];

    // ---- before state, for the audit row and the safety checks ------------
    const [{ data: before }, { data: beforeRoles }, { data: beforeScopes }, { data: beforeOvr }] = await Promise.all([
      admin.from("people").select("*").eq("email", email).maybeSingle(),
      admin.from("person_roles").select("role").eq("email", email),
      admin.from("bo_scopes").select("bu_scope, dept_scope, cat_l1_scope").eq("email", email),
      admin.from("person_menu_overrides").select("menu, allowed").eq("email", email),
    ]);
    if (!before) return NextResponse.json({ error: `${email} does not exist` }, { status: 404 });
    const hadRoles = (beforeRoles ?? []).map((r) => r.role as string);

    // ---- SAFETY 1: never lock everyone out ---------------------------------
    if (hadRoles.includes("SUPERADMIN") && !nextRoles.includes("SUPERADMIN")) {
      if (email === actor.email) {
        throw new ForbiddenError(
          "You cannot remove your own SUPERADMIN role. Ask another admin to do it, so a mistake here cannot lock you out.",
        );
      }
      const { count } = await admin
        .from("person_roles").select("*", { count: "exact", head: true }).eq("role", "SUPERADMIN");
      if ((count ?? 0) <= 1) {
        throw new ConflictError(
          "This is the last SUPERADMIN. Removing it would leave nobody able to manage users or access.",
        );
      }
    }

    // ---- SAFETY 2: BO ownership must not overlap another owner -------------
    const wantScopes = nextRoles.includes("BO") ? (body.boScopes ?? []) : [];
    if (wantScopes.length > 0) {
      const { data: others } = await admin.from("bo_scopes").select("email, bu_scope, dept_scope, cat_l1_scope").neq("email", email);
      const { data: cats } = await admin.from("categories").select("bu, department, cat_l1");
      const clashes: string[] = [];
      for (const c of cats ?? []) {
        if (!c.cat_l1) continue;
        const line = { bu: c.bu, department: c.department, cat_l1: c.cat_l1 } as unknown as ExpenseRequest;
        const mine = wantScopes.some((s) => boScopeMatchesRequest(s as unknown as RoleRow, line));
        if (!mine) continue;
        // Same matcher the coverage check uses — not a second copy.
        const other = (others ?? []).find((o) => boScopeMatchesRequest(o as unknown as RoleRow, line));
        if (other) {
          const msg = `${c.bu} / ${c.department} / ${c.cat_l1} — also owned by ${other.email}`;
          if (!clashes.includes(msg)) clashes.push(msg);
        }
      }
      if (clashes.length > 0) {
        throw new ConflictError(
          `${clashes.length} budget line(s) would be owned by two people at once, which resolves last-approved-wins with nothing to show it happened. Narrow one of the scopes.\n` +
            clashes.slice(0, 6).join("\n") + (clashes.length > 6 ? `\n…and ${clashes.length - 6} more` : ""),
        );
      }
    }

    // ---- SAFETY 3: dropping BO with open budget revisions -------------------
    if (hadRoles.includes("BO") && !nextRoles.includes("BO")) {
      const { data: open } = await admin
        .from("budget_revisions").select("id, fiscal_year, revision_no, status")
        .eq("owner_email", email).in("status", ["DRAFT", "SUBMITTED"]);
      if ((open ?? []).length > 0 && !body.confirmDropBo) {
        return NextResponse.json({
          needsConfirmation: "dropBo",
          message:
            `${email} owns ${open!.length} open budget revision(s). Removing BO leaves them with no owner who can edit or submit them.`,
          revisions: open,
        }, { status: 409 });
      }
    }

    // ---- write -------------------------------------------------------------
    const depts = (body.visible_departments ?? []).filter((d) => (DEPARTMENTS as readonly string[]).includes(d));
    const { error: pErr } = await admin.from("people").update({
      bu: ["ONEST", "SV", "BOTH"].includes(body.bu) ? body.bu : "ONEST",
      // An explicit save is a decision, so the flag clears.
      bu_defaulted: false,
      visible_departments: depts.join(","),
      is_auto_registered: false,
      updated_at: new Date().toISOString(),
    }).eq("email", email);
    if (pErr) throw pErr;

    await admin.from("person_roles").delete().eq("email", email);
    if (nextRoles.length) {
      const { error } = await admin.from("person_roles").insert(nextRoles.map((role) => ({ email, role })));
      if (error) throw error;
    }

    await admin.from("bo_scopes").delete().eq("email", email);
    if (wantScopes.length) {
      const { error } = await admin.from("bo_scopes").insert(
        wantScopes.map((s) => ({
          email,
          bu_scope: s.bu_scope || "*", dept_scope: s.dept_scope || "*", cat_l1_scope: s.cat_l1_scope || "*",
        })),
      );
      if (error) throw error;
    }

    // Only genuine exceptions are stored; matching the default deletes the row.
    const person: PersonV2 = {
      email, bu: body.bu, bu_defaulted: false, visible_departments: depts.join(","),
      chapter: (before.chapter as string | null) ?? null,
      active: before.active !== false,
      roles: nextRoles, boScopes: wantScopes, overrides: {},
    };
    await admin.from("person_menu_overrides").delete().eq("email", email);
    const keep = Object.entries(body.menus ?? {})
      .filter(([menu]) => !WORKFLOW_MENUS[menu] && FREE_MENU_DEFAULTS[menu])
      .filter(([menu, allowed]) => allowed !== menuDefault(person, menu))
      .map(([menu, allowed]) => ({ email, menu, allowed }));
    if (keep.length) {
      const { error } = await admin.from("person_menu_overrides").insert(keep);
      if (error) throw error;
    }

    await logAudit(actor.email, null, "PERSON_ACCESS_UPDATED", {
      email,
      from: {
        roles: hadRoles.sort(), bu: before.bu, bu_defaulted: before.bu_defaulted,
        visible_departments: before.visible_departments,
        boScopes: beforeScopes ?? [], overrides: beforeOvr ?? [],
      },
      to: {
        roles: [...nextRoles].sort(), bu: person.bu, bu_defaulted: false,
        visible_departments: person.visible_departments,
        boScopes: wantScopes, overrides: keep.map(({ menu, allowed }) => ({ menu, allowed })),
      },
    });
    return NextResponse.json({ ok: true, overrides: keep.length });
  } catch (err) {
    return handleApiError(err);
  }
}
