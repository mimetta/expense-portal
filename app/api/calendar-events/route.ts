import { NextResponse } from "next/server";
import { requireUser, ForbiddenError } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import { hasAnyRole } from "@/lib/permissions";
import { CALENDAR_EVENT_TYPES, CALENDAR_MANAGE_ROLES } from "@/lib/constants";
import type { CalendarEventType } from "@/types/database";

// Same "table not in schema cache" code used by /api/announcements — what
// PostgREST returns before supabase/migrations/010_calendar_events.sql has
// been applied to the live database. See that route for the full
// explanation of why this degrades gracefully instead of 500ing.
const TABLE_NOT_FOUND = "PGRST205";

const VALID_EVENT_TYPES = new Set<CalendarEventType>(CALENDAR_EVENT_TYPES.map((t) => t.value));

// Homepage calendar (see CLAUDE.md "Homepage Calendar"). Any signed-in
// user can read events; ?month=YYYY-MM narrows to that calendar month
// (CalendarWidget refetches on every prev/next-month navigation rather
// than loading the whole table up front). Create/delete are restricted to
// SUPERADMIN/ACCOUNTING/CEO/PROCUREMENT — the same finance/ops-facing role
// set already used for /dashboard access (see lib/permissions.ts).
export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");

    const admin = createAdminClient();
    let query = admin.from("calendar_events").select("*").order("event_date", { ascending: true });

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mm] = month.split("-").map(Number);
      const start = `${month}-01`;
      const endDate = new Date(year, mm, 0).getDate();
      const end = `${month}-${String(endDate).padStart(2, "0")}`;
      query = query.gte("event_date", start).lte("event_date", end);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json({ events: [] });
      }
      throw error;
    }
    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

interface CreateCalendarEventBody {
  title?: string;
  description?: string;
  event_date?: string;
  event_type?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!hasAnyRole(user, CALENDAR_MANAGE_ROLES)) throw new ForbiddenError();

    const body = (await request.json()) as CreateCalendarEventBody;
    if (!body.title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!body.event_date?.trim()) {
      return NextResponse.json({ error: "event_date is required" }, { status: 400 });
    }
    const eventType = (body.event_type || "general") as CalendarEventType;
    if (!VALID_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ error: `Invalid event_type: ${body.event_type}` }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("calendar_events")
      .insert({
        title: body.title,
        description: body.description || null,
        event_date: body.event_date,
        event_type: eventType,
        created_by: user.email,
      })
      .select()
      .single();

    if (error) {
      if (error.code === TABLE_NOT_FOUND) {
        return NextResponse.json(
          { error: "Calendar events aren't available yet — ask an admin to apply migration 010." },
          { status: 503 },
        );
      }
      throw error;
    }
    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
