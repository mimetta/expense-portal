"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BudgetGrid from "@/components/budget/BudgetGrid";
import RevenueSyncBar from "@/components/budget/RevenueSyncBar";
import BranchBar from "@/components/budget/BranchBar";
import {
  ALL_BRANCHES, NO_BRANCH, isBranchSplit, branchColumnValue, type Branch,
} from "@/lib/branches-shared";
import { thb, EM_DASH } from "@/components/spend/format";
import type { BudgetOwnerOption, EditorData, EditorRow } from "@/lib/budget-editor";
import type { RevenueNode } from "@/lib/revenue-goals";
import type { CategoryOrderRow } from "@/lib/budget-order-shared";

interface Props {
  /** Today's year — the DEFAULT for the selector, not the only choice. */
  currentYear: number;
  viewerEmail: string;
  isOwner: boolean;
  hasScope: boolean;
  /** SUPERADMIN: picks an owner and acts on their behalf. */
  isAdmin: boolean;
  owners: BudgetOwnerOption[];
  /** Who a scopeless reader should contact — empty unless that is the case. */
  adminContacts: string[];
  canReview: boolean;
  /** Revisions waiting on this viewer. 0 for anyone who cannot approve. */
  pendingApprovals: number;
}

/**
 * The one link every budget page carries to the other two. Before this, the
 * only route to a submitted revision was typing its UUID.
 */
function BudgetNavLinks({ canReview }: { canReview: boolean }) {
  return (
    <p className="text-[12px] text-brand-muted">
      <Link href="/budget/history" className="text-brand-brown underline hover:text-brand-accent">
        {canReview ? "Budget history & approval queue" : "Budget history"}
      </Link>
      {" — every revision by every owner, with who submitted and who approved."}
    </p>
  );
}

/** Banner on the editor pointing an approver at the queue. */
function PendingApprovalBanner({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] px-4 py-3 text-[13px]"
      style={{ background: "#FEF3C7", border: "1px solid #FCD34D", color: "#92400E" }}
    >
      <span>
        <strong>
          {count} budget revision{count === 1 ? "" : "s"} waiting for your approval.
        </strong>{" "}
        This page is the editor — approvals happen in the history queue.
      </span>
      <Link
        href="/budget/history?tab=pending"
        className="shrink-0 rounded-[6px] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
        style={{ background: "#BD5A2E" }}
      >
        Review {count === 1 ? "it" : "them"} →
      </Link>
    </div>
  );
}

type SaveState =
  | { kind: "idle"; savedAt?: string }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; savedAt: string }
  | { kind: "error"; message: string };

const STATUS_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: "#F3F4F6", fg: "#374151", label: "Draft" },
  SUBMITTED: { bg: "#FEF3C7", fg: "#92400E", label: "Awaiting CEO" },
  APPROVED: { bg: "#1F3A2B", fg: "#FFFFFF", label: "Live" },
  REJECTED: { bg: "#FEF2F2", fg: "#DC2626", label: "Rejected" },
  SUPERSEDED: { bg: "#F4F1EC", fg: "#6B6B60", label: "Superseded" },
};

// Current year +1 back to -2, matching /reports/spend's selector exactly.
// +1 is the one that matters: FY2027 has to be reachable during planning
// season, before the calendar rolls over. -1 matters equally from the other
// side — on 1 Jan 2027, FY2026 must not become unreachable.
const yearOptions = (currentYear: number) => [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

function parseYear(raw: string | null, currentYear: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : currentYear;
}

function YearSelect({
  value, options, onChange, busy,
}: { value: number; options: number[]; onChange: (y: number) => void; busy?: boolean }) {
  return (
    <label className="block">
      <span className="mm-label mb-1 block">Fiscal year</span>
      <select
        className="mm-input w-[130px]"
        value={value}
        disabled={busy}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((y) => (
          <option key={y} value={y}>FY{y}</option>
        ))}
      </select>
    </label>
  );
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const shortName = (email: string) => email.replace("@mimetta.co", "");

export default function BudgetEditorClient({
  currentYear,
  viewerEmail,
  isOwner,
  hasScope,
  isAdmin,
  owners,
  adminContacts,
  canReview,
  pendingApprovals,
}: Props) {
  // The fiscal year lives in the query string so a view is shareable and
  // survives a refresh — same mechanism /reports/spend uses for its filters.
  // It was previously new Date().getFullYear() in page.tsx with no selector,
  // which made FY2027 planning impossible before January and would have made
  // FY2026 unreachable on 1 Jan 2027.
  const searchParams = useSearchParams();
  const [fiscalYear, setFiscalYear] = useState(() =>
    parseYear(searchParams.get("year"), currentYear),
  );

  const [data, setData] = useState<EditorData | null>(null);
  const [rows, setRows] = useState<EditorRow[]>([]);
  // Only "loading" if something is actually going to load — an admin who has
  // not chosen an owner yet is idle, not waiting.
  const [loading, setLoading] = useState(() => (isAdmin ? hasScope : isOwner && hasScope));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [deptFilter, setDeptFilter] = useState<string>("");
  // The COMPANY filter. Never "" any more — "Both" was removed, so exactly
  // one company is shown at a time and the revenue goal denominator beneath
  // is always that one company's. Empty only in the instant before the first
  // load resolves, since the available companies come from the data.
  const [buFilter, setBuFilter] = useState<string>("");
  // Branch is a SELECTOR, not a filter stacked on the others: it decides which
  // single branch is being edited, and "All branches" is a read-only roll-up.
  // In the query string so a branch view is shareable, like the fiscal year.
  const [branch, setBranch] = useState<string>(() =>
    searchParams.get("branch") || ALL_BRANCHES);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  // SUPERADMIN only. Defaults to themselves if they happen to hold BO scope,
  // otherwise nothing is loaded until an owner is chosen — an admin should
  // never arrive at a populated grid without having said whose it is.
  const [selectedOwner, setSelectedOwner] = useState(() => (isAdmin && hasScope ? viewerEmail : ""));

  // Revenue goals — the denominator the budget is planned against. Re-fetched
  // when the company filter changes: the goal shown must be that company's
  // alone. Since "Both" was removed, the denominator is never a combined
  // figure, so every "of goal" percentage divides a single company's budget
  // line by that same company's goal.
  const [revenue, setRevenue] = useState<{ tree: RevenueNode; canEdit: boolean; syncedAt: string | null } | null>(null);
  const [addingChannel, setAddingChannel] = useState(false);

  // The owner's saved category order, and the Collapse all / Expand all
  // signal handed to the grid. The nonce lets the same button fire twice.
  const [categoryOrder, setCategoryOrder] = useState<CategoryOrderRow[]>([]);
  const [collapseSignal, setCollapseSignal] = useState<{ collapsed: boolean; nonce: number } | null>(null);
  // Starts true because groups now load collapsed, so the button offers the
  // action that is actually available. It can read "Expand all" over an
  // already-expanded grid if someone's remembered state is fully open; the
  // button still toggles correctly, and guessing at the stored set here would
  // duplicate the grid's own hydration logic.
  const [allCollapsed, setAllCollapsed] = useState(true);
  // Whether THIS VIEWER may add/rename/deactivate a revenue channel.
  //
  // THE VIEWER, DELIBERATELY — not the budget owner on screen. A revenue
  // channel is company-wide reference data, not part of anyone's budget, so
  // the permission to create one belongs to the person doing it. Consequences,
  // both intended:
  //   * an owner without the toggle, on their own page, sees no button;
  //   * an admin acting on that owner's behalf DOES see it, because the
  //     permission is the admin's and the channel is not the owner's.
  // The second was reported as a bug; it is the rule. The API enforces the
  // same viewer check regardless — see app/api/revenue/channels/route.ts.
  const [canAddChannel, setCanAddChannel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/budget/branches?year=${fiscalYear}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setBranches(body.branches ?? []);
      } catch {
        // The bar simply does not render; the grid is unaffected.
      }
    })();
    return () => { cancelled = true; };
    // Re-fetched per year: whether a closed branch traded is a fact about the
    // YEAR, so it has to move when the year selector does.
  }, [fiscalYear]);

  const dirtyRef = useRef<Map<string, EditorRow>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ownerEmail = isAdmin ? selectedOwner : viewerEmail;
  const onBehalf = !!ownerEmail && ownerEmail !== viewerEmail;

  const load = useCallback(async (owner: string) => {
    setLoading(true);
    setError(null);
    // Switching owners must not carry the previous owner's unsaved cells into
    // the next revision — they would be written against the wrong owner.
    if (timerRef.current) clearTimeout(timerRef.current);
    dirtyRef.current = new Map();
    setSave({ kind: "idle" });
    setData(null);
    setRows([]);
    try {
      const created = await fetch("/api/budget/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalYear, ownerEmail: owner }),
      });
      const body = await created.json();
      if (!created.ok) throw new Error(body.error || "Could not open your draft");
      const res = await fetch(`/api/budget/draft?revisionId=${body.revision.id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load the draft");
      setData(d);
      setRows(d.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fiscalYear]);

  useEffect(() => {
    if (isAdmin) {
      if (selectedOwner) void load(selectedOwner);
      else setLoading(false);
    } else if (isOwner && hasScope) {
      void load(viewerEmail);
    } else {
      setLoading(false);
    }
  }, [isAdmin, selectedOwner, isOwner, hasScope, viewerEmail, load]);

  const loadRevenue = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ year: String(fiscalYear) });
      if (buFilter) qs.set("bu", buFilter);
      const res = await fetch(`/api/revenue/goals?${qs}`);
      const d = await res.json();
      if (res.ok) setRevenue({ tree: d.tree, canEdit: !!d.canEdit, syncedAt: d.syncedAt ?? null });
    } catch {
      // The budget page must still work if goals are unavailable.
    }
  }, [fiscalYear, buFilter]);

  // Default to the owner's own company where they hold lines in it, else the
  // first they do hold. Re-runs when the owner or year changes, but leaves an
  // explicit choice alone as long as it is still available.
  useEffect(() => {
    const options = data?.scope.bus ?? [];
    if (options.length === 0) return;
    if (buFilter && options.includes(buFilter)) return;
    const own = data?.scope.ownerBu;
    setBuFilter(own && options.includes(own) ? own : options[0]);
  }, [data?.scope.bus, data?.scope.ownerBu, buFilter]);

  useEffect(() => { void loadRevenue(); }, [loadRevenue]);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((r) => r.json())
      .then((d) => setCanAddChannel(!!d.menus?.["revenue.channels"]))
      .catch(() => setCanAddChannel(false));
  }, []);

  // The order belongs to the OWNER, so it is re-fetched whenever the owner
  // changes — an admin acting on someone's behalf sees that person's
  // arrangement, not their own.
  const loadOrder = useCallback(async () => {
    if (!ownerEmail) { setCategoryOrder([]); return; }
    try {
      const res = await fetch(`/api/budget/category-order?ownerEmail=${encodeURIComponent(ownerEmail)}`);
      const d = await res.json();
      if (res.ok) setCategoryOrder(d.order ?? []);
    } catch { /* default alphabetical order is a fine fallback */ }
  }, [ownerEmail]);

  useEffect(() => { void loadOrder(); }, [loadOrder]);

  // Optimistic: the grid re-sorts immediately, then the write confirms it.
  // No revision, no figure, no audit row against one — see migration 041.
  const onReorderCategories = useCallback(
    async (department: string, catL1s: string[]) => {
      setCategoryOrder((prev) => [
        ...prev.filter((o) => o.department !== department),
        ...catL1s.map((cat_l1, i) => ({ department, cat_l1, sort_order: i })),
      ]);
      try {
        const res = await fetch("/api/budget/category-order", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerEmail, department, catL1s }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not save the order");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        void loadOrder();   // put the displayed order back to what is stored
      }
    },
    [ownerEmail, loadOrder],
  );

  const onRevenueChange = useCallback(
    async (channelId: string, month: number, value: number | null) => {
      try {
        const res = await fetch("/api/revenue/goals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fiscalYear, entries: [{ channelId, month, amount: value }] }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not save the goal");
        await loadRevenue();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [fiscalYear, loadRevenue],
  );

  // Actuals are a separate key on the same endpoint: a null goal deletes the
  // row, a null actual only clears the actual columns, so they must not share
  // one array. See lib/revenue-goals.ts#saveRevenueActuals.
  const onRevenueActualChange = useCallback(
    async (channelId: string, month: number, value: number | null) => {
      try {
        const res = await fetch("/api/revenue/goals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fiscalYear, actuals: [{ channelId, month, actual: value }] }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Could not save the actual");
        await loadRevenue();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [fiscalYear, loadRevenue],
  );

  // Additive refresh: pulls in categories added since this draft was created.
  // Never removes a line, never touches a figure — see refreshDraftLines.
  const onRefreshLines = useCallback(async () => {
    if (!data?.revision) return;
    setBusy(true);
    try {
      const res = await fetch("/api/budget/draft/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: data.revision.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not refresh the lines");
      setNotice(
        d.added === 0
          ? `No new categories — all ${d.existing} lines are already here.` +
            (d.stale ? ` ${d.stale} line(s) no longer match an active category; they were left untouched.` : "")
          : `${d.added} line(s) added.` +
            (d.stale ? ` ${d.stale} line(s) no longer match an active category; they were left untouched.` : ""),
      );
      if (ownerEmail) await load(ownerEmail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [data?.revision, ownerEmail, load]);

  const onToggleChannel = useCallback(
    async (channelId: string, active: boolean) => {
      await fetch("/api/revenue/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: channelId, active }),
      });
      await loadRevenue();
    },
    [loadRevenue],
  );

  // Mirror the year into the address bar. history.replaceState, not a router
  // navigation: all that is needed is a shareable/refreshable URL, and a
  // router push would re-run page.tsx's server guard on every switch.
  // Other params are preserved rather than overwritten.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set("year", String(fiscalYear));
    if (branch !== ALL_BRANCHES) q.set("branch", branch); else q.delete("branch");
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  }, [fiscalYear]);

  // --- autosave -------------------------------------------------------------
  // Debounced, and the state never claims "saved" until the write returns —
  // showing success optimistically would be a lie the BO acts on.
  const flush = useCallback(async () => {
    const pending = Array.from(dirtyRef.current.values());
    if (pending.length === 0 || !data?.revision) return;
    dirtyRef.current = new Map();
    setSave({ kind: "saving" });
    try {
      const payload = pending.flatMap((r) =>
        r.proposed.map((amount, i) => ({
          bu: r.bu,
          department: r.department,
          cat_l1: r.cat_l1,
          cat_l2: r.cat_l2,
          branch: r.branch,
          month: i + 1,
          amount,
        })),
      );
      const res = await fetch("/api/budget/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: data.revision.id, lines: payload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      setSave({ kind: "saved", savedAt: body.savedAt });
    } catch (e) {
      // Put the rows back in the dirty set so the next save retries them.
      for (const r of pending) dirtyRef.current.set(r.key, r);
      setSave({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [data?.revision]);

  const markDirty = useCallback(
    (row: EditorRow) => {
      dirtyRef.current.set(row.key, row);
      setSave({ kind: "dirty" });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 1200);
    },
    [flush],
  );

  // Switching year reloads the grid, and load() resets the dirty map — so
  // anything typed inside the 1.2s debounce window would be silently dropped.
  // Flush it FIRST, against the revision it was typed into: flush() closes
  // over the current data.revision, so those cells land on the old year's
  // draft, which is where they belong.
  const onYearChange = useCallback(
    async (next: number) => {
      if (next === fiscalYear) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current.size > 0) await flush();
      setFiscalYear(next);
    },
    [fiscalYear, flush],
  );

  const mutate = useCallback(
    (rowKey: string, fn: (r: EditorRow) => EditorRow) => {
      setRows((prev) => {
        const next = prev.map((r) => (r.key === rowKey ? fn(r) : r));
        const changed = next.find((r) => r.key === rowKey);
        if (changed) markDirty(changed);
        return next;
      });
    },
    [markDirty],
  );

  const onChange = useCallback(
    (rowKey: string, month: number, value: number) =>
      mutate(rowKey, (r) => {
        const proposed = [...r.proposed];
        proposed[month] = value;
        return { ...r, proposed };
      }),
    [mutate],
  );

  const onFillRight = useCallback(
    (rowKey: string, fromMonth: number) =>
      mutate(rowKey, (r) => {
        const proposed = [...r.proposed];
        for (let m = fromMonth + 1; m < 12; m++) proposed[m] = proposed[fromMonth];
        return { ...r, proposed };
      }),
    [mutate],
  );

  const onCopyPriorYear = useCallback(
    (rowKey: string) => mutate(rowKey, (r) => ({ ...r, proposed: [...r.priorActual] })),
    [mutate],
  );

  const onClearRow = useCallback(
    (rowKey: string) => mutate(rowKey, (r) => ({ ...r, proposed: r.proposed.map(() => 0) })),
    [mutate],
  );

  // --- derived --------------------------------------------------------------
  // Must match lib/budget-editor.ts#rowKey EXACTLY. The two disagreeing would
  // make a materialised row save to a different coordinate than it displays.
  const makeRowKey = (r: {
    bu: string; department: string; cat_l1: string; cat_l2: string | null; branch: string | null;
  }) => `${r.bu}|${r.department}|${r.cat_l1}|${r.cat_l2 ?? ""}|${r.branch ?? ""}`;

  // Does this owner's budget contain any branch-split department at all?
  // Nobody else sees the bar.
  const hasBranchDept = useMemo(
    () => rows.some((r) => isBranchSplit(r.department)),
    [rows],
  );

  // Which branches already hold lines THIS fiscal year — the input to the
  // closed-branch rule, which asks "does it already budget here", never "is
  // the year in the future".
  const branchesWithLines = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (isBranchSplit(r.department) && r.branch) s.add(r.branch);
    return s;
  }, [rows]);

  const dirtyBranches = useMemo(() => {
    const s = new Set<string>();
    for (const r of Array.from(dirtyRef.current.values())) {
      s.add(r.branch ?? NO_BRANCH);
    }
    return s;
    // `save` is the trigger: dirtyRef is a ref, so this recomputes when the
    // save state moves rather than on every keystroke.
  }, [save]);

  // MATERIALISE A BRANCH'S LINES ON DEMAND.
  //
  // Branch lines only exist once somebody has budgeted, which was circular: a
  // branch could not be budgeted because it had no lines to type into, so
  // selecting one showed "0 of 44 lines" and the empty state.
  //
  // Selecting a branch now projects the owner's FULL category set onto it, at
  // zero where nothing has been entered. These rows are client-side only —
  // nothing is written until a figure is typed and saved, so the database
  // still gains a line because somebody budgeted, never because a branch
  // exists. Pre-creating them would be 44 categories x 16 branches x 12 months
  // = 8,448 empty rows per owner per year, almost all of which would stay zero.
  useEffect(() => {
    if (!hasBranchDept || branch === ALL_BRANCHES) return;
    const want = branchColumnValue(branch);
    setRows((prev) => {
      // One template per coordinate, for `approved` and `priorActual` — those
      // are NOT branch-split, so every branch's row shares the same baseline.
      const templates = new Map<string, EditorRow>();
      const present = new Set<string>();
      for (const r of prev) {
        if (!isBranchSplit(r.department)) continue;
        const coord = `${r.bu}|${r.department}|${r.cat_l1}|${r.cat_l2 ?? ""}`;
        if (!templates.has(coord)) templates.set(coord, r);
        if ((r.branch ?? null) === want) present.add(coord);
      }
      const additions: EditorRow[] = [];
      for (const [coord, t] of Array.from(templates.entries())) {
        if (present.has(coord)) continue;
        // Branches are ONEST Physical store channels, so a named branch only
        // projects onto ONEST coordinates. The (no branch) bucket takes every
        // company, which is where SV Retail legitimately sits.
        if (want !== null && t.bu !== "ONEST") continue;
        additions.push({
          ...t,
          key: makeRowKey({ ...t, branch: want }),
          branch: want,
          proposed: Array.from({ length: 12 }, () => 0),
        });
      }
      return additions.length ? prev.concat(additions) : prev;
    });
  }, [branch, hasBranchDept, data?.revision?.id]);

  const visible = useMemo(() => {
    const base = rows.filter(
      (r) => (!deptFilter || r.department === deptFilter) && (!buFilter || r.bu === buFilter),
    );
    if (!hasBranchDept || branch === ALL_BRANCHES) {
      if (branch !== ALL_BRANCHES || !hasBranchDept) return base;
      // ALL BRANCHES: sum the branch-split rows per coordinate, and leave every
      // other department exactly as it is. Read-only — see BranchBar.
      const summed = new Map<string, EditorRow>();
      const out: EditorRow[] = [];
      for (const r of base) {
        if (!isBranchSplit(r.department)) { out.push(r); continue; }
        const k = `${r.bu}|${r.department}|${r.cat_l1}|${r.cat_l2 ?? ""}`;
        const prev = summed.get(k);
        if (!prev) {
          summed.set(k, { ...r, key: k, branch: null, proposed: [...r.proposed] });
          continue;
        }
        for (let i = 0; i < prev.proposed.length; i++) prev.proposed[i] += r.proposed[i] ?? 0;
      }
      return out.concat(Array.from(summed.values()));
    }
    // One branch. Non-branch-split departments are hidden while a branch is
    // selected: they have no branch, so showing them under "Song Wat" would
    // say something untrue about them.
    const want = branchColumnValue(branch);
    return base.filter((r) =>
      isBranchSplit(r.department) ? (r.branch ?? null) === want : false,
    );
  }, [rows, deptFilter, buFilter, branch, hasBranchDept]);

  // Null, not 0, when no goal exists anywhere: a percentage of nothing is not
  // 0%, it is unanswerable.
  const goalFyTotal = useMemo(
    () =>
      revenue
        ? revenue.tree.months.reduce<number | null>((t, v) => (v === null ? t : (t ?? 0) + v), null)
        : null,
    [revenue],
  );

  const stats = useMemo(() => {
    const proposedTotal = rows.reduce((s, r) => s + sum(r.proposed), 0);
    const approvedTotal = rows.reduce((s, r) => s + sum(r.approved), 0);
    let changedFigures = 0;
    const changedSegments = new Set<string>();
    for (const r of rows) {
      for (let m = 0; m < 12; m++) {
        if (Math.round(r.proposed[m] ?? 0) !== Math.round(r.approved[m] ?? 0)) {
          changedFigures++;
          changedSegments.add(r.department);
        }
      }
    }
    return {
      proposedTotal,
      approvedTotal,
      delta: proposedTotal - approvedTotal,
      changedFigures,
      changedSegments: Array.from(changedSegments).sort(),
      totalFigures: rows.length * 12,
    };
  }, [rows]);

  const doTransition = useCallback(
    async (action: "submit") => {
      if (!data?.revision) return;
      setBusy(true);
      try {
        await flush(); // never submit figures that have not landed
        const res = await fetch(`/api/budget/${data.revision.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed");
        setConfirmSubmit(false);
        await load(ownerEmail);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setConfirmSubmit(false);
      } finally {
        setBusy(false);
      }
    },
    [data?.revision, flush, load, ownerEmail],
  );

  // --- empty / error states -------------------------------------------------
  // An admin is never sent down these branches: they hold no BO row of their
  // own, but that is not the same as having nothing to do here.
  // A CEO typically lands here from the nav and owns no budget themselves —
  // for them this page is a signpost to the queue, not a dead end.
  if (!isOwner && !isAdmin) {
    return (
      <div className="space-y-3">
        <PendingApprovalBanner count={pendingApprovals} />
        <div className="mm-card">
          <h1 className="mm-page-title">Budget</h1>
          <p className="mt-2 text-[13px] text-brand-muted">
            Only a budget owner can enter a budget
            {canReview ? ", but approving them is yours" : ""}.
          </p>
          <div className="mt-3">
            <BudgetNavLinks canReview={canReview} />
          </div>
          <ContactLine contacts={adminContacts} />
        </div>
      </div>
    );
  }
  if (!isAdmin && !hasScope) {
    return (
      <div className="mm-card">
        <h1 className="mm-page-title">My budget · FY{fiscalYear}</h1>
        <p className="mt-2 text-[13px] text-brand-muted">
          You hold no budget scope yet, so there is nothing to budget. Scope is a BO row on your
          account naming a segment and a category — set in Settings &gt; User Management, which
          only an admin can reach. Once it is set, your lines appear here.
        </p>
        <ContactLine contacts={adminContacts} />
        <div className="mt-3">
          <BudgetNavLinks canReview={canReview} />
        </div>
      </div>
    );
  }

  const status = data?.revision?.status ?? "DRAFT";
  const pill = STATUS_PILL[status] ?? STATUS_PILL.DRAFT;
  // Never editable on the roll-up: a figure typed into a sum has no single
  // branch to be written to.
  const editable = !!data?.revision && status === "DRAFT"
    && !(hasBranchDept && branch === ALL_BRANCHES);
  const title = !ownerEmail
    ? `Budget · FY${fiscalYear}`
    : onBehalf
      ? `Editing ${shortName(ownerEmail)}'s budget · FY${fiscalYear}`
      : `My budget · FY${fiscalYear}`;

  return (
    <div className="space-y-3">
      <PendingApprovalBanner count={pendingApprovals} />

      {notice && (
        <div
          className="rounded-[10px] px-4 py-2 text-[13px]"
          style={{ background: "#F0F4EF", border: "1px solid #9CAE8C", color: "#1F3A2B" }}
        >
          {notice}
        </div>
      )}

      {/* Replaces the old "last updated · entered manually until the sheet
          sync exists" line. That read actual_synced_at, i.e. when a CELL last
          changed — which cannot tell a broken sync from a quiet day, because
          a refused sync writes no cells at all. This reads the run log. */}
      <RevenueSyncBar
        fiscalYear={fiscalYear}
        canSync={!!revenue?.canEdit}
        onSynced={loadRevenue}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-start gap-5">
          <YearSelect value={fiscalYear} options={yearOptions(currentYear)} onChange={onYearChange} busy={busy} />
          <div>
            <h1 className="mm-page-title">{title}</h1>
            <p className="mm-page-subtitle">
              {ownerEmail || "no owner selected"}
              {data?.revision ? ` · revision ${data.revision.revision_no}` : ""}
              {data ? ` · ${data.scope.lineCount} lines across ${data.scope.departments.length} segment${data.scope.departments.length === 1 ? "" : "s"}` : ""}
            </p>
            <div className="mt-1">
              <BudgetNavLinks canReview={canReview} />
            </div>
          </div>
        </div>
        {/* No owner chosen yet means nothing to save or submit — an admin
            should not see live-looking controls over an empty page.
            Conditional render, NOT the hidden attribute: Tailwind's `.flex`
            sets display:flex at the same specificity as preflight's
            [hidden]{display:none} and, coming later in the sheet, wins — so
            `hidden` here did nothing and the controls showed anyway. */}
        {ownerEmail && (
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{ background: pill.bg, color: pill.fg }}
          >
            {pill.label}
          </span>
          <SaveIndicator state={save} />
          <button
            className="mm-btn-secondary"
            onClick={() => void onRefreshLines()}
            disabled={!editable || busy}
            title="Pull in categories added in Settings since this draft was created. Adds lines only — never removes one and never changes a figure you have entered."
          >
            Refresh lines
          </button>
          <button className="mm-btn-secondary" onClick={() => void flush()} disabled={!editable || busy}>
            Save draft
          </button>
          <button
            className="mm-btn-primary"
            onClick={() => setConfirmSubmit(true)}
            disabled={!editable || busy || stats.changedFigures === 0}
            title={stats.changedFigures === 0 ? "Nothing has changed from the approved budget yet" : undefined}
          >
            Submit for CEO approval
          </button>
        </div>
        )}
      </div>

      {error && (
        <div
          className="rounded-[10px] px-4 py-3 text-sm"
          style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" }}
        >
          {error}
        </div>
      )}

      {isAdmin && (
        <div className="mm-card">
          <div className="mm-section-label">Acting as</div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="block">
              <span className="mm-label mb-1 block">Budget owner</span>
              <select
                className="mm-input w-[420px] max-w-full"
                value={selectedOwner}
                onChange={(e) => setSelectedOwner(e.target.value)}
              >
                <option value="">Select a budget owner…</option>
                {owners.map((o) => (
                  <option key={o.email} value={o.email}>
                    {o.email} — {o.summary}
                    {o.rowCount > 1 ? ` (${o.rowCount} scope rows)` : ""}
                  </option>
                ))}
              </select>
            </label>
            {ownerEmail ? (
              <p className="text-[12px] text-brand-muted">
                You are editing{" "}
                <strong className="text-brand-dark">
                  {onBehalf ? `${shortName(ownerEmail)}'s budget` : "your own budget"}
                </strong>
                . {owners.find((o) => o.email === ownerEmail)?.summary ?? ""}
              </p>
            ) : (
              <p className="text-[12px] text-brand-muted">
                {owners.length} budget owner{owners.length === 1 ? "" : "s"}. Nothing is loaded until
                you choose one.
              </p>
            )}
          </div>
        </div>
      )}

      {/* The prose explaining what acting-on-behalf means is gone (A3). The
          fact that it IS on behalf stays, as a chip — the header already says
          whose budget this is. */}
      {onBehalf && (
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{ background: "#FDF2EE", color: "#BD5A2E", border: "1px solid #F5C4A3" }}
          >
            on behalf of {ownerEmail}
          </span>
          <span className="text-[11px] text-brand-subtle">acting as {viewerEmail}</span>
        </div>
      )}

      {isAdmin && !ownerEmail && !loading && (
        <div className="mm-card">
          <p className="py-10 text-center text-[13px] text-brand-muted">
            Choose a budget owner above to open their draft.
          </p>
        </div>
      )}

      {data && (
        <>
          {/* The scope strip that stood here was removed: the table below
              already lists exactly the lines this owner holds, so it restated
              the grid's own content above it. The owner selector, the
              acting-on-behalf banner and the status pill all remain. */}
          <div className="mm-card">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <label className="block">
                <span className="mm-label mb-1 block">Segment (filter)</span>
                <select className="mm-input w-[240px]" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                  <option value="">
                  {onBehalf ? "All their segments" : "All my segments"} ({data.scope.departments.length})
                </option>
                  {data.scope.departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                {/* "Company", not "BU": this filters categories.bu, which is
                    matched against the owner's bo_scopes.company_scope — the
                    company an expense is CHARGED TO. It is not the person's
                    own people.bu, and for 5 of 10 owners the two differ. The
                    person-level Business unit field in Settings keeps its
                    name. See migration 039. */}
                <span className="mm-label mb-1 block">Company</span>
                <select className="mm-input w-[140px]" value={buFilter} onChange={(e) => setBuFilter(e.target.value)}>
                  {data.scope.bus.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
              {/* `rows` grows as branches are materialised, so "N of rows.length"
                  would drift to a meaningless denominator once a few branches
                  have been visited. With a branch selected the count is stated
                  on its own, with why the other departments are absent. */}
              <p className="text-[12px] text-brand-muted">
                {hasBranchDept && branch !== ALL_BRANCHES ? (
                  <>
                    {visible.length} line{visible.length === 1 ? "" : "s"} ·{" "}
                    {branch === NO_BRANCH ? "no branch" : branch}
                    <span className="text-brand-subtle">
                      {" "}— branch-split departments only; pick All branches for the rest
                    </span>
                  </>
                ) : (
                  <>{visible.length} of {rows.length} lines</>
                )}
              </p>
              <button
                type="button"
                className="mm-btn-secondary mm-btn-sm ml-auto"
                onClick={() => {
                  const next = !allCollapsed;
                  setAllCollapsed(next);
                  setCollapseSignal({ collapsed: next, nonce: Date.now() });
                }}
              >
                {allCollapsed ? "Expand all" : "Collapse all"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Approved (live)" value={thb(stats.approvedTotal)} foot="what the spend report reads now" accent="#1F3A2B" />
            <Stat label="This draft" value={thb(stats.proposedTotal)} foot={`${stats.changedFigures} of ${stats.totalFigures} figures changed`} accent="#BD5A2E" />
            <Stat
              label="Change"
              value={`${stats.delta >= 0 ? "+" : "−"}${thb(Math.abs(stats.delta))}`}
              foot={stats.approvedTotal > 0 ? `${((stats.delta / stats.approvedTotal) * 100).toFixed(1)}% vs approved` : "no approved budget yet"}
              accent={stats.delta > 0 ? "#B23A2F" : "#2E7D52"}
            />
            <Stat
              label="Of revenue goal"
              value={
                goalFyTotal && goalFyTotal > 0
                  ? `${((stats.proposedTotal / goalFyTotal) * 100).toFixed(1)}%`
                  : EM_DASH
              }
              foot={
                goalFyTotal && goalFyTotal > 0
                  ? `${thb(stats.proposedTotal)} of ${thb(goalFyTotal)}${buFilter ? ` · ${buFilter}` : ""}`
                  : "no revenue goal set for this year"
              }
              accent="#9CAE8C"
            />
          </div>


          {/* Two different reasons to be read-only, and the banner must give the
              right one. Making All branches read-only turned this into "this
              revision is draft and is read-only", which is both wrong and
              alarming — the revision is perfectly editable, just not through a
              sum. The roll-up explains itself in BranchBar, so no banner. */}
          {!editable && !(hasBranchDept && branch === ALL_BRANCHES && status === "DRAFT") && (
            <div
              className="rounded-[10px] px-4 py-3 text-[13px]"
              style={{ background: "#FEF3C7", border: "1px solid #FCD34D", color: "#92400E" }}
            >
              This revision is {pill.label.toLowerCase()} and is read-only. The approved budget stays
              live until a CEO acts on it.
            </div>
          )}

          {hasBranchDept && branches.length > 0 && (
            <div className="mb-3">
              <BranchBar
                branches={branches}
                selected={branch}
                onSelect={(next) => {
                  // Flush before switching, so an edit cannot be stranded on a
                  // branch that is no longer on screen. The dot warns; this
                  // makes the warning unnecessary in the common case.
                  void flush();
                  setBranch(next);
                }}
                dirtyBranches={dirtyBranches}
                branchesWithLines={branchesWithLines}
                fiscalYear={fiscalYear}
                busy={busy}
              />
            </div>
          )}
          <BudgetGrid
            rows={visible}
            onChange={editable ? onChange : null}
            onFillRight={onFillRight}
            onCopyPriorYear={onCopyPriorYear}
            onClearRow={onClearRow}
            priorFiscalYear={data.priorFiscalYear}
            fiscalYear={fiscalYear}
            categoryOrder={categoryOrder}
            onReorderCategories={onReorderCategories}
            // Per READER and per owner/year: which rows this person wants out
            // of the way is not a fact about the owner, so it stays in the
            // browser rather than the database. The order, which IS the
            // owner's, is on the server — see migration 041.
            collapseStorageKey={`mm:budget:collapse:${viewerEmail}:${ownerEmail}:${fiscalYear}`}
            collapseSignal={collapseSignal}
            revenue={
              revenue
                ? {
                    tree: revenue.tree,
                    editable: revenue.canEdit,
                    canAddChannel,
                    onActualChange: onRevenueActualChange,
                    onChange: onRevenueChange,
                    onAddChannel: () => setAddingChannel(true),
                    onToggleChannel,
                  }
                : null
            }
          />
        </>
      )}

      {loading && (
        <p className="text-sm text-brand-muted">
          Loading {onBehalf ? `${shortName(ownerEmail)}'s` : "your"} budget…
        </p>
      )}

      {addingChannel && (
        <AddChannelModal
          bus={revenue ? revenue.tree.children.map((b) => b.label) : []}
          tree={revenue?.tree ?? null}
          onClose={() => setAddingChannel(false)}
          onAdded={async () => {
            setAddingChannel(false);
            await loadRevenue();
          }}
          onError={setError}
        />
      )}

      {confirmSubmit && data?.revision && (
        <div className="mm-modal-overlay" style={{ backdropFilter: "blur(2px)" }} onClick={() => setConfirmSubmit(false)}>
          <div className="mm-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="mm-modal-header">
              <h2 className="mm-modal-title">Submit for CEO approval</h2>
            </div>
            <div className="mm-modal-body">
              {onBehalf && (
                <p
                  className="mb-3 rounded-[8px] px-3 py-2 text-[13px]"
                  style={{ background: "#FDF2EE", color: "#7C3A1A" }}
                >
                  This is <strong>{ownerEmail}&apos;s</strong> budget, submitted by you. You will not
                  be able to approve it afterwards.
                </p>
              )}
              <p className="text-[13px] text-brand-dark">
                You are submitting <strong>{stats.changedFigures}</strong> changed figure
                {stats.changedFigures === 1 ? "" : "s"} across{" "}
                <strong>{stats.changedSegments.length}</strong> segment
                {stats.changedSegments.length === 1 ? "" : "s"}
                {stats.changedSegments.length > 0 ? ` (${stats.changedSegments.join(", ")})` : ""}.
              </p>
              <p className="mt-2 text-[13px] text-brand-muted">
                FY total moves from {thb(stats.approvedTotal)} to {thb(stats.proposedTotal)} — a change
                of {stats.delta >= 0 ? "+" : "−"}
                {thb(Math.abs(stats.delta))}. The approved budget stays live until a CEO approves;
                the spend report will not move before then.
              </p>
            </div>
            <div className="mm-modal-footer">
              <button className="mm-btn-secondary" onClick={() => setConfirmSubmit(false)} disabled={busy}>
                Cancel
              </button>
              <button className="mm-btn-primary" onClick={() => void doTransition("submit")} disabled={busy}>
                {busy ? "Submitting…" : "Submit for approval"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A reader who cannot act on an empty state needs to know who can. The admins
 * are read live from the roles table rather than hardcoded.
 */
function ContactLine({ contacts }: { contacts: string[] }) {
  if (contacts.length === 0) return null;
  return (
    <p className="mt-3 text-[13px] text-brand-muted">
      To get budget scope assigned, contact{" "}
      {contacts.map((c, i) => (
        <span key={c}>
          {i > 0 ? (i === contacts.length - 1 ? " or " : ", ") : ""}
          <a href={`mailto:${c}`} className="text-brand-brown underline hover:text-brand-accent">
            {c}
          </a>
        </span>
      ))}
      .
    </p>
  );
}

function Stat({ label, value, foot, accent }: { label: string; value: string; foot: string; accent: string }) {
  return (
    <div className="mm-card" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-[11px] uppercase tracking-[0.05em] text-brand-subtle">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tabular-nums text-brand-dark">{value}</div>
      <div className="mt-1 text-[13px] text-brand-muted">{foot}</div>
    </div>
  );
}

/** Honest save state — "Saved" only ever appears after the write returned. */
function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState["kind"], { text: string; color: string }> = {
    idle: { text: "", color: "" },
    dirty: { text: "Unsaved changes", color: "#92400E" },
    saving: { text: "Saving…", color: "#6B7280" },
    saved: { text: "", color: "#2E7D52" },
    error: { text: "", color: "#DC2626" },
  };
  if (state.kind === "idle") return null;
  if (state.kind === "saved") {
    const t = new Date(state.savedAt);
    return (
      <span className="text-[12px]" style={{ color: "#2E7D52" }}>
        Saved {t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <span className="text-[12px]" style={{ color: "#DC2626" }} title={state.message}>
        Not saved — {state.message.slice(0, 60)}
      </span>
    );
  }
  return <span className="text-[12px]" style={{ color: map[state.kind].color }}>{map[state.kind].text}</span>;
}

/**
 * Adds a channel, and with it its category and sub-category if those are new —
 * which is what makes every level addable without a deployment. The three
 * upper fields are free text with a datalist of what already exists, so
 * picking an existing category and inventing a new one are the same gesture.
 */
function AddChannelModal({
  bus,
  tree,
  onClose,
  onAdded,
  onError,
}: {
  bus: string[];
  tree: RevenueNode | null;
  onClose: () => void;
  onAdded: () => void;
  onError: (m: string) => void;
}) {
  const [bu, setBu] = useState(bus[0] ?? "ONEST");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);

  const buNode = tree?.children.find((b) => b.label === bu) ?? null;
  const categories = buNode ? buNode.children.map((c) => c.label) : [];
  const subs =
    buNode?.children.find((c) => c.label === category)?.children.map((sc) => sc.label) ?? [];

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/revenue/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bu, category, sub_category: subCategory, channel }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Could not add the channel");
      onAdded();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = bu.trim() && category.trim() && subCategory.trim() && channel.trim();

  return (
    <div className="mm-modal-overlay" style={{ backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="mm-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="mm-modal-header">
          <h2 className="mm-modal-title">Add a revenue channel</h2>
        </div>
        <div className="mm-modal-body space-y-3">
          <label className="block">
            <span className="mm-label mb-1 block">Business unit</span>
            <select className="mm-input w-full" value={bu} onChange={(e) => setBu(e.target.value)}>
              {(bus.length ? bus : ["ONEST", "SV"]).map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mm-label mb-1 block">Category</span>
            <input
              className="mm-input w-full"
              list="rev-cats"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Physical store"
            />
            <datalist id="rev-cats">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="block">
            <span className="mm-label mb-1 block">Sub-category</span>
            <input
              className="mm-input w-full"
              list="rev-subs"
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              placeholder="Modern Trade"
            />
            <datalist id="rev-subs">
              {subs.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="block">
            <span className="mm-label mb-1 block">Channel</span>
            <input
              className="mm-input w-full"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="Store or platform name"
            />
          </label>
        </div>
        <div className="mm-modal-footer">
          <button className="mm-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="mm-btn-primary" onClick={() => void submit()} disabled={busy || !ready}>
            {busy ? "Adding…" : "Add channel"}
          </button>
        </div>
      </div>
    </div>
  );
}
