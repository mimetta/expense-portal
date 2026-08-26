"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { NotificationRow } from "@/types/database";

// Polling interval for the unread badge — this app has no websocket/
// real-time layer anywhere else (every list page is fetch-on-mount), so a
// lightweight poll matches the existing convention rather than introducing
// a new one just for this feature.
const POLL_MS = 30_000;

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = () => {
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((data) => {
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const openNotification = async (n: NotificationRow) => {
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      fetch(`/api/notifications/${n.id}`, { method: "PATCH" }).catch(() => {});
    }
    setOpen(false);
    router.push(`/print/${n.request_id}`);
  };

  const markAllRead = async () => {
    setLoading(true);
    try {
      await fetch("/api/notifications/mark-all-read", { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-brand-muted transition-colors hover:bg-[#F3F4F6] hover:text-brand-dark"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 2C10.3431 2 9 3.34315 9 5V5.29076C6.66435 6.14369 5 8.38007 5 11V16L3 19H21L19 16V11C19 8.38007 17.3356 6.14369 15 5.29076V5C15 3.34315 13.6569 2 12 2Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9.5 19C9.5 20.3807 10.6193 21.5 12 21.5C13.3807 21.5 14.5 20.3807 14.5 19" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ background: "#DC2626" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-md border border-brand-border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-brand-border px-3 py-2">
            <span className="text-sm font-medium text-brand-dark">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="text-xs font-medium text-brand-brown hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-brand-muted">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-brand-border px-3 py-2.5 text-left last:border-b-0 hover:bg-[#FAFAF7]"
                >
                  <div className="flex w-full items-start gap-2">
                    {!n.is_read && (
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: "#BD5A2E" }} />
                    )}
                    <span className={`flex-1 text-[13px] ${n.is_read ? "text-brand-muted" : "font-medium text-brand-dark"}`}>
                      {n.message}
                    </span>
                  </div>
                  <span className="pl-3.5 text-[11px] text-brand-subtle">{formatDate(n.created_at)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
