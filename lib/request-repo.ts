import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseRequest } from "@/types/database";

export class NotFoundError extends Error {
  constructor(message = "Request not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export async function getRequestOrThrow(
  admin: SupabaseClient,
  id: string,
): Promise<ExpenseRequest> {
  const { data, error } = await admin
    .from("requests")
    .select("*")
    .eq("request_id", id)
    .single();

  if (error || !data) throw new NotFoundError();
  return data as ExpenseRequest;
}

export async function updateRequest(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<ExpenseRequest> {
  const { data, error } = await admin
    .from("requests")
    .update(patch)
    .eq("request_id", id)
    .select()
    .single();

  if (error) throw error;
  return data as ExpenseRequest;
}
