"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { thb, EM_DASH } from "@/components/spend/format";
import type { HistoryRow } from "@/lib/budget-editor";

interface Props {
  rows: HistoryRow[];
  owners: string[];
  viewerEmail: string;
  /** ACCOUNTING gets the list and the export, but not the cell grid. */
  canOpenDetail: boolean;
  /** CEO/SUPERADMIN: float what is waiting on them to the top. */
  canApprove: boolean;
}

const PILL: Record<string, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: "#F3F4F6", fg: "#374151", label: "Draft" },
  SUBMITTED: { bg: "#FEF3C7", fg: "#92400E", label: "Awaiting CEO" },
  APPROVED: { bg: "#1F3A2B", fg: "#FFFFFF", label: "Live" },
  REJECTED: { bg: "#FEF2F2", fg: "#DC2626", label: "Rejected" },
  SUPERSEDED: { bg: "#F4F1EC", fg: "#6B6B60", label: "Superseded" },
};

const when = (r: HistoryRow) =>
  r.approved_at ?? r.rejected_at ?? r.submitted_at ?? r.updated_at ?? r.created_at;

function describe(r: HistoryRow): string {
  const where = r.departments.length
    ? `${r.line_count} line${r.line_count === 1 ? "" : "s"} across ${r.departments.length} department${r.departments.length === 1 ? "" : "s"}`
    : "no lines";
  switch (r.status) {
    case "APPROVED":
      return r.self_approved
        ? `Revision ${r.revision_no} self-approved by ${r.approved_by ?? "—"} — ${where}`
        : `Revision ${r.revision_no} approved by ${r.approved_by ?? "—"} — ${where}`;
    case "SUBMITTED":
      return `Revision ${r.revision_no} submitted — ${where}`;
    case "SUPERSEDED":
      return `Revision ${r.revision_no} superseded — ${where}`;
    case "REJECTED":
      return `Revision ${r.revision_no} rejected${r.note ? ` — "${r.note}"` : ""}`;
    default:
      return r.rejected_at && r.note
        ? `Revision ${r.revision_no} returned to draft — "${r.note}"`
        : `Revision ${r.revision_no} in draft — ${where}`;
  }
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function HistoryClient({
  rows,
  owners,
  viewerEmail,
  canOpenDetail,
  canApprove,
}: Props) {
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");

  const pendingCount = useMemo(() => rows.filter((r) => r.status === "SUBMITTED").length, [rows]);

  const visible = useMemo(
    () =>
      rows
        .filter((r) => (!owner || r.owner_email === owner) && (!status || r.status === status))
        // For an approver this page IS the approval queue — there is no
        // /budget-approvals the way there is /ceo-approvals for requests — so
        // what is waiting on them sorts first, then recency within each block.
        .sort(
          (a, b) =>
            (canApprove ? Number(b.status === "SUBMITTED") - Number(a.status === "SUBMITTED") : 0) ||
            String(when(b)).localeCompare(String(when(a))),
        ),
    [rows, owner, status, canApprove],
  );

  const exportCsv = () => {
    const header = [
      "when", "owner", "fiscal_year", "revision_no", "status", "departments",
      "lines", "fy_total", "created_by", "submitted_by", "submitted_at",
      "approved_by", "approved_at", "self_approved", "rejected_by", "rejected_at", "note",
    ];
    const body = visible.map((r) => [
      when(r) ?? "", r.owner_email, r.fiscal_year, r.revision_no, r.status,
      r.departments.join(" | "), r.line_count, Math.round(r.fy_total),
      r.created_by, r.submitted_by ?? "", r.submitted_at ?? "",
      r.approved_by ?? "", r.approved_at ?? "", r.self_approved ? "yes" : "no",
      r.rejected_by ?? "", r.rejected_at ?? "", r.note ?? "",
    ]);
    const csv = [header, ...body].map((l) => l.map(csvCell).join(",")).join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-audit-trail_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mm-page-title">Budget history</h1>
          <p className="mm-page-subtitle">
            Every revision by every owner, with who submitted and who approved
          </p>
        </div>
        <button className="mm-btn-secondary" onClick={exportCsv} disabled={visible.length === 0}>
          Export audit trail
        </button>
      </div>

      {canApprove && pendingCount > 0 && (
        <div
          className="rounded-[10px] px-4 py-3 text-[13px]"
          style={{ background: "#FEF3C7", border: "1px solid #FCD34D", color: "#92400E" }}
        >
          <strong>
            {pendingCount} budget revision{pendingCount === 1 ? "" : "s"} waiting for your approval
          </strong>{" "}
          — listed first below. There is no separate approvals page for budget; this is the queue.
        </div>
      )}

      <div className="mm-card">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="block">
            <span className="mm-label mb-1 block">Owner</span>
            <select className="mm-input w-[240px]" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mm-label mb-1 block">Status</span>
            <select className="mm-input w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.keys(PILL).map((s) => (
                <option key={s} value={s}>{PILL[s].label}</option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-brand-muted">{visible.length} revision{visible.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mm-card">
          <p className="py-10 text-center text-[13px] text-brand-muted">
            No budget revisions yet. A budget owner creates one from{" "}
            <Link href="/budget" className="text-brand-brown underline">My budget</Link>.
          </p>
        </div>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead>
              <tr>
                <th className="text-left">When</th>
                <th className="text-left">Owner</th>
                <th className="text-left">What changed</th>
                <th className="text-left">Status</th>
                <th className="text-right">FY total</th>
                <th className="text-right"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const pill = PILL[r.status] ?? PILL.DRAFT;
                const w = when(r);
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-[13px] text-brand-muted">
                      {w ? new Date(w).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : EM_DASH}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[13px] text-brand-dark">
                      {r.owner_email.replace("@mimetta.co", "")}
                      {r.owner_email === viewerEmail && (
                        <span className="ml-1 text-[11px] text-brand-subtle">(you)</span>
                      )}
                    </td>
                    <td className="max-w-[460px] px-3 py-2 text-[13px] text-brand-muted">
                      {describe(r)}
                      {/* An admin may raise a revision for an owner. The owner
                          column shows whose budget it is; this says who acted. */}
                      {r.created_by && r.created_by !== r.owner_email && (
                        <div className="mt-0.5 text-[12px] text-brand-subtle">
                          Created by {r.created_by} on behalf of {r.owner_email}
                          {r.submitted_by && r.submitted_by !== r.owner_email
                            ? `, submitted by ${r.submitted_by}`
                            : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: pill.bg, color: pill.fg }}>
                          {pill.label}
                        </span>
                        {/* A self-approval had no second reviewer. It must not
                            read as an ordinary approval at a glance. */}
                        {r.self_approved && (
                          <span
                            title={`Submitted and approved by ${r.approved_by} — no second review`}
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D" }}
                          >
                            ⚠ Self-approved
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-brand-dark">{thb(r.fy_total)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {canOpenDetail ? (
                        <Link href={`/budget/review/${r.id}`} className="text-[13px] text-brand-brown underline hover:text-brand-accent">
                          {r.status === "SUBMITTED" ? "Review" : "View"}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-brand-subtle" title="Cell-level figures are visible to the owner and CEO only">
                          summary only
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-brand-subtle">
        Every approved revision is retained. The spend report resolves each budget cell to the most
        recently approved revision containing that cell — so a segment&apos;s budget is assembled
        from several owners&apos; revisions, each approved at a different time.
      </p>
    </div>
  );
}
