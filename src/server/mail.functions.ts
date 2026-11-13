// This file used to be a second copy of src/lib/mail.functions.ts, including the old invitation
// functions that had no login check. It now just re-exports the one real implementation so there
// is a single place where server functions (and their security checks) live.
export * from "@/lib/mail.functions";
