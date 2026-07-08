"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ExpenseRequest } from "@/types/database";

type Tab = "pending" | "paid";
const RELEVANT_STATUSES = ["CEO_APPROVED", "PAID"] as const;

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/requests?scope=accounting&tab=${tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

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

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-brand-dark">Accounting</h1>
      <div className="mb-4 flex gap-2">
        {(["pending", "paid"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t ? "bg-brand-brown text-white" : "border border-brand-border text-brand-dark"
            }`}
          >
            {t === "pending" ? "Awaiting Payment" : "Paid"}
          </button>
        ))}
      </div>

      <FilterBar requests={requests} onFilteredChange={setFiltered} statuses={RELEVANT_STATUSES} />

      {loading ? (
        <p className="text-sm text-brand-dark/60">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-brand-dark/60">Nothing here.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-brand-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-cream text-left text-brand-dark">
              <tr>
                <th className="px-3 py-2">Request ID</th>
                <th className="px-3 py-2">Requester</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Slip Receiver</th>
                <th className="px-3 py-2">{tab === "pending" ? "CEO Approved" : "Paid At"}</th>
                <th className="px-3 py-2" />
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
                  <td className="px-3 py-2">{r.requester_name}</td>
                  <td className="px-3 py-2">{r.department}</td>
                  <td className="px-3 py-2">{formatCurrency(r.total)}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-xs text-brand-dark/70">{r.slip_receiver_email ?? "-"}</td>
                  <td className="px-3 py-2 text-xs text-brand-dark/70">
                    {formatDate(tab === "pending" ? r.ceo_approved_at : r.paid_at)}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {tab === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={busy === r.request_id}
                          onClick={() => setPaid(r.request_id, true)}
                          className="rounded-md bg-brand-brown px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-accent disabled:opacity-50"
                        >
                          Mark Paid
                        </button>
                        <button
                          disabled={busy === r.request_id}
                          onClick={() => reject(r.request_id)}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <button
                        disabled={busy === r.request_id}
                        onClick={() => setPaid(r.request_id, false)}
                        className="rounded-md border border-brand-border px-3 py-1.5 text-xs hover:bg-brand-cream disabled:opacity-50"
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
            selected.status === "CEO_APPROVED" ? (
              <>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => setPaid(selected.request_id, true)}
                  className="rounded-md bg-brand-brown px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent disabled:opacity-50"
                >
                  Mark Paid
                </button>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => reject(selected.request_id)}
                  className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            ) : selected.status === "PAID" ? (
              <button
                disabled={busy === selected.request_id}
                onClick={() => setPaid(selected.request_id, false)}
                className="rounded-md border border-brand-border px-4 py-2 text-sm hover:bg-brand-cream disabled:opacity-50"
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
