"use client";

import { useEffect, useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import { BUSINESS_UNITS } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ExpenseRequest, RoleRow } from "@/types/database";

type Tab = "pending" | "all";
const RELEVANT_STATUSES = ["SUBMITTED", "PO_UPLOADED", "BO_APPROVED"] as const;

export default function BoApprovalsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [buFilter, setBuFilter] = useState<string>("ALL");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [currentUser, setCurrentUser] = useState<{ email: string; allRoles: RoleRow[] } | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/requests?scope=bo&tab=${tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser({ email: data.user.email, allRoles: data.user.allRoles ?? [] });
      });
  }, []);

  const isSuperadminUser = currentUser?.allRoles.some((r) => r.role === "SUPERADMIN") ?? false;
  const canUnapprove = (r: ExpenseRequest) => isSuperadminUser || r.bo_approver === currentUser?.email;

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

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-brand-dark">BO Approvals</h1>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {(["pending", "all"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t ? "bg-brand-brown text-white" : "border border-brand-border text-brand-dark"
              }`}
            >
              {t === "pending" ? "Pending" : "All"}
            </button>
          ))}
        </div>
        <select
          className="rounded-md border border-brand-border px-3 py-1.5 text-sm"
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
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-brand-dark/70">{r.request_id}</span>
                  <span className="rounded-full bg-brand-cream px-2 py-0.5 text-xs text-brand-dark">
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
              <div className="mt-1 text-xs text-brand-dark/60">Submitted {formatDate(r.timestamp)}</div>
              {r.status === "BO_APPROVED" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-brand-dark/70">
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
            </div>
          ))}
        </div>
      )}

      {selected && (
        <RequestDetailModal
          request={selected}
          onClose={() => setSelected(null)}
          actions={
            (selected.status === "PO_UPLOADED" || (!selected.requires_po && selected.status === "SUBMITTED")) &&
            !selected.skip_bo ? (
              <>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => approve(selected.request_id)}
                  className="rounded-md bg-brand-brown px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => reject(selected.request_id)}
                  className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            ) : selected.status === "BO_APPROVED" && canUnapprove(selected) ? (
              <button
                disabled={busy === selected.request_id}
                onClick={() => unapprove(selected.request_id)}
                className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
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
