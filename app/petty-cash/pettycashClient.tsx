"use client";

import { useEffect, useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import { BUSINESS_UNITS } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import { canBoActOnRequest, hasRole, isSuperadmin } from "@/lib/permissions";
import { isPettyCashApprovable } from "@/lib/status";
import type { CurrentUser, ExpenseRequest } from "@/types/database";

// Split out of app/bo-approvals/boapprovalsClient.tsx's "Petty Cash" sub-tab
// into its own top-level page/nav item, and then reworked again once it
// became clear the custodian's sign-off needed to be a genuinely separate
// step from BO_APPROVED, not a substitute for it (see migration 018,
// lib/status.ts#isPettyCashApprovable, and PATCH .../petty-cash-approve —
// three walked-through scenarios: a pure custodian, a custodian who's also
// an in-scope BO, and an employee borrowing from someone else's fund all
// need the same custodian-then-BO chain, collapsing to one click only when
// the same person holds both roles). "Pending" here means "awaiting my
// sign-off" — a request that's already signed off but still awaiting the
// real BO shows up in the "All" tab, not "Pending", since there's nothing
// left for the custodian to do on it.
type Tab = "pending" | "all";
const RELEVANT_STATUSES = ["SUBMITTED", "PO_UPLOADED", "BO_APPROVED"] as const;

export default function PettyCashClient() {
  const [tab, setTab] = useState<Tab>("pending");
  const [buFilter, setBuFilter] = useState<string>("ALL");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/requests?scope=pettycash&tab=${tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser(data.user as CurrentUser);
      });
  }, []);

  // Unchanged from the BO Approvals tab this replaces: bo-unapprove/route.ts
  // only authorizes the BO role (not PETTY_CASH_CUSTODIAN), so a pure
  // custodian never sees an Unapprove action here — only SUPERADMIN or an
  // in-scope BO do. Flag if custodian-initiated unapprove is ever wanted;
  // that would need a server-side change to bo-unapprove/route.ts too.
  const canUnapprove = (r: ExpenseRequest) =>
    !!currentUser && (isSuperadmin(currentUser) || (hasRole(currentUser, "BO") && canBoActOnRequest(currentUser, r)));

  const buFiltered = useMemo(
    () => (buFilter === "ALL" ? requests : requests.filter((r) => r.bu === buFilter)),
    [requests, buFilter],
  );

  const signOff = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/requests/${id}/petty-cash-approve`, { method: "PATCH" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to sign off");
      }
      setSelected(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to sign off");
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
      <h1 className="mm-page-title mb-4">Petty Cash</h1>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="mm-tabs">
          {(["pending", "all"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`mm-tab ${tab === t ? "mm-tab-active" : ""}`}
            >
              {t === "pending" ? "Pending" : "All"}
            </button>
          ))}
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
              {r.petty_cash_approved_by && r.status !== "BO_APPROVED" && (
                <div className="mt-2 text-xs text-brand-muted">
                  Signed off by {r.petty_cash_approved_by} at {formatDate(r.petty_cash_approved_at)}
                  {!r.skip_bo && r.status !== "CEO_APPROVED" && r.status !== "PAID" && r.status !== "REJECTED"
                    ? " — awaiting BO approval"
                    : ""}
                </div>
              )}
              {r.status === "BO_APPROVED" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-brand-muted">
                  <span>
                    Signed off by {r.petty_cash_approved_by ?? "-"}, approved by {r.bo_approver ?? "-"} at{" "}
                    {formatDate(r.bo_approved_at)}
                  </span>
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
            isPettyCashApprovable(selected) ? (
              <>
                <button
                  disabled={busy === selected.request_id}
                  onClick={() => signOff(selected.request_id)}
                  className="mm-btn-primary"
                >
                  Sign Off
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
