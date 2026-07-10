"use client";

import { useEffect, useMemo, useState } from "react";
import RequiredMark from "@/components/shared/RequiredMark";
import { CALENDAR_EVENT_TYPES, CALENDAR_MANAGE_ROLES } from "@/lib/constants";
import { hasAnyRole } from "@/lib/permissions";
import type { CalendarEventRow, CalendarEventType, CurrentUser } from "@/types/database";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_STYLE: Record<CalendarEventType, { bg: string; color: string; label: string }> = {
  payment: { bg: "#EFF6FF", color: "#1D4ED8", label: "Payment" },
  deadline: { bg: "#FEE2E2", color: "#DC2626", label: "Deadline" },
  reminder: { bg: "#FEF3C7", color: "#92400E", label: "Reminder" },
  important: { bg: "#F0F4EF", color: "#1F3A2B", label: "Important" },
  general: { bg: "#F3F4F6", color: "#374151", label: "General" },
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Local-time YYYY-MM-DD — matches the `event_date` DATE column's wire
// format. Deliberately not toISOString() (UTC), which can land on the
// wrong calendar day depending on the viewer's timezone offset.
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

interface GridCell {
  date: Date;
  key: string;
  isCurrentMonth: boolean;
}

// Builds a Sun-start month grid, padded with leading/trailing days from
// the adjacent months so every row is a full week — row count varies (4-6)
// with how the month falls, rather than always forcing 6 rows.
function buildGrid(year: number, month: number): GridCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: GridCell[] = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    const date = new Date(year, month - 1, daysInPrevMonth - i);
    cells.push({ date, key: toDateKey(date), isCurrentMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    cells.push({ date, key: toDateKey(date), isCurrentMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const date = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    cells.push({ date, key: toDateKey(date), isCurrentMonth: false });
  }
  return cells;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function TypeBadge({ type, fontSize = 9 }: { type: CalendarEventType; fontSize?: number }) {
  const s = TYPE_STYLE[type];
  return (
    <span
      className="inline-flex items-center rounded-[3px] font-medium"
      style={{ background: s.bg, color: s.color, fontSize, padding: "1px 6px" }}
    >
      {s.label}
    </span>
  );
}

const emptyAddForm = () => ({
  title: "",
  description: "",
  event_date: toDateKey(new Date()),
  event_type: "general" as CalendarEventType,
});

export default function CalendarWidget() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [monthEvents, setMonthEvents] = useState<CalendarEventRow[]>([]);
  // Independent of the displayed month — Today/Upcoming in the right panel
  // always reflect the real current date, even while browsing a different
  // month in the grid.
  const [sidebarEvents, setSidebarEvents] = useState<CalendarEventRow[]>([]);

  const [tooltip, setTooltip] = useState<{ event: CalendarEventRow; x: number; y: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<GridCell | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm());
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);

  const canManage = !!currentUser && hasAnyRole(currentUser, CALENDAR_MANAGE_ROLES);

  useEffect(() => {
    fetch("/api/roles/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setCurrentUser(data.user as CurrentUser);
      });
  }, []);

  const loadSidebarEvents = () => {
    fetch("/api/calendar-events")
      .then((res) => res.json())
      .then((data) => setSidebarEvents(data.events ?? []));
  };

  const loadMonthEvents = (month: Date) => {
    fetch(`/api/calendar-events?month=${monthKey(month)}`)
      .then((res) => res.json())
      .then((data) => setMonthEvents(data.events ?? []));
  };

  useEffect(loadSidebarEvents, []);
  useEffect(() => loadMonthEvents(currentMonth), [currentMonth]);

  const grid = useMemo(
    () => buildGrid(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth],
  );
  const weeks = useMemo(() => chunk(grid, 7), [grid]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const e of monthEvents) {
      if (!map.has(e.event_date)) map.set(e.event_date, []);
      map.get(e.event_date)!.push(e);
    }
    return map;
  }, [monthEvents]);

  const todayKey = toDateKey(new Date());
  const todayEvents = useMemo(
    () => sidebarEvents.filter((e) => e.event_date === todayKey),
    [sidebarEvents, todayKey],
  );
  const upcomingEvents = useMemo(
    () =>
      sidebarEvents
        .filter((e) => e.event_date >= todayKey)
        .sort((a, b) => a.event_date.localeCompare(b.event_date))
        .slice(0, 5),
    [sidebarEvents, todayKey],
  );

  const monthTitle = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const goToMonth = (delta: number) => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };
  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const refreshAll = () => {
    loadSidebarEvents();
    loadMonthEvents(currentMonth);
  };

  const submitAddEvent = async () => {
    if (!addForm.title.trim() || !addForm.event_date) {
      setAddError("Title and date are required");
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      const res = await fetch("/api/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create event");
      }
      setShowAddModal(false);
      setAddForm(emptyAddForm());
      refreshAll();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (id: number) => {
    if (!confirm("Delete this event?")) return;
    setDeleteBusyId(id);
    try {
      const res = await fetch(`/api/calendar-events/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete event");
      }
      refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete event");
    } finally {
      setDeleteBusyId(null);
    }
  };

  const selectedDayEvents = selectedDay ? eventsByDate.get(selectedDay.key) ?? [] : [];

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ===================== Calendar (left) ===================== */}
      <div className="mm-card !p-0 lg:flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToMonth(-1)}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-brand-border text-brand-dark hover:bg-[#F9F8F6]"
              aria-label="Previous month"
            >
              ‹
            </button>
            <div className="min-w-[88px] text-center text-sm font-semibold text-brand-dark">{monthTitle}</div>
            <button
              type="button"
              onClick={() => goToMonth(1)}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-brand-border text-brand-dark hover:bg-[#F9F8F6]"
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={goToToday} className="mm-btn-secondary h-[30px] px-2.5 text-xs">
              Today
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setAddForm(emptyAddForm());
                  setAddError(null);
                  setShowAddModal(true);
                }}
                className="flex h-[30px] items-center rounded-md bg-brand-brown px-2.5 text-xs font-medium text-white hover:bg-brand-accent"
              >
                + Add event
              </button>
            )}
          </div>
        </div>

        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#F9F8F6", borderBottom: "1px solid #F0EAE0" }}>
              {WEEKDAY_LABELS.map((d) => (
                <th
                  key={d}
                  className="font-semibold uppercase text-brand-subtle"
                  style={{ width: "14.28%", fontSize: 9, padding: "6px 4px" }}
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((cell) => {
                  const dayEvents = eventsByDate.get(cell.key) ?? [];
                  const isToday = cell.key === todayKey;
                  const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
                  const dayColor = !cell.isCurrentMonth ? "#D8CBB0" : isWeekend ? "#9CA3AF" : "#1A1A1A";
                  const shown = dayEvents.slice(0, 2);
                  const extra = dayEvents.length - shown.length;

                  return (
                    <td
                      key={cell.key}
                      onClick={() => dayEvents.length > 0 && setSelectedDay(cell)}
                      style={{
                        height: 58,
                        padding: "4px 5px",
                        borderRight: "1px solid #F5F0E8",
                        borderBottom: "1px solid #F5F0E8",
                        verticalAlign: "top",
                        background: isToday ? "#F5FAF2" : undefined,
                        cursor: dayEvents.length > 0 ? "pointer" : "default",
                      }}
                    >
                      {isToday ? (
                        <span
                          className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-brown font-medium text-white"
                          style={{ fontSize: 11 }}
                        >
                          {cell.date.getDate()}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: dayColor }}>{cell.date.getDate()}</span>
                      )}
                      <div className="mt-0.5 space-y-0.5">
                        {shown.map((ev) => (
                          <div
                            key={ev.id}
                            onMouseEnter={(e) => setTooltip({ event: ev, x: e.clientX + 12, y: e.clientY - 40 })}
                            onMouseMove={(e) => setTooltip({ event: ev, x: e.clientX + 12, y: e.clientY - 40 })}
                            onMouseLeave={() => setTooltip(null)}
                            className="truncate rounded-[3px]"
                            style={{
                              background: TYPE_STYLE[ev.event_type].bg,
                              color: TYPE_STYLE[ev.event_type].color,
                              fontSize: 8,
                              padding: "1px 4px",
                            }}
                          >
                            {ev.title}
                          </div>
                        ))}
                        {extra > 0 && (
                          <div className="text-brand-subtle" style={{ fontSize: 8 }}>
                            +{extra} more
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===================== Right panel ===================== */}
      <div className="flex w-full flex-col gap-3 lg:w-[272px] lg:flex-shrink-0">
        <div className="mm-card !px-3.5 !py-3">
          <h3 className="mm-section-label !mb-2 !border-b-0 !pb-0">Today</h3>
          {todayEvents.length === 0 ? (
            <p className="text-xs text-brand-subtle">No events today.</p>
          ) : (
            <div className="space-y-2">
              {todayEvents.map((ev) => (
                <div key={ev.id} className="pl-2" style={{ borderLeft: `2px solid ${TYPE_STYLE[ev.event_type].color}` }}>
                  <p className="text-[11px] font-medium text-brand-dark">{ev.title}</p>
                  {ev.description && <p className="text-[10px] text-brand-muted">{ev.description}</p>}
                  <div className="mt-0.5">
                    <TypeBadge type={ev.event_type} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mm-card !px-3.5 !py-3">
          <h3 className="mm-section-label !mb-2 !border-b-0 !pb-0">Upcoming</h3>
          {upcomingEvents.length === 0 ? (
            <p className="text-xs text-brand-subtle">No upcoming events.</p>
          ) : (
            <div className="space-y-2.5">
              {upcomingEvents.map((ev) => {
                const d = new Date(`${ev.event_date}T00:00:00`);
                return (
                  <div key={ev.id} className="flex items-start gap-2">
                    <div className="w-8 flex-shrink-0 text-center">
                      <div className="text-[15px] font-bold leading-none text-brand-brown">{d.getDate()}</div>
                      <div className="mt-0.5 text-[9px] uppercase text-brand-subtle">
                        {d.toLocaleDateString("en-US", { month: "short" })}
                      </div>
                    </div>
                    <div className="flex-1 pl-2" style={{ borderLeft: `2px solid ${TYPE_STYLE[ev.event_type].color}` }}>
                      <p className="text-[11px] font-medium text-brand-dark">{ev.title}</p>
                      {ev.description && <p className="text-[10px] text-brand-muted">{ev.description}</p>}
                      <div className="mt-0.5">
                        <TypeBadge type={ev.event_type} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mm-card !px-3.5 !py-3">
          <h3 className="mm-section-label !mb-2 !border-b-0 !pb-0">Event types</h3>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            {CALENDAR_EVENT_TYPES.map((t) => (
              <div key={t.value} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                  style={{ background: TYPE_STYLE[t.value].color }}
                />
                <span className="text-[10px] text-brand-muted">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===================== Hover tooltip ===================== */}
      {tooltip && (
        <div
          className="pointer-events-none fixed rounded-lg border border-brand-border bg-white"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            padding: "10px 14px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            maxWidth: 220,
            zIndex: 9999,
          }}
        >
          <p className="text-xs font-semibold text-brand-dark">{tooltip.event.title}</p>
          {tooltip.event.description && (
            <p className="mt-0.5 text-[11px] text-brand-muted">{tooltip.event.description}</p>
          )}
          <div className="mt-1">
            <TypeBadge type={tooltip.event.event_type} />
          </div>
        </div>
      )}

      {/* ===================== Day detail modal ===================== */}
      {selectedDay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          style={{ backdropFilter: "blur(2px)" }}
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-[10px] border border-brand-border bg-white"
            style={{ maxWidth: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mm-modal-header !py-3">
              <h3 className="mm-modal-title !text-sm">
                {selectedDay.date.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" })}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="rounded-md p-1 text-brand-muted transition-colors hover:bg-[#F5F0E8] hover:text-brand-dark"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto p-4">
              {selectedDayEvents.length === 0 ? (
                <p className="text-sm text-brand-subtle">No events.</p>
              ) : (
                selectedDayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start justify-between gap-2 rounded-md"
                    style={{
                      borderLeft: `3px solid ${TYPE_STYLE[ev.event_type].color}`,
                      background: `${TYPE_STYLE[ev.event_type].bg}22`,
                      padding: "8px 10px",
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-brand-dark">{ev.title}</p>
                      {ev.description && <p className="mt-0.5 text-[11px] text-brand-muted">{ev.description}</p>}
                      <div className="mt-1">
                        <TypeBadge type={ev.event_type} />
                      </div>
                    </div>
                    {canManage && (
                      <button
                        onClick={() => deleteEvent(ev.id)}
                        disabled={deleteBusyId === ev.id}
                        className="flex-shrink-0 text-xs font-medium text-[#DC2626] hover:underline disabled:opacity-50"
                      >
                        {deleteBusyId === ev.id ? "..." : "Delete"}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== Add event modal ===================== */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          style={{ backdropFilter: "blur(2px)" }}
          onClick={() => !saving && setShowAddModal(false)}
        >
          <div
            className="w-full rounded-xl border border-brand-border bg-white shadow-lg"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mm-modal-header">
              <h3 className="mm-modal-title">Add Calendar Event</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-md p-1 text-brand-muted transition-colors hover:bg-[#F5F0E8] hover:text-brand-dark"
              >
                ✕
              </button>
            </div>
            <div className="mm-modal-body space-y-3">
              <div>
                <label className="mm-label">
                  Title<RequiredMark />
                </label>
                <input
                  className="mm-input"
                  value={addForm.title}
                  onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="mm-label">Description</label>
                <textarea
                  className="mm-input"
                  rows={3}
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="mm-label">
                  Date<RequiredMark />
                </label>
                <input
                  type="date"
                  className="mm-input"
                  value={addForm.event_date}
                  onChange={(e) => setAddForm((f) => ({ ...f, event_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="mm-label">Event Type</label>
                <select
                  className="mm-input"
                  value={addForm.event_type}
                  onChange={(e) => setAddForm((f) => ({ ...f, event_type: e.target.value as CalendarEventType }))}
                >
                  {CALENDAR_EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
            </div>
            <div className="mm-modal-footer">
              <button onClick={() => setShowAddModal(false)} disabled={saving} className="mm-btn-secondary">
                Cancel
              </button>
              <button onClick={submitAddEvent} disabled={saving} className="mm-btn-primary">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
