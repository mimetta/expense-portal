import { createAdminClient } from "@/lib/supabase/admin";

export async function logAudit(
  actorEmail: string,
  requestId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
) {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    actor_email: actorEmail,
    request_id: requestId,
    action,
    detail_json: detail,
  });
  if (error) {
    console.error("Failed to write audit log:", error);
  }
}
