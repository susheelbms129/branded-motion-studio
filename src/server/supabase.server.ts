import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only. Talks to the database AS THE SIGNED-IN USER by forwarding their access token, so
 * Row Level Security and the permission checks inside the database functions apply to every call.
 * The service-role key is deliberately NOT used here: this server can never do more than the caller could.
 * The one exception is serviceClient() below, for the WhatsApp sender job and webhook, which have no signed-in caller.
 */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

export function userClient(accessToken: string): SupabaseClient {
  const url = process.env["SUPABASE_URL"] ?? env["VITE_SUPABASE_URL"];
  const anon = process.env["SUPABASE_ANON_KEY"] ?? env["VITE_SUPABASE_ANON_KEY"];
  if (!url || !anon) throw new Error("Supabase is not configured");
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Server-only, for the two WhatsApp routes (sender job and webhook) and nothing else. A background job has no signed-in
 * person to act as, so it uses the service role, but it can only call four database functions that are granted to that role
 * and that do exactly one thing each (claim due messages, record a result, record a delivery status, pause by phone).
 * Never use this from a route that a person calls.
 */
export function serviceClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"] ?? env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Supabase service role is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
