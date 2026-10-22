"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { thb } from "@/components/spend/format";
import { SHARED_BRANCH } from "@/lib/branches-shared";

// The branch review screen.
//
// ===========================================================================
// PERMANENT, NOT A BACKFILL TOOL.
// ===========================================================================
// It drains to empty once today's unattributed requests are worked through,
// and then stays as the only way to correct a misfiled branch. The "All"
// filter is what makes that true: a screen that only ever shows unreviewed
// rows becomes useless the day it is finished, and the next misfiling has
// nowhere to be fixed.
//
// IT CHANGES ATTRIBUTION, NOT MONEY. Amounts are not editable here, status is
// never touched, and a PAID request stays PAID. The header says so, because
// somebody looking at a list of paid requests with editable controls is right
// to wonder.

interface Row {
  request_id: string; department: string; status: string; total: number;
  budget_period: string | null; fiscal_year: number; description: string | null;
  requester_email: string; branch: string | null; itemBranches: string[];
  suggestion: string | null; suggestionReason: string | null;
}

const STATUS_TINT: Record<string, string> = {
  PAID: "#F0F4EF", CEO_APPROVED: "#EFF6FF", BO_APPROVED: "#FDF8EE",
  REJECTED: "#FEF2F2", EXPIRED: "#F4F1EC",
};

export default function BranchReviewClient({ departments }: { departments: string[] }) {
  const currentYear = new Date().getFullYear();
  const [department, setDepartment] = useState<string>("");
  const [year, setYear] = useState<number | "">(currentYear);
  const [reviewed, setReviewed] = useState<"unreviewed" | "all">("unreviewed");

  const [rows, setRows] = useState<Row[]>([]);
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Pending edits, keyed by request. Nothing is written until Save, so a
  // mis-click costs nothing and a bulk apply can be reviewed before it lands.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = new URLSearchParams({ reviewed });
      if (department) q.set("department", department);
      if (year) q.set("year", String(year));
      const res = await fetch(`/api/branch-review?${q}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load the review list");
      setRows(body.rows ?? []);
      setOptions(body.branchOptions ?? {});
      setPending({}); setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [department, year, reviewed]);

  useEffect(() => { void load(); }, [load]);

  // The progress strip. "Unattributed" counts VALUE, not rows: ten ฿200
  // receipts and one ฿200,000 fit-out are not the same amount of unknown.
  const stats = useMemo(() => {
    const withBranch = rows.filter((r) => r.branch || r.itemBranches.length > 0).length;
    const without = rows.filter((r) => !r.branch && r.itemBranches.length === 0);
    return {
      total: rows.length,
      reviewed: withBranch,
      unattributed: without.reduce((s, r) => s + r.total, 0),
      unattributedCount: without.length,
    };
  }, [rows]);

  const dirtyCount = Object.keys(pending).length;

  const setOne = (id: string, value: string) =>
    setPending((p) => {
      const next = { ...p };
      if (!value) delete next[id]; else next[id] = value;
      return next;
    });

  const applyBulk = () => {
    if (!bulkValue || selected.size === 0) return;
    setPending((p) => {
      const next = { ...p };
      for (const id of Array.from(selected)) {
        // Only where the value is actually offered for that row's department —
        // the two departments have different lists, and a selection can span
        // both.
        const row = rows.find((r) => r.request_id === id);
        if (row && (options[row.department] ?? []).includes(bulkValue)) next[id] = bulkValue;
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const assignments = Object.entries(pending).map(([request_id, branch]) => ({ request_id, branch }));
      const res = await fetch("/api/branch-review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      setNotice(`${body.updated} request${body.updated === 1 ? "" : "s"} re-attributed. No amounts or statuses were changed.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allOptions = Array.from(new Set(Object.values(options).flat()));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="mm-page-title">Branch review</h1>
        <p className="mm-page-subtitle">
          Requests in branch-split departments. Setting a branch corrects attribution — it does
          not change any amount, does not change the status, and does not reopen the request.
        </p>
      </div>

      {error && (
        <div className="rounded-[10px] px-4 py-2 text-[13px]"
          style={{ background: "#FEF2F2", border: "1px solid #DC2626", color: "#8E2A21" }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[10px] px-4 py-2 text-[13px]"
          style={{ background: "#F0F4EF", border: "1px solid #9CAE8C", color: "#1F3A2B" }}>
          {notice}
        </div>
      )}

      {/* Progress strip */}
      <div className="mm-card flex flex-wrap items-center gap-8">
        <div>
          <div className="mm-section-label" style={{ border: "none", margin: 0 }}>Reviewed</div>
          <div className="text-[22px] font-semibold text-brand-dark">
            {stats.reviewed} <span className="text-[13px] font-normal text-brand-muted">of {stats.total}</span>
          </div>
        </div>
        <div>
          <div className="mm-section-label" style={{ border: "none", margin: 0 }}>Unattributed</div>
          <div className="text-[22px] font-semibold" style={{ color: stats.unattributed > 0 ? "#BD5A2E" : "#1F3A2B" }}>
            {thb(stats.unattributed)}
          </div>
          <div className="text-[11.5px] text-brand-subtle">
            across {stats.unattributedCount} request{stats.unattributedCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="h-10 w-px" style={{ background: "#E5E0D5" }} />
        <p className="max-w-md text-[11.5px] text-brand-muted">
          <strong>Shared</strong> is a deliberate answer — a cost belonging to every branch.
          <em> (no branch)</em> is an absence. This figure should fall toward zero.
        </p>
      </div>

      {/* Filters */}
      <div className="mm-card flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mm-label mb-1 block">Department</span>
          <select className="mm-input w-[220px]" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All branch-split departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mm-label mb-1 block">Fiscal year</span>
          <select className="mm-input w-[130px]" value={year}
            onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")}>
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>FY{y}</option>
            ))}
            <option value="">All years</option>
          </select>
        </label>
        <div>
          <div className="mm-label mb-1">Show</div>
          <div className="mm-tabs">
            <button type="button" onClick={() => setReviewed("unreviewed")}
              className={`mm-tab ${reviewed === "unreviewed" ? "mm-tab-active" : ""}`}>
              Not yet reviewed
            </button>
            {/* What makes this a correction tool rather than a queue. */}
            <button type="button" onClick={() => setReviewed("all")}
              className={`mm-tab ${reviewed === "all" ? "mm-tab-active" : ""}`}
              title="Includes requests that already have a branch, so a misfiled one can be corrected.">
              All
            </button>
          </div>
        </div>
      </div>

      {/* Bulk */}
      <div className="mm-card flex flex-wrap items-center gap-3">
        <span className="text-[12.5px] text-brand-muted">
          {selected.size} selected
        </span>
        <select className="mm-input w-[220px]" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
          <option value="">Set selected to…</option>
          {allOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" className="mm-btn-secondary mm-btn-sm"
          disabled={!bulkValue || selected.size === 0} onClick={applyBulk}>
          Apply to selected
        </button>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="mm-btn-secondary mm-btn-sm"
            disabled={dirtyCount === 0 || saving} onClick={() => setPending({})}>
            Discard changes
          </button>
          <button type="button" className="mm-btn-primary mm-btn-sm"
            disabled={dirtyCount === 0 || saving} onClick={() => void save()}>
            {saving ? "Saving…" : `Save ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}`}
          </button>
        </span>
      </div>

      <p className="text-[11.5px] text-brand-subtle">
        Suggestions come from the description only, and are <strong>never applied
        automatically</strong> — a store named in the text is a hint, not a fact.
      </p>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mm-card text-center text-[13px] text-brand-muted">
          Nothing to review for this filter. {reviewed === "unreviewed" && (
            <>Switch to <strong>All</strong> to correct a branch that is already set.</>
          )}
        </div>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Request</th>
                <th>Department</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th style={{ minWidth: 230 }}>Branch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const value = pending[r.request_id] ?? r.branch ?? "";
                const changed = pending[r.request_id] !== undefined;
                const opts = options[r.department] ?? [];
                return (
                  <tr key={r.request_id} style={changed ? { background: "#FDF8EE" } : undefined}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.request_id)}
                        onChange={() => toggle(r.request_id)} />
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="text-[12.5px]">{r.request_id}</span>
                      <div className="text-[11px] text-brand-subtle">
                        {r.budget_period ?? `FY${r.fiscal_year}`} · {r.requester_email.replace("@mimetta.co", "")}
                      </div>
                    </td>
                    <td className="text-[12px] text-brand-muted">{r.department}</td>
                    <td className="max-w-[320px]">
                      <div className="truncate text-[12.5px]" title={r.description ?? ""}>
                        {r.description || "—"}
                      </div>
                      {r.suggestion && !r.branch && (
                        <div className="mt-0.5 text-[11px]" style={{ color: "#BD5A2E" }}>
                          Suggestion: <strong>{r.suggestion}</strong>
                          {r.suggestionReason ? ` — ${r.suggestionReason}` : ""}
                          {" "}
                          <button type="button" className="underline"
                            onClick={() => setOne(r.request_id, r.suggestion!)}>
                            use
                          </button>
                        </div>
                      )}
                      {r.itemBranches.length > 0 && (
                        <div className="mt-0.5 text-[11px] text-brand-subtle">
                          per-item: {r.itemBranches.join(", ")}
                        </div>
                      )}
                    </td>
                    {/* Read-only, always. This screen corrects attribution. */}
                    <td className="whitespace-nowrap text-right tabular-nums">{thb(r.total)}</td>
                    <td>
                      <span className="rounded-full px-2 py-0.5 text-[11px]"
                        style={{ background: STATUS_TINT[r.status] ?? "#F3F4F6", color: "#374151" }}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <select className="mm-input w-full" value={value}
                        onChange={(e) => setOne(r.request_id, e.target.value)}>
                        <option value="">— no branch —</option>
                        {opts.map((o) => (
                          <option key={o} value={o}>{o === SHARED_BRANCH ? `${o} (every branch)` : o}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
