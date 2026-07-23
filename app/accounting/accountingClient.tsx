"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import { formatCurrency, formatDate } from "@/lib/format";
import { isEditRequestPending } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

type Tab = "pending" | "paid" | "edit-requests";
const RELEVANT_STATUSES = ["CEO_APPROVED", "PAID"] as const;

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [editRequestCount, setEditRequestCount] = useState(0);

  const load = () => {
    setLoading(true);
    fetch(`/api/requests?scope=accounting&tab=${tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  useEffect(() => {
    fetch("/api/requests?scope=accounting&tab=edit-requests")
      .then((res) => res.json())
      .then((data) => setEditRequestCount((data.requests ?? []).length));
  }, [tab]);

  const setPaid = async (id: string, paid: boolean) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/paid`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to update");
      }
      setSelected(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update");
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
      <h1 className="mm-page-title mb-4">Accounting</h1>
      <div className="mm-tabs mb-4">
        {(["pending", "paid", "edit-requests"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`mm-tab ${tab === t ? "mm-tab-active" : ""}`}
          >
            {t === "pending" ? "Awaiting Payment" : t === "paid" ? "Paid" : `Edit Requests (${editRequestCount})`}
          </button>
        ))}
      </div>

      <FilterBar requests={requests} onFilteredChange={setFiltered} statuses={RELEVANT_STATUSES} />

      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-brand-muted">Nothing here.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Requester</th>
                <th>Segment</th>
                <th>Due Date</th>
                <th>Total</th>
                <th>Status</th>
                <th>Slip Receiver</th>
                <th>{tab === "pending" ? "CEO Approved" : tab === "paid" ? "Paid At" : "Edit Reason"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.request_id} onClick={() => setSelected(r)} className="cursor-pointer">
                  <td className="font-mono text-xs">{r.request_id}</td>
                  <td>{r.requester_name}</td>
                  <td>{r.department}</td>
                  <td>{r.due_date ? formatDate(r.due_date) : "-"}</td>
                  <td>{formatCurrency(r.total)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="text-xs text-brand-muted">{r.slip_receiver_email ?? "-"}</td>
                  <td className="text-xs text-brand-muted">
                    {tab === "edit-requests"
                      ? r.edit_requested_reason ?? "-"
                      : formatDate(tab === "pending" ? r.ceo_approved_at : r.paid_at)}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {tab === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={busy === r.request_id}
                          onClick={() => setPaid(r.request_id, true)}
                          className="mm-btn-primary mm-btn-sm"
                        >
                          Mark Paid
                        </button>
                        <button
                          disabled={busy === r.request_id}
                          onClick={() => reject(r.request_id)}
                          className="mm-btn-danger mm-btn-sm"
                        >
                          Reject
                        </button>
                      </div>
                    ) : tab === "edit-requests" ? (
                      isEditRequestPending(r) && (
                        <div className="flex justify-end gap-2">
                          <button
                            disabled={busy === r.request_id}
                            onClick={() => actOnEditRequest(r.request_id, true)}
                            className="mm-btn-primary mm-btn-sm"
                          >
                            Allow Edit
                          </button>
                          <button
                            disabled={busy === r.request_id}
                            onClick={() => actOnEditRequest(r.request_id, false)}
                            className="mm-btn-danger mm-btn-sm"
                          >
                            Reject Edit
                          </button>
                        </div>
                      )
                    ) : (
                      <button
                        disabled={busy === r.request_id}
                        onClick={() => setPaid(r.request_id, false)}
                        className="mm-btn-secondary mm-btn-sm"
                      >
                        Mark Unpaid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <RequestDetailModal
          request={selected}
          onClose={() => setSelected(null)}
          actions={
            selected.status === "PAID" && isEditRequestPending(selected) ? (
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
            ) : selected.status === "CEO_APPROVED" ? (
              <>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => setPaid(selected.request_id, true)}
                  className="mm-btn-primary"
                >
                  Mark Paid
                </button>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => reject(selected.request_id)}
                  className="mm-btn-danger"
                >
                  Reject
                </button>
              </>
            ) : selected.status === "PAID" ? (
              <button
                disabled={busy === selected.request_id}
                onClick={() => setPaid(selected.request_id, false)}
                className="mm-btn-secondary"
              >
                Mark Unpaid
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
