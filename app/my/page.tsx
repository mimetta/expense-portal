"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import RequestForm, { requestToFormInitial, type RequestFormPayload } from "@/components/shared/RequestForm";
import { formatCurrency, formatDate } from "@/lib/format";
import { canResubmit, isOwnerEditable, resubmitDeadline } from "@/lib/status";
import type { ExpenseRequest } from "@/types/database";

function Countdown({ request }: { request: ExpenseRequest }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const deadline = resubmitDeadline(request);
  if (!deadline) return null;
  const msLeft = deadline.getTime() - Date.now();
  if (msLeft <= 0) return <span className="text-xs text-brand-dark/50">Resubmit window closed</span>;

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

  const patchRequest = async (payload: RequestFormPayload, extra: { resubmit?: boolean; owner_edit?: boolean }) => {
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-auto my-8 max-w-4xl rounded-md bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} className="text-sm text-brand-dark/60 hover:text-brand-dark">
            ✕ Close
          </button>
        </div>
        <RequestForm
          initial={requestToFormInitial(request)}
          title={isRejected ? `Edit & Resubmit — ${request.request_id}` : `Edit Request — ${request.request_id}`}
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
            ) : (
              <div className="rounded-md border border-brand-border bg-brand-cream/50 p-3 text-sm text-brand-dark">
                You can edit this request freely until Procurement takes action on it.
              </div>
            )
          }
          submitLabel="Save Changes"
          submittingLabel="Saving..."
          onSubmit={(payload) => patchRequest(payload, isRejected ? { resubmit: false } : { owner_edit: true })}
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

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [editing, setEditing] = useState<ExpenseRequest | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/requests?scope=mine")
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-brand-dark">My Requests</h1>
      <FilterBar requests={requests} onFilteredChange={setFiltered} />
      {loading ? (
        <p className="text-sm text-brand-dark/60">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-brand-dark/60">No requests yet.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-brand-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-cream text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">Request ID</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.request_id}
                  onClick={() => setSelected(r)}
                  className="cursor-pointer border-t border-brand-border hover:bg-brand-cream/30"
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.request_id}</td>
                  <td className="px-3 py-2">{formatDate(r.timestamp)}</td>
                  <td className="px-3 py-2">{r.department}</td>
                  <td className="px-3 py-2">{formatCurrency(r.total)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                    {isOwnerEditable(r) && (
                      <div className="mt-0.5 text-[11px] text-brand-dark/50">Editable</div>
                    )}
                    {r.status === "SUBMITTED" && !isOwnerEditable(r) && (
                      <div className="mt-0.5 text-[11px] text-brand-dark/50">Pending Procurement</div>
                    )}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
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
          onOwnerSaved={load}
          footerExtra={
            selected.status === "REJECTED" ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setEditing(selected);
                    setSelected(null);
                  }}
                  className="rounded-md bg-brand-brown px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent"
                >
                  Edit &amp; Resubmit
                </button>
                <Countdown request={selected} />
              </div>
            ) : undefined
          }
        />
      )}

      {editing && (
        <EditRequestModal request={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
