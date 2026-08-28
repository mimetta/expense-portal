"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BudgetGrid from "@/components/budget/BudgetGrid";
import { thb } from "@/components/spend/format";
import type { BudgetOwnerOption, EditorData, EditorRow } from "@/lib/budget-editor";

interface Props {
  fiscalYear: number;
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

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const shortName = (email: string) => email.replace("@mimetta.co", "");

export default function BudgetEditorClient({
  fiscalYear,
  viewerEmail,
  isOwner,
  hasScope,
  isAdmin,
  owners,
  adminContacts,
  canReview,
  pendingApprovals,
}: Props) {
  const [data, setData] = useState<EditorData | null>(null);
  const [rows, setRows] = useState<EditorRow[]>([]);
  // Only "loading" if something is actually going to load — an admin who has
  // not chosen an owner yet is idle, not waiting.
  const [loading, setLoading] = useState(() => (isAdmin ? hasScope : isOwner && hasScope));
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [buFilter, setBuFilter] = useState<string>("");
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  // SUPERADMIN only. Defaults to themselves if they happen to hold BO scope,
  // otherwise nothing is loaded until an owner is chosen — an admin should
  // never arrive at a populated grid without having said whose it is.
  const [selectedOwner, setSelectedOwner] = useState(() => (isAdmin && hasScope ? viewerEmail : ""));

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
  const visible = useMemo(
    () =>
      rows.filter(
        (r) => (!deptFilter || r.department === deptFilter) && (!buFilter || r.bu === buFilter),
      ),
    [rows, deptFilter, buFilter],
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
  const editable = !!data?.revision && status === "DRAFT";
  const title = !ownerEmail
    ? `Budget · FY${fiscalYear}`
    : onBehalf
      ? `Editing ${shortName(ownerEmail)}'s budget · FY${fiscalYear}`
      : `My budget · FY${fiscalYear}`;

  return (
    <div className="space-y-3">
      <PendingApprovalBanner count={pendingApprovals} />

      <div className="flex flex-wrap items-start justify-between gap-3">
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
        {/* No owner chosen yet means nothing to save or submit — an admin
            should not see live-looking controls over an empty page. */}
        <div className="flex items-center gap-2" hidden={!ownerEmail}>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{ background: pill.bg, color: pill.fg }}
          >
            {pill.label}
          </span>
          <SaveIndicator state={save} />
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

      {onBehalf && (
        <div
          className="rounded-[10px] px-4 py-3 text-[13px]"
          style={{ background: "#FDF2EE", borderLeft: "4px solid #BD5A2E", color: "#7C3A1A" }}
        >
          <strong>
            You are acting on behalf of {ownerEmail}, not editing your own budget.
          </strong>{" "}
          Anything you save or submit here is recorded against them as the owner and against{" "}
          <strong>{viewerEmail}</strong> as the person who did it — budget history shows both. You
          may save and submit; you may <strong>not</strong> then approve what you submitted.
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
          {/* Scope strip — the mockup's point: a BO must see at a glance that
              they hold ONE cat_l1 across several segments, not several whole
              segments. */}
          <div className="mm-card">
            <div className="mm-section-label">
              {onBehalf ? `${shortName(ownerEmail)}'s scope` : "Your scope"}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {data.scope.catL1s.map((c) => (
                <span
                  key={c}
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: "#FDF2EE", color: "#BD5A2E", border: "1px solid #F5C4A3" }}
                >
                  {c}
                </span>
              ))}
              <span className="mx-1 text-[12px] text-brand-subtle">across</span>
              {data.scope.departments.map((d) => (
                <span
                  key={d}
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{ background: "#F0F4EF", color: "#1F3A2B", border: "1px solid #9CAE8C" }}
                >
                  {d}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-brand-muted">
              This revision covers only the lines {onBehalf ? `${shortName(ownerEmail)} owns` : "you own"} — one
              revision spans several segments. Other budget owners raise their own revisions for the
              rest of those segments.
            </p>
          </div>

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
                <span className="mm-label mb-1 block">BU (filter)</span>
                <select className="mm-input w-[140px]" value={buFilter} onChange={(e) => setBuFilter(e.target.value)}>
                  <option value="">Both BUs</option>
                  {data.scope.bus.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
              <p className="text-[12px] text-brand-muted">
                Showing {visible.length} of {rows.length} lines in{" "}
                {onBehalf ? `${shortName(ownerEmail)}'s` : "your"} scope. These are filters over this
                owner&apos;s lines — never a way to reach another owner&apos;s.
              </p>
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
            <Stat label="Segments touched" value={String(stats.changedSegments.length)} foot={stats.changedSegments.join(", ") || "none yet"} accent="#9CAE8C" />
          </div>

          <p className="text-[11px] text-brand-subtle">
            Paste 12 values from Sheets into any row · <strong>→</strong> fills the rest of the year ·
            <strong> ↑↓←→</strong> moves between cells · <strong>C</strong> copies the FY
            {data.priorFiscalYear} actual into a row · changed cells are highlighted against the
            approved figure.
          </p>

          {!editable && (
            <div
              className="rounded-[10px] px-4 py-3 text-[13px]"
              style={{ background: "#FEF3C7", border: "1px solid #FCD34D", color: "#92400E" }}
            >
              This revision is {pill.label.toLowerCase()} and is read-only. The approved budget stays
              live until a CEO acts on it.
            </div>
          )}

          <BudgetGrid
            rows={visible}
            onChange={editable ? onChange : null}
            onFillRight={onFillRight}
            onCopyPriorYear={onCopyPriorYear}
            onClearRow={onClearRow}
            priorFiscalYear={data.priorFiscalYear}
          />
        </>
      )}

      {loading && (
        <p className="text-sm text-brand-muted">
          Loading {onBehalf ? `${shortName(ownerEmail)}'s` : "your"} budget…
        </p>
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
