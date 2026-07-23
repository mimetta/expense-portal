"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import { formatCurrency, formatDate } from "@/lib/format";
import { hasRole, isSuperadmin } from "@/lib/permissions";
import { isCeoActionable, isEditRequestPending } from "@/lib/status";
import type { CurrentUser, ExpenseRequest } from "@/types/database";

type Tab = "pending" | "needs-signature" | "edit-requests" | "all";
const RELEVANT_STATUSES = ["SUBMITTED", "PO_UPLOADED", "BO_APPROVED", "CEO_APPROVED"] as const;

export default function CeoApprovalsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [editRequestCount, setEditRequestCount] = useState(0);

  const load = () => {
    setLoading(true);
    fetch(`/api/requests?scope=ceo&tab=${tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  useEffect(() => {
    fetch("/api/requests?scope=ceo&tab=edit-requests")
      .then((res) => res.json())
      .then((data) => setEditRequestCount((data.requests ?? []).length));
  }, [tab]);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser(data.user as CurrentUser);
      });
  }, []);

  // Any CEO can unapprove any CEO_APPROVED request now, not just the one
  // who approved it — matches the server-side check in
  // ceo-unapprove/route.ts (the actual enforcement; this is UX only).
  const canUnapprove = () => !!currentUser && (isSuperadmin(currentUser) || hasRole(currentUser, "CEO"));

  const approve = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/ceo-approve`, { method: "PATCH" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to approve");
      }
      setSelected(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    const reason = prompt("Rejection reason?");
    if (!reason) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to reject");
      }
      setSelected(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setBusy(null);
    }
  };

  const unapprove = async (id: string) => {
    if (!confirm("Unapprove this request? It will go back to awaiting CEO approval.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/ceo-unapprove`, { method: "PATCH" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to unapprove");
      }
      setSelected(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unapprove");
    } finally {
      setBusy(null);
    }
  };

  const actOnEditRequest = async (id: string, allow: boolean) => {
    if (!allow && !confirm("Reject this edit request? The requester will be notified.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/approve-edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to act on edit request");
      }
      setSelected(null);
      load();
      setEditRequestCount((c) => Math.max(0, c - 1));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to act on edit request");
    } finally {
      setBusy(null);
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "needs-signature", label: "Needs Signature" },
    { key: "edit-requests", label: `Edit Requests (${editRequestCount})` },
    { key: "all", label: "All" },
  ];

  return (
    <div>
      <h1 className="mm-page-title mb-4">CEO Approvals</h1>
      <div className="mm-tabs mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`mm-tab ${tab === t.key ? "mm-tab-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FilterBar requests={requests} onFilteredChange={setFiltered} statuses={RELEVANT_STATUSES} />

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-brand-muted">Nothing here.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div
              key={r.request_id}
              onClick={() => setSelected(r)}
              className="mm-card cursor-pointer hover:bg-[#FAFAF7]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-brand-muted">{r.request_id}</span>
                  <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs text-brand-dark">
                    {r.use_for_company || "—"}
                  </span>
                  {r.skip_bo && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Skip BO
                    </span>
                  )}
                  {r.ceo_signature_required && (
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-800">
                      Needs Signature
                    </span>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2 text-sm text-brand-dark">
                {r.requester_name} — {r.department} — {r.expense_type}
              </div>
              <div className="mt-1 text-sm font-medium text-brand-dark">{formatCurrency(r.total)}</div>
              <div className="mt-1 text-xs text-brand-muted">
                {r.bo_approved_at ? `BO approved ${formatDate(r.bo_approved_at)} by ${r.bo_approver}` : "No BO approval (skipped or not required)"}
              </div>
              {r.status === "CEO_APPROVED" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-brand-muted">
                  <span>Approved by {r.ceo_approver ?? "-"} at {formatDate(r.ceo_approved_at)}</span>
                  {canUnapprove() && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        unapprove(r.request_id);
                      }}
                      disabled={busy === r.request_id}
                      className="font-medium text-[#DC2626] hover:underline disabled:opacity-50"
                    >
                      Unapprove
                    </button>
                  )}
                </div>
              )}
              {tab === "edit-requests" && isEditRequestPending(r) && (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  <p className="font-medium">Edit requested by {r.requester_name}</p>
                  <p>Reason: {r.edit_requested_reason ?? "-"}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        actOnEditRequest(r.request_id, true);
                      }}
                      disabled={busy === r.request_id}
                      className="mm-btn-primary mm-btn-sm"
                    >
                      Allow Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        actOnEditRequest(r.request_id, false);
                      }}
                      disabled={busy === r.request_id}
                      className="mm-btn-danger mm-btn-sm"
                    >
                      Reject Edit Request
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selected && (
        <RequestDetailModal
          request={selected}
          onClose={() => setSelected(null)}
          actions={
            selected.status === "CEO_APPROVED" && isEditRequestPending(selected) ? (
              <>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => actOnEditRequest(selected.request_id, true)}
                  className="mm-btn-primary"
                >
                  Allow Edit
                </button>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => actOnEditRequest(selected.request_id, false)}
                  className="mm-btn-danger"
                >
                  Reject Edit Request
                </button>
              </>
            ) : isCeoActionable(selected) ? (
              <>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => approve(selected.request_id)}
                  className="mm-btn-primary"
                >
                  Approve
                </button>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => reject(selected.request_id)}
                  className="mm-btn-danger"
                >
                  Reject
                </button>
              </>
            ) : selected.status === "CEO_APPROVED" && canUnapprove() ? (
              <button
                disabled={busy === selected.request_id}
                onClick={() => unapprove(selected.request_id)}
                className="mm-btn-danger"
              >
                Unapprove
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
