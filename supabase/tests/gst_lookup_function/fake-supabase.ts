// Stand-in for supabase-js: records what the function asks the database to do.
export const calls: { who: string; fn: string; args: Record<string, unknown> }[] = [];
export const script = { gate: { data: "29AABCT1332L1ZN", error: null } as { data: unknown; error: { message: string } | null } };
export function createClient(_url: string, key: string, _opts?: unknown) {
  const who = key === "SERVICE" ? "service" : "user";
  return { rpc: (fn: string, args: Record<string, unknown>) => {
    calls.push({ who, fn, args });
    return Promise.resolve(fn === "request_gst_lookup" ? script.gate : { data: null, error: null });
  } };
}
