import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Only the project URL and the public anon key belong here. They are safe in the browser because
// every table is protected by Row Level Security. Never put the service-role key in this file.
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  if (!client) {
    const browser = typeof window !== "undefined";
    client = createClient(url, anonKey, {
      auth: {
        flowType: "pkce",
        persistSession: browser,
        autoRefreshToken: browser,
        detectSessionInUrl: browser,
      },
    });
  }
  return client;
}
