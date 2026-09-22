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

  // STAGE 2b: people / person_roles, not the legacy roles table.
  const [{ data: peopleRows, error: pErr }, { data: prRows, error: rErr }] = await Promise.all([
    admin.from("people").select("email, visible_departments"),
    admin.from("person_roles").select("email, role"),
  ]);
  if (pErr) throw pErr;
  if (rErr) throw rErr;
  const roleRows = (prRows ?? []).map((r) => ({
    id: `${r.email}|${r.role}`, email: r.email, role: r.role,
    department: (peopleRows ?? []).find((p) => p.email === r.email)?.visible_departments ?? "",
  }));

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
    // STAGE 2b: writes people.visible_departments, which is what
    // lib/spend.ts#scopeFilter now reads. The legacy roles.department column
    // is no longer written — an edit landing there would silently vanish.
    const { data: existing, error: exErr } = await admin
      .from("people").select("email").eq("email", email).maybeSingle();
    if (exErr) throw exErr;

    let created = false;
    if (!existing) {
      // Someone who has filed requests but was never added. Same shape
      // auto-registration gives: EMPLOYEE, BU defaulted AND flagged so it is
      // confirmed rather than inherited.
      const { error } = await admin.from("people").insert({
        email, bu: "ONEST", bu_defaulted: true, visible_departments: value,
      });
      if (error) throw error;
      const { error: rErr } = await admin
        .from("person_roles")
        .upsert({ email, role: "EMPLOYEE" }, { onConflict: "email,role", ignoreDuplicates: true });
      if (rErr) throw rErr;
      created = true;
    } else {
      const { error } = await admin
        .from("people")
        .update({ visible_departments: value, updated_at: new Date().toISOString() })
        .eq("email", email);
      if (error) throw error;
    }

    await logAudit(user.email, null, created ? "DEPARTMENT_ASSIGNED_NEW_ROW" : "DEPARTMENT_ASSIGNED", {
      email, departments: chosen, created_person_row: created,
    });
    return NextResponse.json({ ok: true, created, departments: chosen });
  } catch (err) {
    return handleApiError(err);
  }
}
