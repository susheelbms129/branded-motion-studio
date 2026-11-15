import type { FairRankRules } from "@/lib/fair-rank-api";

/**
 * How fast a supplier answered (or is answering) an RFQ, in the terms Fair Rank uses (migration 18): replies within 4 hours
 * earn full speed points, within 24 hours most of them, and so on. Pure, so a test can prove it. Showing this on the quote
 * page turns "be quick" into something a supplier can see and act on, and it can never be bought.
 */

export interface SpeedStatus {
  /** Hours from the RFQ arriving to the reply (done) or to now (still open). */
  elapsedHours: number;
  done: boolean;
  /** Share of the speed points this reply earns (done), or earns if sent now (open). 0 to 100. */
  pct: number;
  /** Open only: hours left before the reply drops to the next, lower band. Null when already in the slowest band. */
  hoursLeft: number | null;
  /** The band edge in hours (4, 24, 72, 168) this reply sits in. Null for the slowest band. */
  band: number | null;
  /** Open only: the share of points in the next, lower band, for the "after that" line. */
  nextPct: number | null;
}

const hoursBetween = (a: string, b: string): number | null => {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.max(0, (y - x) / 3_600_000);
};

/** Null when the times cannot be read. `respondedAt` set means the supplier already answered. */
export function speedStatus(
  sentAt: string,
  respondedAt: string | null,
  now: Date,
  rules: FairRankRules,
): SpeedStatus | null {
  const done = respondedAt !== null;
  const elapsed = hoursBetween(sentAt, done ? respondedAt : now.toISOString());
  if (elapsed === null) return null;
  const bands = [...rules.response.speed_bands].sort((a, b) => a.within_hours - b.within_hours);
  const i = bands.findIndex((b) => elapsed <= b.within_hours);
  if (i === -1) {
    return { elapsedHours: elapsed, done, pct: Math.round(rules.response.slower_score * 100), hoursLeft: null, band: null, nextPct: null };
  }
  const b = bands[i]!;
  const next = bands[i + 1];
  return {
    elapsedHours: elapsed,
    done,
    pct: Math.round(b.score * 100),
    hoursLeft: done ? null : b.within_hours - elapsed,
    band: b.within_hours,
    nextPct: next ? Math.round(next.score * 100) : Math.round(rules.response.slower_score * 100),
  };
}

/** "12 minutes", "3 hours", "2 days": rounded the way a person would say it. */
export function durationText(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "a moment";
  const mins = Math.round(hours * 60);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} ${mins === 1 ? "minute" : "minutes"}`;
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const d = Math.round(hours / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

/** One honest line for the supplier. */
export function speedMessage(s: SpeedStatus): string {
  if (s.done) {
    return s.pct >= 100
      ? `You replied in ${durationText(s.elapsedHours)}. That is the fastest band: full speed points in your Fair Rank.`
      : `You replied in ${durationText(s.elapsedHours)}, worth ${s.pct}% of the speed points in your Fair Rank.`;
  }
  if (s.hoursLeft === null) {
    return `This request is over a week old, so a quote now earns ${s.pct}% of the speed points. It still counts as an answer.`;
  }
  const left = durationText(s.hoursLeft);
  return s.pct >= 100
    ? `Quote within ${left} for full speed points in your Fair Rank.`
    : `Quote within ${left} to keep ${s.pct}% of the speed points. After that it drops to ${s.nextPct}%.`;
}
