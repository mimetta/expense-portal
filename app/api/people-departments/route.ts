import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { isSuperadmin } from "@/lib/permissions";
import { DEPARTMENTS } from "@/lib/constants";
import { logAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth";

// Settings > People & departments. SUPERADMIN only, both verbs.
//
// Assembles one row per PERSON from two sources that do not fully overlap:
// the roles table, and whoever has actually filed a request. 9 people have
// filed but hold no roles row at all (chamaiporn.p is the 7th-heaviest user
// in the company with 54 FY2026 requests) — they have to appear here, or the
// people most in need of a department are the ones you cannot assign one to.

const FY = new Date().getFullYear();

interface PersonRow {
  email: string;
  roles: string[];
  roleIds: string[];
  department: string[];
  hasRolesRow: boolean;
  fy_count: number;
  /** Departments actually filed against this fiscal year, highest first. */
  history: { department: string; count: number }[];
  /** Another account whose local-part matches — surfaced, never merged. */
  possibleDuplicateOf?: string;
}

const localPart = (email: string) => email.split("@")[0].toLowerCase();
const splitList = (v: unknown) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function assemble(): Promise<PersonRow[]> {
  const admin = createAdminClient();

  const { data: roleRows, error: roleErr } = await admin
    .from("roles")
    .select("id, email, role, department");
  if (roleErr) throw roleErr;

  // Paged: PostgREST caps at 1000 and there are >1100 requests.
  const reqs: { requester_email: string; department: string; timestamp: string; budget_period: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("requests")
      .select("requester_email, department, timestamp, budget_period")
      .range(from, from + 999);
    if (error) throw error;
    reqs.push(...((data ?? []) as unknown as typeof reqs));
    if ((data ?? []).length < 1000) break;
  }
  const thisFy = reqs.filter(
    (r) =>
      String(r.budget_period ?? "").startsWith(String(FY)) ||
      String(r.timestamp ?? "").startsWith(String(FY)),
  );

  const perUser = new Map<string, Map<string, number>>();
  for (const r of thisFy) {
    const e = r.requester_email;
    if (!e) continue;
    if (!perUser.has(e)) perUser.set(e, new Map());
    if (!r.department) continue;
    const m = perUser.get(e)!;
    m.set(r.department, (m.get(r.department) ?? 0) + 1);
  }

  const emails = Array.from(
    new Set([
      ...(roleRows ?? []).map((r) => r.email as string),
      ...Array.from(perUser.keys()),
    ]),
  );

  // Same local-part on a different domain. wacharanan.j exists as both
  // @mimetta.co (9 requests) and @plantae.co (25) — a third domain the email
  // migration never covered. Flagged for a human; nothing is merged here,
  // because picking the wrong survivor silently reassigns 25 requests.
  const byLocal = new Map<string, string[]>();
  for (const e of emails) {
    const k = localPart(e);
    byLocal.set(k, [...(byLocal.get(k) ?? []), e]);
  }

  const rows: PersonRow[] = emails.map((email) => {
    const mine = (roleRows ?? []).filter((r) => r.email === email);
    const hist = Array.from((perUser.get(email) ?? new Map()).entries())
      .map(([department, count]) => ({ department, count: count as number }))
      .sort((a, b) => b.count - a.count);
    const twins = (byLocal.get(localPart(email)) ?? []).filter((e) => e !== email);
    return {
      email,
      roles: Array.from(new Set(mine.map((r) => r.role as string))).sort(),
      roleIds: mine.map((r) => String(r.id)),
      department: Array.from(new Set(mine.flatMap((r) => splitList(r.department)))).sort(),
      hasRolesRow: mine.length > 0,
      fy_count: hist.reduce((s, h) => s + h.count, 0),
      history: hist,
      ...(twins.length ? { possibleDuplicateOf: twins.join(", ") } : {}),
    };
  });

  // Heaviest users first, and within an equal count the unassigned first, so
  // the remaining gap stays visible rather than sinking into the list.
  rows.sort(
    (a, b) =>
      b.fy_count - a.fy_count ||
      Number(a.department.length > 0) - Number(b.department.length > 0) ||
      a.email.localeCompare(b.email),
  );
  return rows;
}

export async function GET() {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError("Only an admin can assign departments.");
    return NextResponse.json({ people: await assemble(), departments: DEPARTMENTS, fiscalYear: FY });
  } catch (err) {
    return handleApiError(err);
  }
}

// PUT { email, departments: string[] }
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isSuperadmin(user)) throw new ForbiddenError("Only an admin can assign departments.");
    const body = (await req.json()) as { email?: string; departments?: string[] };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    // Only canonical departments. The UI is a multi-select, but the route is
    // the boundary: a typed or stale value would match no request row and the
    // person would silently see nothing.
    const allowed = new Set<string>(DEPARTMENTS as readonly string[]);
    const chosen = Array.from(new Set((body.departments ?? []).map((d) => String(d).trim()).filter(Boolean)));
    const bad = chosen.filter((d) => !allowed.has(d));
    if (bad.length > 0) {
      return NextResponse.json(
        { error: `Not a known department: ${bad.join(", ")}. Pick from the list.` },
        { status: 400 },
      );
    }
    const value = chosen.join(",");

    const admin = createAdminClient();
    const { data: existing, error: exErr } = await admin.from("roles").select("id").eq("email", email);
    if (exErr) throw exErr;

    let created = false;
    if ((existing ?? []).length === 0) {
      // Someone who has filed requests but never had a row. Give them the
      // same shape auto-registration would: EMPLOYEE, unrestricted approval
      // scopes (which grant nothing on their own), plus the department.
      const { error } = await admin.from("roles").insert({
        email,
        role: "EMPLOYEE",
        bu_scope: "*",
        dept_scope: "*",
        cat_l1_scope: "*",
        department: value,
      });
      if (error) throw error;
      created = true;
    } else {
      // Every row for this person — department is a property of the person,
      // not of one role they happen to hold.
      const { error } = await admin.from("roles").update({ department: value }).eq("email", email);
      if (error) throw error;
    }

    await logAudit(user.email, null, created ? "DEPARTMENT_ASSIGNED_NEW_ROW" : "DEPARTMENT_ASSIGNED", {
      email,
      departments: chosen,
      created_employee_row: created,
    });
    return NextResponse.json({ ok: true, created, departments: chosen });
  } catch (err) {
    return handleApiError(err);
  }
}
