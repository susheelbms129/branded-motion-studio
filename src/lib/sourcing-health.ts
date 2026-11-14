import { differenceInCalendarDays, parseISO } from "date-fns";

import type { DirectorySupplier } from "@/lib/directory-api";

/**
 * "Trust watch": which suppliers on a buyer's shortlist need a second look before an order goes out.
 * Pure on purpose (no network, no clock unless passed in) so it is easy to test and can never leak anything:
 * it only reorganises facts the directory already returned for this company.
 */
export type WatchKind = "unverified" | "expiring";

export interface WatchItem {
  supplier: DirectorySupplier;
  kind: WatchKind;
  /** Days left on the earliest-expiring proof. Only set for `expiring`. */
  daysLeft?: number;
}

export const EXPIRY_WINDOW_DAYS = 30;

export function trustWatch(
  suppliers: readonly DirectorySupplier[],
  today: Date = new Date(),
  windowDays: number = EXPIRY_WINDOW_DAYS,
): WatchItem[] {
  const out: WatchItem[] = [];
  for (const s of suppliers) {
    if (s.level === 0) {
      out.push({ supplier: s, kind: "unverified" });
      continue;
    }
    if (!s.valid_through) continue;
    const end = parseISO(s.valid_through);
    if (Number.isNaN(end.getTime())) continue;
    const daysLeft = differenceInCalendarDays(end, today);
    // Proofs that already ended never count in the directory, so only "ending soon" can show up here.
    if (daysLeft >= 0 && daysLeft <= windowDays) out.push({ supplier: s, kind: "expiring", daysLeft });
  }
  // Soonest expiry first, then the ones with nothing verified, then by name for a stable order.
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "expiring" ? -1 : 1;
    if (a.kind === "expiring" && a.daysLeft !== b.daysLeft) return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
    return a.supplier.name.localeCompare(b.supplier.name);
  });
}

/** Level 2 and 3 are the "Verified" levels. Level 1 is only "Registered". */
export const isVerified = (s: Pick<DirectorySupplier, "level">) => s.level >= 2;

export function watchLabel(w: WatchItem): string {
  if (w.kind === "unverified") return "Not verified yet";
  const d = w.daysLeft ?? 0;
  if (d === 0) return "Proof ends today";
  return d === 1 ? "Proof ends tomorrow" : `Proof ends in ${d} days`;
}
