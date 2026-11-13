import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only. Talks to the database AS THE SIGNED-IN USER by forwarding their access token, so
 * Row Level Security and the permission checks inside the database functions apply to every call.
 * The service-role key is deliberately NOT used: this server can never do more than the caller could.
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
