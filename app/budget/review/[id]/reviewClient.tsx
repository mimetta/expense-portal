"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BudgetGrid from "@/components/budget/BudgetGrid";
import { thb, EM_DASH } from "@/components/spend/format";
import type { EditorData } from "@/lib/budget-editor";

interface Props {
  data: EditorData;
  viewerEmail: string;
  canAct: boolean;
  /** SUPERADMIN: may approve their own submission, with a warning. */
  canSelfApprove: boolean;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export default function ReviewClient({ data, viewerEmail, canAct, canSelfApprove }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  const rev = data.revision!;
  const isOwnSubmission = !!rev.submitted_by && rev.submitted_by === viewerEmail;
  // Two different situations, deliberately shown differently:
  //  - BO/CEO reviewing their own submission: refused in lib/budget-revisions
  //    and by the no_unmarked_self_approval constraint. Blocked, button off,
  //    because a 23514 toast is not an explanation.
  //  - SUPERADMIN: permitted since migration 030, but it means nobody else
  //    looked at it, so it gets a warning rather than silence.
  const blockedSelfApproval = isOwnSubmission && !canSelfApprove;
  const warnSelfApproval = isOwnSubmission && canSelfApprove;
  const actionable = canAct && rev.status === "SUBMITTED";

  const stats = useMemo(() => {
    const proposed = data.rows.reduce((s, r) => s + sum(r.proposed), 0);
    const approved = data.rows.reduce((s, r) => s + sum(r.approved), 0);
    let changed = 0;
    for (const r of data.rows) {
      for (let m = 0; m < 12; m++) {
        if (Math.round(r.proposed[m] ?? 0) !== Math.round(r.approved[m] ?? 0)) changed++;
      }
    }
    return { proposed, approved, delta: proposed - approved, changed };
  }, [data.rows]);

  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/budget/${rev.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: action === "reject" ? note : undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      router.push("/budget/history");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setRejecting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mm-page-title">Budget revision · {rev.owner_email}</h1>
          <p className="mm-page-subtitle">
            FY{rev.fiscal_year} · revision {rev.revision_no} · {data.rows.length} lines across{" "}
            {data.scope.departments.length} department
            {data.scope.departments.length === 1 ? "" : "s"}
          </p>
        </div>
        {actionable && (
          <div className="flex items-center gap-2">
            <button className="mm-btn-secondary" onClick={() => setRejecting(true)} disabled={busy}>
              Request changes
            </button>
            <button
              className="mm-btn-primary"
              onClick={() => void act("approve")}
              disabled={busy || blockedSelfApproval}
              title={blockedSelfApproval ? "You submitted this revision" : undefined}
            >
              {busy ? "Approving…" : warnSelfApproval ? "Approve own submission" : "Approve revision"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-[10px] px-4 py-3 text-sm" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626" }}>
          {error}
        </div>
      )}

      {blockedSelfApproval && rev.status === "SUBMITTED" && (
        <div className="rounded-[10px] px-4 py-3 text-[13px]" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}>
          <strong>You cannot approve a revision you submitted.</strong> Approve is disabled and
          another CEO must act on it. This applies when one person holds both BO and CEO, and it is
          enforced in the database as well as here — a direct write would be refused by the
          <code className="mx-1">no_unmarked_self_approval</code> constraint.
        </div>
      )}

      {warnSelfApproval && rev.status === "SUBMITTED" && (
        <div className="rounded-[10px] px-4 py-3 text-[13px]" style={{ background: "#FEF3C7", border: "1px solid #FCD34D", color: "#92400E" }}>
          <strong>You are approving your own submission — no second review.</strong> Admins are
          allowed to, but nobody else has looked at these figures, and approving publishes them to
          the spend report immediately. It will be recorded as{" "}
          <strong>self-approved by {viewerEmail}</strong> and shown that way in budget history.
        </div>
      )}

      {/* The partial-view banner. Approving publishes only this owner's lines;
          the rest of each segment belongs to other owners' revisions. */}
      <div className="rounded-[10px] px-4 py-3 text-[13px]" style={{ background: "#DBEAFE", borderLeft: "4px solid #3B82F6", color: "#1E3A8A" }}>
        Submitted by <strong>{rev.submitted_by ?? rev.owner_email}</strong>
        {rev.submitted_by && rev.submitted_by !== rev.owner_email ? (
          <> on behalf of <strong>{rev.owner_email}</strong></>
        ) : null}
        {rev.submitted_at ? ` on ${new Date(rev.submitted_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}.{" "}
        <strong>This is a partial view of each segment</strong> — it covers this owner&apos;s lines
        only. Approving publishes these {data.rows.length} lines and nothing else.
        {data.coOwners.length > 0 && (
          <>
            {" "}The rest of {data.coOwners.length === 1 ? "that segment belongs" : "those segments belong"} to{" "}
            {data.coOwners.map((c, i) => (
              <span key={c.email}>
                {i > 0 ? ", " : ""}
                <strong>{c.email}</strong> ({c.departments.join(", ")})
              </span>
            ))}
            .
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Currently approved" value={thb(stats.approved)} foot="live in the spend report" accent="#1F3A2B" />
        <Stat label="Proposed" value={thb(stats.proposed)} foot={`${stats.changed} figures changed`} accent="#BD5A2E" />
        <Stat
          label="Change"
          value={stats.delta === 0 ? EM_DASH : `${stats.delta > 0 ? "+" : "−"}${thb(Math.abs(stats.delta))}`}
          foot={stats.approved > 0 ? `${((stats.delta / stats.approved) * 100).toFixed(1)}% vs approved` : "no approved budget yet"}
          accent={stats.delta > 0 ? "#B23A2F" : "#2E7D52"}
        />
        <Stat
          label="Other owners here"
          value={String(data.coOwners.length)}
          foot={data.coOwners.length ? "hold lines in these same segments" : "this owner holds these segments alone"}
          accent="#9CAE8C"
        />
      </div>

      <p className="text-[11px] text-brand-subtle">
        Changed figures are highlighted with the difference beneath. Unchanged months are shown for
        context.
      </p>

      <BudgetGrid rows={data.rows} onChange={null} showDelta priorFiscalYear={data.priorFiscalYear} />

      <p className="text-[12px]">
        <Link href="/budget/history" className="text-brand-brown underline">
          ← Back to budget history
        </Link>
      </p>

      {rejecting && (
        <div className="mm-modal-overlay" style={{ backdropFilter: "blur(2px)" }} onClick={() => setRejecting(false)}>
          <div className="mm-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="mm-modal-header">
              <h2 className="mm-modal-title">Request changes</h2>
            </div>
            <div className="mm-modal-body">
              <label className="mm-label mb-1 block">
                Note to {rev.owner_email} <span style={{ color: "#DC2626" }}>*</span>
              </label>
              <textarea
                className="mm-input w-full"
                style={{ minHeight: 90 }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What needs to change, and why?"
              />
              <p className="mt-2 text-[12px] text-brand-muted">
                The revision returns to draft with the figures intact, so the owner amends rather
                than retypes. A note is required — it is what they amend against.
              </p>
            </div>
            <div className="mm-modal-footer">
              <button className="mm-btn-secondary" onClick={() => setRejecting(false)} disabled={busy}>
                Cancel
              </button>
              <button className="mm-btn-danger" onClick={() => void act("reject")} disabled={busy || !note.trim()}>
                {busy ? "Sending…" : "Request changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
