"use client";

import { useCallback, useEffect, useState } from "react";

// The revenue sync's visible surface on the budget page.
//
// ===========================================================================
// A SILENTLY FAILING SYNC IS THE REAL RISK: STALE DATA LOOKS LIKE FRESH DATA.
// ===========================================================================
// A sync that refuses on validation writes nothing, so every figure on the
// page keeps its previous value and nothing about the page LOOKS wrong. That
// is the failure this bar exists to make impossible to miss — it is why the
// stale state is loud (amber, named, with the age in hours) rather than a
// greyed-out timestamp somebody has to notice is old.
//
// The state shown is the last RUN and the last SUCCESS, which are different
// facts: a run that failed this morning still leaves last-success at
// yesterday, and both matter.

interface SyncStatus {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: "success" | "validation_failed" | "error" | null;
  lastProblems: string[];
  lastWarnings: string[];
  stale: boolean;
  staleHours: number | null;
}

interface RunOutcome {
  ok: boolean;
  channelsMatched: number;
  cellsWritten: number;
  cellsCleared: number;
  nulledMonths: { month: number; reason: string }[];
  renames: string[];
  problems: string[];
  warnings?: string[];
  error?: string;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;

export default function RevenueSyncBar({
  fiscalYear,
  canSync,
  onSynced,
}: {
  fiscalYear: number;
  /** CEO/SUPERADMIN — the same gate that governs editing revenue figures. */
  canSync: boolean;
  onSynced: () => void;
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunOutcome | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/revenue-sync", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      // The bar is informational; a failed status poll must not break the page.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const syncNow = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/revenue-sync?fiscal_year=${fiscalYear}`, { method: "POST" });
      const body = (await res.json()) as RunOutcome;
      setResult(body);
      await refresh();
      if (res.ok) onSynced();
    } catch (e) {
      setResult({
        ok: false, channelsMatched: 0, cellsWritten: 0, cellsCleared: 0,
        nulledMonths: [], renames: [],
        problems: [e instanceof Error ? e.message : "The request failed."],
      });
    } finally {
      setRunning(false);
    }
  }, [fiscalYear, refresh, onSynced]);

  if (!status) return null;

  const never = status.lastSuccessAt === null;
  // Never-synced is NOT treated as stale — see getSyncStatus. Warning on a
  // fresh deployment would train everyone to ignore this bar, which is the one
  // thing it cannot afford.
  // A run that succeeded but skipped a channel is NOT green. Green would say
  // "everything is current", and for that channel it is not — which is the
  // whole reason the run no longer refuses outright.
  const partial = status.lastStatus === "success" && status.lastWarnings.length > 0;
  const tone = (status.stale && !never) || partial
    ? { bg: "#FEF3C7", border: "#F59E0B", fg: "#92400E", dot: "#F59E0B" }
    : status.lastStatus === "success" || never
      ? { bg: "#F0F4EF", border: "#9CAE8C", fg: "#1F3A2B", dot: "#2E7D52" }
      : { bg: "#FEF2F2", border: "#DC2626", fg: "#8E2A21", dot: "#DC2626" };

  return (
    <div
      className="rounded-[10px] px-4 py-2.5 text-[12.5px]"
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span style={{ width: 7, height: 7, borderRadius: 99, background: tone.dot, flex: "none" }} />
          <span>
            {never
              ? "Revenue actuals have never been synced from the sheet."
              : <>Revenue actuals last synced <strong>{when(status.lastSuccessAt)}</strong></>}
            {status.stale && !never && (
              <> — <strong>{status.staleHours}h ago</strong>. The daily sync has not succeeded in over 48 hours; these figures may be out of date.</>
            )}
            {partial && (
              <> — <strong>{status.lastWarnings.length} channel
                {status.lastWarnings.length === 1 ? "" : "s"} not in the sheet</strong>, figures
                left unchanged.</>
            )}
            {status.lastStatus !== "success" && status.lastRunAt && (
              <> · last attempt {when(status.lastRunAt)} <strong>failed</strong>
                {status.lastStatus === "validation_failed" ? " validation" : ""}.</>
            )}
          </span>
        </div>

        {canSync && (
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={running}
            className="mm-btn-secondary mm-btn-sm shrink-0"
            title={`Read "SUMMARY REPORT ${fiscalYear}" from the revenue sheet and import the actuals. Nothing is written unless every validation passes.`}
          >
            {running ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>

      {/* Why it failed, named. "Sync failed" alone sends someone to the logs;
          the validation messages say which channel or which column is wrong,
          which is the whole of what they need. */}
      {status.lastStatus !== "success" && status.lastProblems.length > 0 && !result && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {status.lastProblems.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}
          {status.lastProblems.length > 6 && <li>…and {status.lastProblems.length - 6} more.</li>}
        </ul>
      )}

      {/* Named, not counted: "1 channel not in the sheet" leaves the reader
          hunting for which. */}
      {partial && !result && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {status.lastWarnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
          {status.lastWarnings.length > 6 && <li>…and {status.lastWarnings.length - 6} more.</li>}
        </ul>
      )}

      {result && (
        <div className="mt-2">
          {result.ok ? (
            <span>
              Synced {result.channelsMatched} channels · {result.cellsWritten} figures written
              {result.cellsCleared ? `, ${result.cellsCleared} cleared to “not yet known”` : ""}
              {result.nulledMonths.length
                ? ` · months left unknown: ${result.nulledMonths.map((n) => n.month).join(", ")}`
                : ""}
              {result.renames.length ? ` · name mappings: ${result.renames.join(", ")}` : ""}
              {result.warnings && result.warnings.length > 0 && (
                <>
                  <br />
                  <strong>{result.warnings.length} channel
                  {result.warnings.length === 1 ? "" : "s"} not in the sheet</strong> — figures
                  left unchanged:
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </>
              )}
            </span>
          ) : (
            <>
              <strong>Nothing was written.</strong> The portal still holds the previous figures.
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {(result.problems ?? [result.error ?? "Unknown failure."]).slice(0, 8).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
