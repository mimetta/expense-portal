import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { hasAnyRole } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-helpers";
import { runRevenueSync, getSyncStatus } from "@/lib/revenue-sync";

// GET  /api/revenue-sync   — with the cron secret: RUN the sync.
//                            with a session: last-synced status for the UI.
// POST /api/revenue-sync   — "Sync now", CEO/SUPERADMIN session.
//
// TWO CALLERS, ONE BODY OF WORK:
//   1. Vercel Cron, daily at 02:00 UTC = 09:00 Bangkok (vercel.json; Vercel
//      Cron runs in UTC and ICT is UTC+7, the same convention
//      /api/cron/document-reminder already uses). Authenticated by
//      `Authorization: Bearer $CRON_SECRET`.
//   2. A CEO or SUPERADMIN pressing "Sync now" on the budget page.
//
// VERCEL CRON ISSUES A **GET**, NOT A POST — which is why running the sync
// hangs off GET rather than the POST you would otherwise expect for a mutating
// call. The two GET behaviours are told apart by the cron secret, checked
// first; without it GET is the harmless read the budget page polls. Putting
// the run on POST only would have produced a cron that 405s every night, which
// is precisely the silent failure this whole feature exists to prevent.
//
// ===========================================================================
// THIS ROUTE NEVER RETURNS SHEET CONTENTS.
// ===========================================================================
// The response carries counts, month numbers and validation messages. No cell
// values, no channel figures, no row dumps. The sheet is the company's revenue
// by channel; this endpoint exists to say whether the import worked, not to
// become a second way to read it. Validation messages do name a CHANNEL when
// one is unknown or missing — that is the whole point of the message, and a
// channel name is not a figure.

export const dynamic = "force-dynamic";

/** Vercel signs cron requests with the shared secret. */
function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function runFromRequest(req: Request) {
  {
    const url = new URL(req.url);
    const yearParam = url.searchParams.get("fiscal_year") ?? url.searchParams.get("year");
    const fiscalYear = yearParam ? Number(yearParam) : new Date().getFullYear();
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ error: "fiscal_year must be a year between 2000 and 2100." }, { status: 400 });
    }

    let trigger: "cron" | "manual";
    let triggeredBy: string;
    let viewer;

    if (isCron(req)) {
      trigger = "cron";
      triggeredBy = "vercel-cron";
      // The write still goes through saveRevenueActuals, which enforces
      // CEO/SUPERADMIN. The cron has no session, so it acts as a synthetic
      // SUPERADMIN — the authority is the CRON_SECRET, already checked above.
      // Spelled out rather than bypassing the gate, so the audit row and the
      // permission check stay the same ones the UI path uses.
      viewer = {
        email: "system@revenue-sync",
        name: "Revenue sync",
        chapter: null,
        allRoles: [{ role: "SUPERADMIN", bu_scope: "*", dept_scope: "*", cat_l1_scope: "*" }],
      } as never;
    } else {
      const user = await requireUser();
      if (!hasAnyRole(user, ["CEO", "SUPERADMIN"])) {
        return NextResponse.json(
          { error: "Only a CEO or SUPERADMIN can run the revenue sync." }, { status: 403 },
        );
      }
      trigger = "manual";
      triggeredBy = user.email;
      viewer = user;
    }

    const outcome = await runRevenueSync({ fiscalYear, trigger, triggeredBy, viewer });

    // 200 for a clean run, 422 for a sheet the person needs to fix, 500 for a
    // fault in this code or Google. The cron's own retry/alerting reads the
    // status code, and "the sheet is wrong" is not a server error.
    const status = outcome.ok ? 200 : outcome.status === "validation_failed" ? 422 : 500;
    return NextResponse.json(outcome, { status });
  }
}

/** "Sync now" from the budget page. */
export async function POST(req: Request) {
  try {
    return await runFromRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}

/** Cron (with the secret) runs it; anyone signed in gets the status. */
export async function GET(req: Request) {
  try {
    if (isCron(req)) return await runFromRequest(req);
    await requireUser();          // any signed-in user may see whether it is stale
    return NextResponse.json(await getSyncStatus());
  } catch (err) {
    return handleApiError(err);
  }
}
