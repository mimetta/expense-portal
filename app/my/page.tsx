"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import RequestForm, { requestToFormInitial, type RequestFormPayload } from "@/components/shared/RequestForm";
import { computeTotals } from "@/lib/totals";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  canRequestEdit,
  canResubmit,
  isEditApproved,
  isEditRequestPending,
  isOwnerEditable,
  resubmitDeadline,
} from "@/lib/status";
import type { DraftRow, ExpenseRequest, RequestItem } from "@/types/database";

function Countdown({ request }: { request: ExpenseRequest }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const deadline = resubmitDeadline(request);
  if (!deadline) return null;
  const msLeft = deadline.getTime() - Date.now();
  if (msLeft <= 0) return <span className="text-xs text-brand-subtle">Resubmit window closed</span>;

  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  return (
    <span className="text-xs font-medium text-red-700">
      {hours}h {minutes}m left to resubmit
    </span>
  );
}

// Edit / Edit & Resubmit — reuses the exact Submit page form (components/
// shared/RequestForm) so a request is edited with the identical fields,
// dropdowns, and conditional logic as /submit. Behavior branches on the
// request's current status:
//   - REJECTED: "Save Changes" is a plain PATCH (status unchanged); "Save &
//     Resubmit" additionally flags resubmit: true, which steps the status
//     back one stage (see lib/resubmit.ts) — only offered within the 24h
//     window. Unchanged from the original Edit & Resubmit behavior.
//   - SUBMITTED + isOwnerEditable (no Procurement action yet): "Save
//     Changes" only (resubmitting doesn't apply — there's nothing to step
//     back from) — flags owner_edit: true instead (see the PATCH route's
//     doc comment for why that flag exists).
function EditRequestModal({
  request,
  onClose,
  onSaved,
}: {
  request: ExpenseRequest;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isRejected = request.status === "REJECTED";
  const isEditApprovedRequest = isEditApproved(request);

  const patchRequest = async (
    payload: RequestFormPayload,
    extra: { resubmit?: boolean; owner_edit?: boolean; edit_resubmit?: boolean },
  ) => {
    const res = await fetch(`/api/requests/${request.request_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ...extra }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? "Failed to save");
    }
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"
      style={{ backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="mx-auto my-8 max-w-4xl rounded-xl border border-brand-border bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} className="text-sm text-brand-muted hover:text-brand-dark">
            ✕ Close
          </button>
        </div>
        <RequestForm
          initial={requestToFormInitial(request)}
          driveContext={{ requestId: request.request_id }}
          title={
            isRejected
              ? `Edit & Resubmit — ${request.request_id}`
              : isEditApprovedRequest
                ? `Edit & Resubmit — ${request.request_id}`
                : `Edit Request — ${request.request_id}`
          }
          banner={
            isRejected ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-medium text-red-800">
                  Rejected at {request.rejected_stage ?? "-"} by {request.rejected_by ?? "-"} —{" "}
                  {formatDate(request.rejected_at)}
                </p>
                <p className="text-red-700">Reason: {request.reject_reason ?? "-"}</p>
                <div className="mt-1">
                  <Countdown request={request} />
                </div>
              </div>
            ) : isEditApprovedRequest ? (
              <div className="rounded-md border border-brand-border bg-[#F9F8F6] p-3 text-sm text-brand-dark">
                <span className="font-medium">{request.edit_approved_by}</span> granted your edit request. Make
                your changes and resubmit — the request will return to{" "}
                <span className="font-medium">{request.status_before_edit ?? "its prior stage"}</span>.
              </div>
            ) : (
              <div className="rounded-md border border-brand-border bg-[#F9F8F6] p-3 text-sm text-brand-dark">
                You can edit this request freely until Procurement takes action on it.
              </div>
            )
          }
          submitLabel={isEditApprovedRequest ? "Save & Resubmit" : "Save Changes"}
          submittingLabel={isEditApprovedRequest ? "Resubmitting..." : "Saving..."}
          onSubmit={(payload) =>
            patchRequest(
              payload,
              isEditApprovedRequest ? { edit_resubmit: true } : isRejected ? { resubmit: false } : { owner_edit: true },
            )
          }
          secondaryAction={
            isRejected && canResubmit(request)
              ? {
                  label: "Save & Resubmit",
                  busyLabel: "Resubmitting...",
                  onClick: (payload) => patchRequest(payload, { resubmit: true }),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

// Small reason-prompt modal for step 1 of the Edit Request workflow
// (see CLAUDE.md) — the owner asks an approver's permission before they
// can touch a request that's already past isOwnerEditable's free window.
function RequestEditReasonModal({
  request,
  onClose,
  onSubmitted,
}: {
  request: ExpenseRequest;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) {
      setError("Reason is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${request.request_id}/request-edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to request edit");
      }
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request edit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      style={{ backdropFilter: "blur(2px)" }}
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-brand-border bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-base font-semibold text-brand-dark">Request Edit</h3>
        <p className="mb-3 text-sm text-brand-muted">
          Ask the current approver for permission to edit <span className="font-mono">{request.request_id}</span>.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why do you need to edit this request?"
          className="mb-2 w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-brown focus:outline-none"
        />
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="mm-btn-secondary">
            Cancel
          </button>
          <button onClick={submit} disabled={busy} className="mm-btn-primary">
            {busy ? "Sending..." : "Send Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Rough "amount if entered" for a draft row — sums whatever item amounts
// exist in its saved form_data, without needing a full valid item set
// (drafts are, by definition, incomplete). Returns 0 rather than throwing
// if items are missing/empty, unlike lib/totals.ts#computeTotals which
// requires at least one item.
function draftAmount(items: RequestItem[] | undefined): number {
  if (!items || items.length === 0) return 0;
  try {
    return computeTotals(items).total;
  } catch {
    return 0;
  }
}

function DraftsTab({
  drafts,
  loading,
  onContinue,
  onDelete,
}: {
  drafts: DraftRow[];
  loading: boolean;
  onContinue: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  return (
    <div>
      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : drafts.length === 0 ? (
        <p className="text-sm text-brand-muted">No drafts yet.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Last edited</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => {
                const items = (d.form_data as { items?: RequestItem[] })?.items;
                const amount = draftAmount(items);
                return (
                  <tr key={d.id}>
                    <td>{d.title || "Untitled draft"}</td>
                    <td>{formatDate(d.updated_at)}</td>
                    <td>{amount > 0 ? formatCurrency(amount) : "-"}</td>
                    <td>
                      <button
                        onClick={() => onContinue(d.id)}
                        className="text-sm font-medium text-brand-brown hover:underline"
                      >
                        Continue
                      </button>
                      <button
                        onClick={() => setDeletingId(d.id)}
                        className="ml-3 text-sm font-medium text-[#DC2626] hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {deletingId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          style={{ backdropFilter: "blur(2px)" }}
          onClick={() => setDeletingId(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-brand-border bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold text-brand-dark">Delete draft?</h3>
            <p className="mb-4 text-sm text-brand-muted">This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingId(null)} className="mm-btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(deletingId);
                  setDeletingId(null);
                }}
                className="mm-btn-danger"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyRequestsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"requests" | "drafts">("requests");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [editing, setEditing] = useState<ExpenseRequest | null>(null);
  const [requestingEdit, setRequestingEdit] = useState<ExpenseRequest | null>(null);
  const [deleting, setDeleting] = useState<ExpenseRequest | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/requests?scope=mine")
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  const loadDrafts = () => {
    setDraftsLoading(true);
    fetch("/api/drafts")
      .then((res) => res.json())
      .then((data) => setDrafts(data.drafts ?? []))
      .finally(() => setDraftsLoading(false));
  };

  useEffect(load, []);
  useEffect(loadDrafts, []);

  const deleteDraft = async (id: number) => {
    try {
      const res = await fetch(`/api/drafts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete draft");
      loadDrafts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete draft");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/requests/${deleting.request_id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete");
      }
      setDeleting(null);
      setSelected(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <h1 className="mm-page-title mb-4">My Requests</h1>

      <div className="mm-tabs mb-4">
        <button
          onClick={() => setTab("requests")}
          className={`mm-tab ${tab === "requests" ? "mm-tab-active" : ""}`}
        >
          Requests
        </button>
        <button onClick={() => setTab("drafts")} className={`mm-tab ${tab === "drafts" ? "mm-tab-active" : ""}`}>
          Drafts
          {drafts.length > 0 && <span className="mm-tab-count ml-1.5">{drafts.length}</span>}
        </button>
      </div>

      {tab === "drafts" && (
        <DraftsTab
          drafts={drafts}
          loading={draftsLoading}
          onContinue={(id) => router.push(`/submit?draft=${id}`)}
          onDelete={deleteDraft}
        />
      )}

      {tab === "requests" && (
        <>
      <FilterBar requests={requests} onFilteredChange={setFiltered} />
      {loading ? (
        <p className="text-sm text-brand-muted">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-brand-muted">No requests yet.</p>
      ) : (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Date</th>
                <th>Segment</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.request_id} onClick={() => setSelected(r)} className="cursor-pointer">
                  <td className="font-mono text-xs">{r.request_id}</td>
                  <td>{formatDate(r.timestamp)}</td>
                  <td>{r.department}</td>
                  <td>{formatCurrency(r.total)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                    {isOwnerEditable(r) && (
                      <div className="mt-0.5 text-[11px] text-brand-subtle">Editable</div>
                    )}
                    {r.status === "SUBMITTED" && !isOwnerEditable(r) && (
                      <div className="mt-0.5 text-[11px] text-brand-subtle">Pending Procurement</div>
                    )}
                    {isEditRequestPending(r) && (
                      <div className="mt-0.5 text-[11px] font-medium text-amber-700">
                        Edit requested — awaiting approval
                      </div>
                    )}
                    {isEditApproved(r) && (
                      <div className="mt-0.5 text-[11px] font-medium text-amber-700">Edit approved — resubmit</div>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {isOwnerEditable(r) && (
                      <button
                        onClick={() => setEditing(r)}
                        className="text-sm font-medium text-brand-brown hover:underline"
                      >
                        ✏️ Edit
                      </button>
                    )}
                    {r.status === "REJECTED" && (
                      <button
                        onClick={() => setEditing(r)}
                        className="text-sm font-medium text-brand-brown hover:underline"
                      >
                        ↩ Edit &amp; Resubmit
                      </button>
                    )}
                    {canRequestEdit(r) && (
                      <button
                        onClick={() => setRequestingEdit(r)}
                        className="text-sm font-medium text-brand-brown hover:underline"
                      >
                        ✏️ Request Edit
                      </button>
                    )}
                    {isEditApproved(r) && (
                      <button
                        onClick={() => setEditing(r)}
                        className="text-sm font-medium text-brand-brown hover:underline"
                      >
                        ↩ Edit &amp; Resubmit
                      </button>
                    )}
                    {isOwnerEditable(r) && (
                      <button
                        onClick={() => setDeleting(r)}
                        className="ml-3 text-sm font-medium text-[#DC2626] hover:underline"
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}

      {selected && (
        <RequestDetailModal
          request={selected}
          onClose={() => setSelected(null)}
          onOwnerSaved={load}
          footerExtra={
            selected.status === "REJECTED" ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setEditing(selected);
                    setSelected(null);
                  }}
                  className="mm-btn-primary"
                >
                  Edit &amp; Resubmit
                </button>
                <Countdown request={selected} />
              </div>
            ) : isEditApproved(selected) ? (
              <button
                onClick={() => {
                  setEditing(selected);
                  setSelected(null);
                }}
                className="mm-btn-primary"
              >
                Edit &amp; Resubmit
              </button>
            ) : canRequestEdit(selected) ? (
              <button
                onClick={() => {
                  setRequestingEdit(selected);
                  setSelected(null);
                }}
                className="mm-btn-primary"
              >
                ✏️ Request Edit
              </button>
            ) : undefined
          }
        />
      )}

      {editing && (
        <EditRequestModal request={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}

      {requestingEdit && (
        <RequestEditReasonModal
          request={requestingEdit}
          onClose={() => setRequestingEdit(null)}
          onSubmitted={load}
        />
      )}

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          style={{ backdropFilter: "blur(2px)" }}
          onClick={() => !deleteBusy && setDeleting(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-brand-border bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold text-brand-dark">Delete request?</h3>
            <p className="mb-4 text-sm text-brand-muted">
              Are you sure you want to delete <span className="font-mono">{deleting.request_id}</span>? This
              cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} disabled={deleteBusy} className="mm-btn-secondary">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleteBusy} className="mm-btn-danger">
                {deleteBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
