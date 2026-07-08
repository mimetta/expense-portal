"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal, { type ProcurementSavePatch } from "@/components/shared/RequestDetailModal";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ExpenseRequest } from "@/types/database";

type Tab = "pending" | "uploaded" | "all";
const RELEVANT_STATUSES = ["SUBMITTED", "PO_UPLOADED"] as const;

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending PO" },
  { key: "uploaded", label: "PO Uploaded" },
  { key: "all", label: "All" },
];

export default function ProcurementPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`/api/requests?scope=procurement&tab=${tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const reject = async (id: string) => {
    const reason = prompt("Rejection reason?");
    if (!reason) return;
    setBusy(true);
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
      setBusy(false);
    }
  };

  const saveChanges = async (id: string, patch: ProcurementSavePatch) => {
    const res = await fetch(`/api/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      // .catch() guards against a non-JSON response (e.g. a raw platform
      // error page) reaching res.json() and throwing a second, less useful
      // error that would mask the real one.
      const body = await res.json().catch(() => ({}));
      const detail = [body.error, body.hint].filter(Boolean).join(" — ");
      throw new Error(detail || `Failed to save changes (HTTP ${res.status})`);
    }
    setSelected(null);
    load();
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-brand-dark">Procurement</h1>
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? "bg-brand-brown text-white" : "border border-brand-border text-brand-dark"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FilterBar requests={requests} onFilteredChange={setFiltered} statuses={RELEVANT_STATUSES} />

      {loading ? (
        <p className="text-sm text-brand-dark/60">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-brand-dark/60">Nothing here.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div
              key={r.request_id}
              onClick={() => setSelected(r)}
              className="cursor-pointer rounded-md border border-brand-border p-4 hover:bg-brand-cream/30"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs text-brand-dark/70">{r.request_id}</span>
                  {r.skip_bo && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Skip BO — goes to CEO
                    </span>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2 text-sm text-brand-dark">
                {r.requester_name} — {r.department} — {r.expense_type}
              </div>
              <div className="mt-1 text-sm font-medium text-brand-dark">
                {formatCurrency(r.total)} · Supplier: {r.supplier_name ?? "-"}
              </div>
              {r.status === "PO_UPLOADED" && (
                <div className="mt-2 text-xs text-brand-dark/70">
                  PO #{r.po_number} · Vendor: {r.po_vendor} · Uploaded {formatDate(r.po_uploaded_at)}
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
          editable
          onSaveChanges={(patch) => saveChanges(selected.request_id, patch)}
          actions={
            selected.status === "SUBMITTED" ? (
              <button
                disabled={busy}
                onClick={() => reject(selected.request_id)}
                className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Reject
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
