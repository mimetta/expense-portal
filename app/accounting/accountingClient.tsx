"use client";

import { useEffect, useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import FilterBar from "@/components/FilterBar";
import RequestDetailModal from "@/components/shared/RequestDetailModal";
import { formatCurrency, formatDate } from "@/lib/format";
import { isEditRequestPending } from "@/lib/status";
import { exportRequestsToExcel } from "@/lib/exportRequests";
import type { CalendarEventRow, ExpenseRequest } from "@/types/database";

type Tab = "pending" | "paid" | "edit-requests";
const RELEVANT_STATUSES = ["CEO_APPROVED", "PAID"] as const;

interface PaymentBucket {
  eventDate: string;
  title: string;
  total: number;
  count: number;
  requests: ExpenseRequest[];
}

interface UnscheduledBucket {
  total: number;
  count: number;
  requests: ExpenseRequest[];
}

interface MonthGroup {
  monthKey: string;
  label: string;
  buckets: PaymentBucket[];
  totalCount: number;
  totalAmount: number;
}

// Buckets every currently-unpaid (Awaiting Payment) request into the
// EARLIEST upcoming "payment"-type calendar_events date on/after its
// due_date — i.e. "this expense will go out in the next payment run on or
// after it's due." Requests with no due_date, or whose due_date falls after
// every payment date currently entered on the calendar, land in a separate
// "unscheduled" bucket rather than being silently dropped or guessed at.
// This interpretation was called out explicitly to Darling rather than
// assumed silently — flag if payment dates should instead be matched some
// other way (e.g. exact due_date match only).
function bucketByPaymentDate(
  requests: ExpenseRequest[],
  paymentDates: CalendarEventRow[],
): { buckets: PaymentBucket[]; unscheduled: UnscheduledBucket } {
  const sorted = [...paymentDates].sort((a, b) => a.event_date.localeCompare(b.event_date));
  const buckets: PaymentBucket[] = sorted.map((pd) => ({
    eventDate: pd.event_date,
    title: pd.title,
    total: 0,
    count: 0,
    requests: [],
  }));
  const unscheduled: UnscheduledBucket = { total: 0, count: 0, requests: [] };

  for (const r of requests) {
    const due = r.due_date;
    const bucket = due ? buckets.find((b) => b.eventDate >= due) : undefined;
    if (bucket) {
      bucket.total += r.total;
      bucket.count += 1;
      bucket.requests.push(r);
    } else {
      unscheduled.total += r.total;
      unscheduled.count += 1;
      unscheduled.requests.push(r);
    }
  }

  return { buckets, unscheduled };
}

function monthLabel(eventDate: string): string {
  const [y, m] = eventDate.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Groups the sorted payment-date buckets by calendar month, so the summary
// can collapse to one row per month (Darling's "month by month" request)
// with each month expanding to its individual payment dates, which in turn
// expand to the actual request list — see the mockup this was built from.
function groupByMonth(buckets: PaymentBucket[]): MonthGroup[] {
  const order: string[] = [];
  const map = new Map<string, PaymentBucket[]>();
  for (const b of buckets) {
    const key = b.eventDate.slice(0, 7);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(b);
  }
  return order.map((monthKey) => {
    const group = map.get(monthKey)!;
    return {
      monthKey,
      label: monthLabel(group[0].eventDate),
      buckets: group,
      totalCount: group.reduce((s, b) => s + b.count, 0),
      totalAmount: group.reduce((s, b) => s + b.total, 0),
    };
  });
}

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<ExpenseRequest[]>([]);
  const [filtered, setFiltered] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<ExpenseRequest | null>(null);
  const [editRequestCount, setEditRequestCount] = useState(0);
  // Payment Date Summary — fetched independently of `tab` (always the full
  // Awaiting Payment set + all "payment"-type calendar events), so the
  // summary stays accurate no matter which tab is currently displayed.
  const [awaitingPayment, setAwaitingPayment] = useState<ExpenseRequest[]>([]);
  const [paymentDates, setPaymentDates] = useState<CalendarEventRow[]>([]);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [unscheduledExpanded, setUnscheduledExpanded] = useState(false);

  const toggleMonth = (key: string) =>
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleDate = (key: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const load = () => {
    setLoading(true);
    fetch(`/api/requests?scope=accounting&tab=${tab}`)
      .then((res) => res.json())
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  };

  // Refreshed on every tab switch (cheap, keeps it current) and explicitly
  // after Mark Paid/Reject below, so the summary never shows a request
  // that's just been paid or rejected as still "awaiting payment".
  const loadPaymentSummary = () => {
    fetch("/api/requests?scope=accounting&tab=pending")
      .then((res) => res.json())
      .then((data) => setAwaitingPayment(data.requests ?? []));
    fetch("/api/calendar-events")
      .then((res) => res.json())
      .then((data) => setPaymentDates((data.events ?? []).filter((e: CalendarEventRow) => e.event_type === "payment")));
  };

  const { buckets: paymentBuckets, unscheduled: unscheduledPayment } = useMemo(
    () => bucketByPaymentDate(awaitingPayment, paymentDates),
    [awaitingPayment, paymentDates],
  );
  const monthGroups = useMemo(() => groupByMonth(paymentBuckets), [paymentBuckets]);

  useEffect(load, [tab]);
  useEffect(loadPaymentSummary, [tab]);

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
      loadPaymentSummary();
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
      loadPaymentSummary();
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
      <div className="mb-4 flex items-center justify-between">
        <h1 className="mm-page-title">Accounting</h1>
        <button
          onClick={() =>
            exportRequestsToExcel(
              filtered,
              `accounting-${tab}-${new Date().toISOString().slice(0, 10)}.xlsx`,
            )
          }
          disabled={filtered.length === 0}
          className="mm-btn-secondary mm-btn-sm"
        >
          ⬇ Export to Excel
        </button>
      </div>

      <div className="mm-card mb-4">
        <h3 className="mm-section-label">Payment Date Summary</h3>
        {paymentDates.length === 0 ? (
          <p className="text-sm text-brand-muted">
            No &quot;Payment&quot; events on the calendar yet — add them from the homepage Calendar to see totals here.
          </p>
        ) : (
          <div>
            {monthGroups.map((m) => {
              const monthOpen = expandedMonths.has(m.monthKey);
              return (
                <div key={m.monthKey}>
                  <div
                    onClick={() => toggleMonth(m.monthKey)}
                    className="flex cursor-pointer items-center justify-between border-b border-[#F5F0E8] px-1 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3 text-xs text-brand-subtle">{monthOpen ? "▾" : "▸"}</span>
                      <span className="text-sm font-medium text-brand-dark">{m.label}</span>
                    </div>
                    <div className="flex gap-6 text-sm text-brand-muted">
                      <span>{m.totalCount} requests</span>
                      <span className="min-w-[90px] text-right font-medium text-brand-dark">
                        {formatCurrency(m.totalAmount)}
                      </span>
                    </div>
                  </div>

                  {monthOpen && (
                    <div className="pl-6">
                      {m.buckets.map((b) => {
                        const dateOpen = expandedDates.has(b.eventDate);
                        return (
                          <div key={b.eventDate}>
                            <div
                              onClick={() => toggleDate(b.eventDate)}
                              className="flex cursor-pointer items-center justify-between border-b border-[#F5F0E8] px-1 py-2.5"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-3 text-[11px] text-brand-subtle">{dateOpen ? "▾" : "▸"}</span>
                                <span className="text-[13px] text-brand-dark">{formatDate(b.eventDate)}</span>
                                <span
                                  className="rounded-[3px] text-[11px]"
                                  style={{ background: "#EFF6FF", color: "#1D4ED8", padding: "1px 6px" }}
                                >
                                  {b.title}
                                </span>
                              </div>
                              <div className="flex gap-6 text-[13px] text-brand-muted">
                                <span>{b.count}</span>
                                <span className="min-w-[90px] text-right font-medium text-brand-dark">
                                  {formatCurrency(b.total)}
                                </span>
                              </div>
                            </div>

                            {dateOpen && (
                              <div className="py-1 pb-2 pl-6">
                                {b.requests.length === 0 ? (
                                  <p className="py-2 text-xs text-brand-subtle">No requests in this bucket.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-left text-brand-subtle">
                                        <th className="py-1 pr-2 font-medium">Request ID</th>
                                        <th className="py-1 pr-2 font-medium">Requester</th>
                                        <th className="py-1 pr-2 font-medium">Segment</th>
                                        <th className="py-1 text-right font-medium">Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {b.requests.map((r) => (
                                        <tr
                                          key={r.request_id}
                                          onClick={() => setSelected(r)}
                                          className="cursor-pointer hover:bg-[#FAFAF7]"
                                        >
                                          <td className="py-1 pr-2 font-mono text-brand-dark">{r.request_id}</td>
                                          <td className="py-1 pr-2 text-brand-dark">{r.requester_name}</td>
                                          <td className="py-1 pr-2 text-brand-muted">{r.department}</td>
                                          <td className="py-1 text-right text-brand-dark">
                                            {formatCurrency(r.total)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {unscheduledPayment.count > 0 && (
              <div>
                <div
                  onClick={() => setUnscheduledExpanded((v) => !v)}
                  className="flex cursor-pointer items-center justify-between px-1 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-3 text-xs text-brand-subtle">{unscheduledExpanded ? "▾" : "▸"}</span>
                    <span className="text-sm text-brand-muted">
                      No due date / beyond the last scheduled payment date
                    </span>
                  </div>
                  <div className="flex gap-6 text-sm text-brand-muted">
                    <span>{unscheduledPayment.count} requests</span>
                    <span className="min-w-[90px] text-right font-medium text-brand-dark">
                      {formatCurrency(unscheduledPayment.total)}
                    </span>
                  </div>
                </div>
                {unscheduledExpanded && (
                  <div className="pb-2 pl-9">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-brand-subtle">
                          <th className="py-1 pr-2 font-medium">Request ID</th>
                          <th className="py-1 pr-2 font-medium">Requester</th>
                          <th className="py-1 pr-2 font-medium">Segment</th>
                          <th className="py-1 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unscheduledPayment.requests.map((r) => (
                          <tr
                            key={r.request_id}
                            onClick={() => setSelected(r)}
                            className="cursor-pointer hover:bg-[#FAFAF7]"
                          >
                            <td className="py-1 pr-2 font-mono text-brand-dark">{r.request_id}</td>
                            <td className="py-1 pr-2 text-brand-dark">{r.requester_name}</td>
                            <td className="py-1 pr-2 text-brand-muted">{r.department}</td>
                            <td className="py-1 text-right text-brand-dark">{formatCurrency(r.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
