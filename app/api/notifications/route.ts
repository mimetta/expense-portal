import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleApiError } from "@/lib/api-helpers";
import type { NotificationRow } from "@/types/database";

// Postgres "undefined_table" — thrown if supabase/migrations/027_notifications.sql
// isn't applied yet. Degrade to an empty bell rather than a broken Nav for
// every user in the meantime (same convention as the UNDEFINED_COLUMN
// handling elsewhere in this app for not-yet-applied migrations).
const UNDEFINED_TABLE = "42P01";

function isPostgrestLikeError(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

// Bell dropdown's single data source: most recent 30 notifications for the
// current user plus their total unread count (the count covers ALL unread,
// not just the 30 returned, so the badge stays accurate even once someone
// has more than 30 unread).
export async function GET() {
  try {
    const user = await requireUser();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("notifications")
      .select("*")
      .eq("user_email", user.email)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      if (isPostgrestLikeError(error) && error.code === UNDEFINED_TABLE) {
        return NextResponse.json({ notifications: [], unreadCount: 0 });
      }
      throw error;
    }

    const { count, error: countError } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_email", user.email)
      .eq("is_read", false);
    if (countError) throw countError;

    return NextResponse.json({
      notifications: (data ?? []) as NotificationRow[],
      unreadCount: count ?? 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
