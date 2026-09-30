import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { ACTUAL_APPROVED, ACTUAL_PAID } from "@/lib/spend";
import { authenticateExternal, readParams, envelope, fetchAll } from "@/lib/external-api";

// GET /api/external/v1/spend?fiscal_year=2026&company=ONEST&basis=approved|paid
//
// ACTUAL SPEND per company / department / cat_l1 / cat_l2 per month.
//
// ===========================================================================
// THE KEY CARRIES NO SCOPING. A caller holding it sees every company,
// department and category. Inside the portal, lib/spend.ts#scopeFilter limits
// each person to their own segments; NONE of that applies here — see
// lib/external-api.ts. Do not assume it constrains anything downstream.
// ===========================================================================
//
// NO PERSONAL OR FREE-TEXT DATA. This reads the pre-aggregated
// v_spend_by_segment_month, so requester emails, descriptions, supplier names
// and request ids are not merely filtered out — they are not in the source.
// Reading v_request_spend or `requests` here would expose them and must not
// be done.
//
// THE BASIS IS STATED IN THE RESPONSE, not assumed by the caller. 'approved'
// counts CEO_APPROVED + PAID; 'paid' counts PAID only. The two differ by real
// money, so a dashboard that silently picks one is a dashboard that
// misreports. Both the chosen basis and the statuses behind it are returned.
//
// ONLY GET IS EXPORTED — no write path exists in this file to disable.

export async function GET(req: Request) {
  const endpoint = "/api/external/v1/spend";
  try {
    const auth = await authenticateExternal(req, endpoint);
    if (!auth.ok) return auth.response;
    const params = readParams(req);
    if (!params.ok) return params.response;
    const { fiscalYear, company } = params;

    const basisParam = (new URL(req.url).searchParams.get("basis") ?? "approved").toLowerCase();
    if (!["approved", "paid"].includes(basisParam)) {
      return envelope({ error: "basis must be approved or paid." });
    }
    const statuses: readonly string[] = basisParam === "paid" ? ACTUAL_PAID : ACTUAL_APPROVED;

    const admin = createAdminClient();
    const rows = await fetchAll<Record<string, unknown>>((from, to) => {
      let q = admin.from("v_spend_by_segment_month")
        .select("use_for_company, department, cat_l1, cat_l2, month, amount, status")
        .eq("fiscal_year", fiscalYear)
        .in("status", statuses as string[]);
      // company = the company the expense is CHARGED TO (use_for_company),
      // which is what budget ownership keys on since migration 039 — not the
      // BU the request happened to be filed under.
      if (company) q = q.eq("use_for_company", company);
      return q.range(from, to);
    });

    const lines = new Map<string, {
      company: string; department: string; cat_l1: string; cat_l2: string | null;
      months: number[]; total: number;
    }>();
    for (const r of rows) {
      const co = String(r.use_for_company ?? "");
      const k = [co, r.department, r.cat_l1, String(r.cat_l2 ?? "")].join(" ");
      let line = lines.get(k);
      if (!line) {
        line = {
          company: co, department: String(r.department ?? ""),
          cat_l1: String(r.cat_l1 ?? ""),
          cat_l2: String(r.cat_l2 ?? "").trim() === "" ? null : String(r.cat_l2),
          months: new Array(12).fill(0), total: 0,
        };
        lines.set(k, line);
      }
      const m = Number(r.month);
      if (m >= 1 && m <= 12) {
        const amt = Number(r.amount) || 0;
        line.months[m - 1] += amt;
        line.total += amt;
      }
    }

    const out = Array.from(lines.values()).sort((a, b) =>
      a.company.localeCompare(b.company) ||
      a.department.localeCompare(b.department) ||
      a.cat_l1.localeCompare(b.cat_l1) ||
      String(a.cat_l2 ?? "").localeCompare(String(b.cat_l2 ?? "")));

    return envelope({
      fiscal_year: fiscalYear,
      company: company ?? "ALL",
      currency: "THB",
      basis: basisParam,
      basis_statuses: statuses,
      note: "company is the company the expense is charged to (use_for_company), not the filing business unit.",
      total: out.reduce((s, l) => s + l.total, 0),
      lines: out.map((l) => ({
        company: l.company, department: l.department,
        cat_l1: l.cat_l1, cat_l2: l.cat_l2,
        months: l.months.map((amount, i) => ({ month: i + 1, amount })),
        total: l.total,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
