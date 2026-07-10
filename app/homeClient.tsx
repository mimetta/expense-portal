"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CalendarWidget from "@/components/CalendarWidget";
import { formatCurrency, formatDate } from "@/lib/format";
import type { AnnouncementRow } from "@/types/database";

interface HomeStats {
  myPending: number;
  pendingMyApproval: number;
  pendingMyApprovalRelevant: boolean;
  approvalLink: string;
  paidThisMonth: number;
}

export default function HomeClient() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/announcements").then((r) => r.json()),
      fetch("/api/dashboard/home-stats").then((r) => r.json()),
    ])
      .then(([a, s]) => {
        setAnnouncements(a.announcements ?? []);
        setStats(s);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mm-page-title">Welcome to Mimetta Expense Portal</h1>
        <p className="mm-page-subtitle !mb-0">Here&apos;s what&apos;s happening today.</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/my"
          className="mm-card block transition hover:bg-[#FAFAF7]"
          style={{ borderLeft: "3px solid #1F3A2B" }}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-brand-subtle">
            My Pending Requests
          </div>
          <div className="text-[26px] font-semibold text-brand-dark">{stats ? stats.myPending : "-"}</div>
        </Link>
        {stats?.pendingMyApprovalRelevant && (
          <Link
            href={stats.approvalLink}
            className="mm-card block transition hover:bg-[#FAFAF7]"
            style={{ borderLeft: "3px solid #BD5A2E" }}
          >
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-brand-subtle">
              Pending My Approval
            </div>
            <div className="text-[26px] font-semibold text-brand-dark">{stats.pendingMyApproval}</div>
          </Link>
        )}
        <Link
          href="/accounting"
          className="mm-card block transition hover:bg-[#FAFAF7]"
          style={{ borderLeft: "3px solid #9CAE8C" }}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-brand-subtle">
            Paid This Month
          </div>
          <div className="text-[26px] font-semibold text-brand-dark">
            {stats ? formatCurrency(stats.paidThisMonth) : "-"}
          </div>
        </Link>
      </div>

      {/* Calendar */}
      <CalendarWidget />

      {/* Announcements */}
      <div className="mm-card">
        <h2 className="mm-section-label">📢 Announcements</h2>
        {loading ? (
          <p className="text-sm text-brand-muted">Loading...</p>
        ) : announcements.length === 0 ? (
          <p className="text-sm text-brand-muted">No announcements.</p>
        ) : (
          <div className="space-y-4">
            {announcements.map((a) => (
              <div key={a.id} className="border-l-[3px] border-[#BD5A2E] pl-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-brand-dark">{a.title}</span>
                  {a.is_pinned && (
                    <span className="rounded-full border border-[#F5C4A3] bg-[#FDF2EE] px-2 py-0.5 text-xs text-[#BD5A2E]">
                      📌 Pinned
                    </span>
                  )}
                </div>
                {a.message && <p className="mt-1 text-[13px] text-brand-muted">{a.message}</p>}
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
                <p className="mt-1 text-[11px] text-brand-subtle">{formatDate(a.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
