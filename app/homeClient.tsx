"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/format";
import type { AnnouncementRow, ExpenseRequest } from "@/types/database";

interface HomeStats {
  myPending: number;
  pendingMyApproval: number;
  pendingMyApprovalRelevant: boolean;
  approvalLink: string;
  paidThisMonth: number;
}

function formatDateOnly(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dueDateColor(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr < today) return "text-red-700";
  if (dateStr === today) return "text-orange-600";
  return "text-green-700";
}

export default function HomeClient() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [calendar, setCalendar] = useState<ExpenseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/announcements").then((r) => r.json()),
      fetch("/api/dashboard/home-stats").then((r) => r.json()),
      fetch("/api/dashboard/payment-calendar").then((r) => r.json()),
    ])
      .then(([a, s, c]) => {
        setAnnouncements(a.announcements ?? []);
        setStats(s);
        setCalendar(c.requests ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const monthLabel = useMemo(
    () => new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    [],
  );

  const groupedByDueDate = useMemo(() => {
    const map = new Map<string, ExpenseRequest[]>();
    for (const r of calendar) {
      const key = r.due_date ?? "-";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [calendar]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-dark">Welcome to Mimetta Expense Portal</h1>
        <p className="mt-1 text-sm text-brand-dark/60">Here&apos;s what&apos;s happening today.</p>
      </div>

      {/* Announcements */}
      <div className="rounded-md border border-brand-border bg-white p-4">
        <h2 className="mb-3 font-semibold text-brand-dark">📢 Announcements</h2>
        {loading ? (
          <p className="text-sm text-brand-dark/60">Loading...</p>
        ) : announcements.length === 0 ? (
          <p className="text-sm text-brand-dark/60">No announcements.</p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="border-b border-brand-border pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-brand-dark">{a.title}</span>
                  {a.is_pinned && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">📌 Pinned</span>
                  )}
                </div>
                {a.message && <p className="mt-1 text-sm text-brand-dark/70">{a.message}</p>}
                {a.attachment_url && (
                  a.attachment_type?.startsWith("image/") ? (
                    // Inline base64 data URL (see CLAUDE.md "File Storage"), not a remote asset
                    // next/image can optimize.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.attachment_url}
                      alt={a.title}
                      className="mt-2 max-h-64 rounded-md border border-brand-border object-contain"
                    />
                  ) : (
                    <a
                      href={a.attachment_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-sm text-brand-brown hover:underline"
                    >
                      📄 View attached document
                    </a>
                  )
                )}
                <p className="mt-1 text-xs text-brand-dark/50">{formatDate(a.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/my"
          className="rounded-md border border-brand-border bg-white p-4 transition hover:bg-brand-cream/40"
        >
          <div className="text-xs text-brand-dark/60">My Pending Requests</div>
          <div className="mt-1 text-2xl font-bold text-brand-dark">{stats ? stats.myPending : "-"}</div>
        </Link>
        {stats?.pendingMyApprovalRelevant && (
          <Link
            href={stats.approvalLink}
            className="rounded-md border border-brand-border bg-white p-4 transition hover:bg-brand-cream/40"
          >
            <div className="text-xs text-brand-dark/60">Pending My Approval</div>
            <div className="mt-1 text-2xl font-bold text-brand-dark">{stats.pendingMyApproval}</div>
          </Link>
        )}
        <Link
          href="/accounting"
          className="rounded-md border border-brand-border bg-white p-4 transition hover:bg-brand-cream/40"
        >
          <div className="text-xs text-brand-dark/60">Paid This Month</div>
          <div className="mt-1 text-2xl font-bold text-brand-dark">
            {stats ? formatCurrency(stats.paidThisMonth) : "-"}
          </div>
        </Link>
      </div>

      {/* Payment Calendar */}
      <div className="rounded-md border border-brand-border bg-white p-4">
        <h2 className="mb-3 font-semibold text-brand-dark">📅 Payment Calendar — {monthLabel}</h2>
        {loading ? (
          <p className="text-sm text-brand-dark/60">Loading...</p>
        ) : groupedByDueDate.length === 0 ? (
          <p className="text-sm text-brand-dark/60">No payments due this month.</p>
        ) : (
          <div className="space-y-4">
            {groupedByDueDate.map(([date, items]) => (
              <div key={date}>
                <div className={`text-sm font-semibold ${dueDateColor(date)}`}>{formatDateOnly(date)}</div>
                <div className="mt-1 space-y-1">
                  {items.map((r) => (
                    <div
                      key={r.request_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-border px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-mono text-xs text-brand-dark/70">{r.request_id}</span>
                        <span className="ml-2 text-brand-dark">{r.requester_name}</span>
                        <span className="ml-2 text-brand-dark/60">· {r.supplier_name ?? "-"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-brand-dark">{formatCurrency(r.total)}</span>
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
