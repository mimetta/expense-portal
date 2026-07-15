"use client";

import { useEffect, useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import { BUSINESS_UNITS } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import { canBoActOnRequest, hasRole, isSuperadmin } from "@/lib/permissions";
import { isEditRequestPending } from "@/lib/status";
import type { CurrentUser, ExpenseRequest } from "@/types/database";

type Tab = "pending" | "edit-requests" | "all" | "pettycash";
const RELEVANT_STATUSES = ["SUBMITTED", "PO_UPLOADED", "BO_APPROVED"] as const;

export default function BoApprovalsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [buFilter, setBuFilter] = useState<string>("ALL");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [editRequestCount, setEditRequestCount] = useState(0);

  const isBoRole = !!currentUser && (isSuperadmin(currentUser) || hasRole(currentUser, "BO"));
  const isPettyCashRole = !!currentUser && (isSuperadmin(currentUser) || hasRole(currentUser, "PETTY_CASH_CUSTODIAN"));

  const load = () => {
    setLoading(true);
    const scope = tab === "pettycash" ? "pettycash" : "bo";
    fetch(`/api/requests?scope=${scope}&tab=${tab === "pettycash" ? "pending" : tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  // Only fetch once we know which role(s) the user actually holds — a pure
  // PETTY_CASH_CUSTODIAN (no BO role) would 403 on scope=bo, so this waits
  // for currentUser to resolve rather than firing on mount.
  useEffect(() => {
    if (currentUser) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currentUser]);

  // Badge count is independent of which tab is currently selected.
  useEffect(() => {
    if (!currentUser || !isBoRole) return;
    fetch("/api/requests?scope=bo&tab=edit-requests")
      .then((res) => res.json())
      .then((data) => setEditRequestCount((data.requests ?? []).length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currentUser]);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          const user = data.user as CurrentUser;
          setCurrentUser(user);
          // A pure PETTY_CASH_CUSTODIAN (no BO role) should land on their
          // own tab by default rather than immediately 403ing on "Pending".
          const hasBo = isSuperadmin(user) || hasRole(user, "BO");
          const hasPettyCash = isSuperadmin(user) || hasRole(user, "PETTY_CASH_CUSTODIAN");
          if (!hasBo && hasPettyCash) setTab("pettycash");
        }
      });
  }, []);

  // Any BO whose scope covers this request can unapprove it, not just the
  // one who clicked Approve — matches the server-side check in
  // bo-unapprove/route.ts (which is the actual enforcement; this is UX
  // only).
  const canUnapprove = (r: ExpenseRequest) =>
    !!currentUser && (isSuperadmin(currentUser) || (hasRole(currentUser, "BO") && canBoActOnRequest(currentUser, r)));

  const buFiltered = useMemo(
    () => (buFilter === "ALL" ? requests : requests.filter((r) => r.bu === buFilter)),
    [requests, buFilter],
  );

  const approve = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/bo-approve`, { method: "PATCH" });
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
    if (!confirm("Unapprove this request? It will go back to awaiting BO approval.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/bo-unapprove`, { method: "PATCH" });
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

  return (
    <div>
      <h1 className="mm-page-title mb-4">BO Approvals</h1>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="mm-tabs">
          {isBoRole &&
            (["pending", "edit-requests", "all"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`mm-tab ${tab === t ? "mm-tab-active" : ""}`}
              >
                {t === "pending" ? "Pending" : t === "edit-requests" ? `Edit Requests (${editRequestCount})` : "All"}
              </button>
            ))}
          {isPettyCashRole && (
            <button
              onClick={() => setTab("pettycash")}
              className={`mm-tab ${tab === "pettycash" ? "mm-tab-active" : ""}`}
            >
              Petty Cash
            </button>
          )}
        </div>
        <select
          className="h-8 rounded-md border border-brand-border px-2 text-[13px]"
          value={buFilter}
          onChange={(e) => setBuFilter(e.target.value)}
        >
          <option value="ALL">All BUs</option>
          {BUSINESS_UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      <FilterBar requests={buFiltered} onFilteredChange={setFiltered} statuses={RELEVANT_STATUSES} />

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
                    {r.bu}
                  </span>
                  {r.skip_bo && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Skip BO
                    </span>
                  )}
                  {r.ceo_signature_required && (
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-800">
                      Needs CEO Signature
                    </span>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2 text-sm text-brand-dark">
                {r.requester_name} — {r.department} {r.cat_l1 ? `/ ${r.cat_l1}` : ""} — {r.expense_type}
              </div>
              <div className="mt-1 text-sm font-medium text-brand-dark">{formatCurrency(r.total)}</div>
              <div className="mt-1 text-xs text-brand-muted">Submitted {formatDate(r.timestamp)}</div>
              {r.status === "BO_APPROVED" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-brand-muted">
                  <span>Approved by {r.bo_approver ?? "-"} at {formatDate(r.bo_approved_at)}</span>
                  {canUnapprove(r) && (
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
            selected.status === "BO_APPROVED" && isEditRequestPending(selected) ? (
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
            ) : (selected.status === "PO_UPLOADED" || (!selected.requires_po && selected.status === "SUBMITTED")) &&
            !selected.skip_bo ? (
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
            ) : selected.status === "BO_APPROVED" && canUnapprove(selected) ? (
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
