import { createAdminClient } from "@/lib/supabase/admin";
import { listChannels, saveRevenueActuals, isClosedChannel } from "@/lib/revenue-goals";
import { notifyUsers } from "@/lib/notifications";
import { ceoWebhookUrl, postToWebhook } from "@/lib/discord";
import { fetchRevenueTab } from "@/lib/google-sheets";
import {
  parseSheetTable, validateSheet, buildEntries, tabNameFor,
  type SheetProblem,
} from "@/lib/revenue-sheet";
import type { CurrentUser } from "@/types/database";

// The daily revenue sync: read the sheet, validate it, write actuals.
//
// ===========================================================================
// A FAILURE WRITES NOTHING. NOT "writes what it could".
// ===========================================================================
// Validation runs to completion and the import happens only if EVERY check
// passed. A partial import is worse than none: it leaves the portal holding a
// mixture of today's figures and last week's with nothing recording which cell
// is which, and the budget page would show a fresh sync time over it.
//
// The validations are in lib/revenue-sheet.ts, shared with the CSV script, so
// the unattended path and the hand-run path cannot drift. Do not add a
// "force" or "skip validation" flag here — unattended reading of a
// presentation layout is the entire reason the checks exist.

export const SHEET_BU = "ONEST";
export const STALE_AFTER_HOURS = 48;

export interface SyncOutcome {
  ok: boolean;
  fiscalYear: number;
  tabName: string;
  status: "success" | "validation_failed" | "error";
  channelsMatched: number;
  cellsWritten: number;
  cellsCleared: number;
  /** Months imported as NULL and why — a count, never the figures. */
  nulledMonths: { month: number; reason: "future" | "all_zero" }[];
  renames: string[];
  problems: string[];
}

/** Who hears about a broken sync. CEOs and superadmins — the people who can act. */
async function failureRecipients(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("person_roles")
    .select("email, role")
    .in("role", ["CEO", "SUPERADMIN"]);
  const emails = (data ?? []).map((r) => r.email as string);
  const { data: active } = await admin
    .from("people").select("email").eq("active", true).in("email", emails.length ? emails : [""]);
  return (active ?? []).map((p) => p.email as string);
}

/**
 * Tell somebody. Both channels, because they fail differently: the bell needs
 * the portal to be open, Discord does not.
 *
 * Wrapped so a notification failure can never turn into a sync failure — the
 * import has already been refused by the time this runs, and a second error
 * here would only obscure the first.
 */
async function announceFailure(fiscalYear: number, headline: string, problems: string[]) {
  const detail = problems.slice(0, 8).map((p) => `• ${p}`).join("\n");
  const more = problems.length > 8 ? `\n…and ${problems.length - 8} more.` : "";
  const message = `Revenue sync FY${fiscalYear} failed: ${headline}`;

  try {
    const to = await failureRecipients();
    if (to.length) await notifyUsers(to, `revenue-sync-${fiscalYear}`, "REVENUE_SYNC_FAILED", message);
  } catch (e) {
    console.error("revenue-sync: in-app notification failed", e);
  }

  try {
    const url = ceoWebhookUrl();
    if (url) {
      await postToWebhook(url,
        `🔴 **Revenue sync failed — FY${fiscalYear}**\n${headline}\n${detail}${more}\n`
        + `_No figures were written. The portal still holds the previous values._`);
    }
  } catch (e) {
    console.error("revenue-sync: discord notification failed", e);
  }
}

/** Record the attempt. Non-fatal: a missing log must not refuse a good import. */
async function recordRun(row: Record<string, unknown>) {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("revenue_sync_runs").insert(row);
    if (error) throw error;
  } catch (e) {
    console.error("revenue-sync: could not record run", e);
  }
}

export interface SyncOptions {
  fiscalYear: number;
  trigger: "cron" | "manual";
  triggeredBy: string;
  /** The identity the write is attributed to — CEO/SUPERADMIN, same gate as the UI. */
  viewer: CurrentUser;
  /** Test seam: supply rows instead of calling Google. Used by the fixture test. */
  rowsOverride?: string[][];
  now?: Date;
}

export async function runRevenueSync(opts: SyncOptions): Promise<SyncOutcome> {
  const { fiscalYear, trigger, triggeredBy, viewer } = opts;
  const startedAt = new Date();
  const tabName = tabNameFor(fiscalYear);

  const base = {
    fiscal_year: fiscalYear, trigger, triggered_by: triggeredBy,
    started_at: startedAt.toISOString(),
  };
  const fail = async (
    status: "validation_failed" | "error", headline: string, problems: string[],
  ): Promise<SyncOutcome> => {
    await recordRun({
      ...base, finished_at: new Date().toISOString(), status,
      problems: problems as unknown, note: headline,
    });
    await announceFailure(fiscalYear, headline, problems);
    return {
      ok: false, fiscalYear, tabName, status,
      channelsMatched: 0, cellsWritten: 0, cellsCleared: 0,
      nulledMonths: [], renames: [], problems,
    };
  };

  // --- read ---------------------------------------------------------------
  let rows: string[][];
  try {
    rows = opts.rowsOverride ?? (await fetchRevenueTab(fiscalYear, tabName)).rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail("error", "could not read the sheet", [msg]);
  }

  // --- validate -----------------------------------------------------------
  const channels = (await listChannels(false)).filter((c) => c.bu === SHEET_BU);
  if (channels.length === 0) {
    return fail("error", "no active ONEST revenue channels exist in the portal", [
      "listChannels returned nothing for ONEST. Importing against an empty channel list would write nothing and report success.",
    ]);
  }

  const parsed = parseSheetTable(rows);
  const verdict = validateSheet(
    parsed,
    channels.map((c) => ({ id: c.id, channel: c.channel, closed: isClosedChannel(c) })),
    rows,
  );

  if (!verdict.ok) {
    const problems = verdict.problems.map((p: SheetProblem) => p.message);
    const kinds = Array.from(new Set(verdict.problems.map((p) => p.code))).join(", ");
    return fail("validation_failed", `${problems.length} validation problem(s) [${kinds}]`, problems);
  }

  // --- write --------------------------------------------------------------
  const built = buildEntries(verdict.matched, parsed.totalRow, fiscalYear, opts.now ?? new Date());
  let written = 0, cleared = 0;
  try {
    // Same path as the CSV import: actual_source='sheet', actual_synced_at
    // stamped, and the REVENUE_ACTUAL_UPDATED audit row with source 'sheet'.
    // Not a direct table write — the permission gate and the audit trail are
    // the ones the UI uses.
    const res = await saveRevenueActuals(fiscalYear, built.entries, viewer, "sheet");
    written = res.written; cleared = res.cleared;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail("error", "the sheet validated but the write failed", [msg]);
  }

  await recordRun({
    ...base, finished_at: new Date().toISOString(), status: "success",
    channels_matched: verdict.matched.length,
    cells_written: written, cells_cleared: cleared,
    problems: [] as unknown,
    note: verdict.renames.length ? `name mappings: ${verdict.renames.join(", ")}` : null,
  });

  return {
    ok: true, fiscalYear, tabName, status: "success",
    channelsMatched: verdict.matched.length,
    cellsWritten: written, cellsCleared: cleared,
    nulledMonths: built.nulledMonths,
    renames: verdict.renames,
    problems: [],
  };
}

export interface SyncStatus {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: "success" | "validation_failed" | "error" | null;
  lastProblems: string[];
  /** True when the last SUCCESS is older than STALE_AFTER_HOURS, or there has never been one. */
  stale: boolean;
  staleHours: number | null;
}

/**
 * What the budget page shows. Reads the run log, not actual_synced_at — a
 * refused sync writes no cells, so cell timestamps cannot distinguish "the
 * sync is broken" from "nothing changed today".
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const empty: SyncStatus = {
    lastRunAt: null, lastSuccessAt: null, lastStatus: null,
    lastProblems: [], stale: false, staleHours: null,
  };
  try {
    const admin = createAdminClient();
    const { data: last } = await admin
      .from("revenue_sync_runs").select("started_at, status, problems")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    const { data: ok } = await admin
      .from("revenue_sync_runs").select("started_at")
      .eq("status", "success")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();

    // Never synced at all is NOT stale — there is nothing to be stale. Warning
    // on a brand-new deployment would train everyone to ignore the banner,
    // which is the one thing it cannot afford.
    if (!last) return empty;

    const lastSuccessAt = (ok?.started_at as string | undefined) ?? null;
    const hours = lastSuccessAt
      ? (Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000
      : null;

    return {
      lastRunAt: (last.started_at as string) ?? null,
      lastSuccessAt,
      lastStatus: (last.status as SyncStatus["lastStatus"]) ?? null,
      lastProblems: Array.isArray(last.problems) ? (last.problems as string[]) : [],
      stale: lastSuccessAt === null || (hours !== null && hours > STALE_AFTER_HOURS),
      staleHours: hours === null ? null : Math.floor(hours),
    };
  } catch {
    // Before migration 052 is applied, the page shows nothing rather than an
    // error — same graceful-degradation convention as every other
    // not-yet-applied migration in this app.
    return empty;
  }
}
