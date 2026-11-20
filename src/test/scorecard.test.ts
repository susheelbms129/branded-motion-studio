import { describe, expect, it } from "vitest";

import {
  badgeProgress, deliveryHeadline, deliverySegments, monthLabel, monthOnTimePct, monthYear, nextBadge, outcomeText, replyHeadline, scorecardError,
  type Scorecard, type ScorecardBadge,
} from "@/lib/scorecard-api";

const del = (o: Partial<Scorecard["delivery"]> = {}): Scorecard["delivery"] => ({
  orders_counted: 0, delivered: 0, on_time: 0, early: 0, late_1_3: 0, late_4_plus: 0, on_time_pct: null, median_days_vs_promise: null, cancelled_after_confirming: 0, ...o,
});
const rep = (o: Partial<Scorecard["replies"]> = {}): Scorecard["replies"] => ({ rfqs_counted: 0, answered: 0, quoted: 0, answered_pct: null, median_hours: null, within_24h_pct: null, ...o });
const badge = (o: Partial<ScorecardBadge> = {}): ScorecardBadge => ({ key: "on_time_record", title: "On-time record", rule: "r", earned: false, have: 4, need: 10, unit: "orders", ...o });

describe("months", () => {
  it("labels", () => {
    expect(monthLabel("2026-11")).toBe("Nov");
    expect(monthLabel("2026-01")).toBe("Jan");
    expect(monthYear("2026-03")).toBe("Mar 2026");
    expect(monthLabel("garbage")).toBe("garbage");
    expect(monthLabel("2026-13")).toBe("2026-13");
  });
  it("on-time share of a month keeps an empty month empty", () => {
    expect(monthOnTimePct({ orders: 0, on_time: 0 })).toBeNull();
    expect(monthOnTimePct({ orders: 4, on_time: 3 })).toBe(75);
    expect(monthOnTimePct({ orders: 3, on_time: 3 })).toBe(100);
  });
});

describe("results in words", () => {
  it("says early, on time, late and cancelled", () => {
    expect(outcomeText({ outcome: "early", days: 2 })).toBe("Delivered 2 days early");
    expect(outcomeText({ outcome: "early", days: 1 })).toBe("Delivered 1 day early");
    expect(outcomeText({ outcome: "on_time", days: 0 })).toBe("Delivered on the promised day");
    expect(outcomeText({ outcome: "late", days: 5 })).toBe("Delivered 5 days late");
    expect(outcomeText({ outcome: "cancelled", days: null })).toMatch(/cancelled by the supplier/);
  });
});

describe("headlines never claim more than the data allows", () => {
  it("delivery", () => {
    expect(deliveryHeadline(del())).toBe("No deliveries yet");
    expect(deliveryHeadline(del({ delivered: 2, on_time: 2 }))).toMatch(/2 deliveries so far/);
    expect(deliveryHeadline(del({ delivered: 1 }))).toMatch(/1 delivery so far/);
    expect(deliveryHeadline(del({ delivered: 5, on_time: 4, on_time_pct: 80 }))).toBe("80% on time");
  });
  it("replies", () => {
    expect(replyHeadline(rep())).toBe("No quotes yet");
    expect(replyHeadline(rep({ quoted: 2 }))).toMatch(/2 quotes so far/);
    expect(replyHeadline(rep({ quoted: 5, median_hours: 0.5 }))).toBe("Replies in under an hour");
    expect(replyHeadline(rep({ quoted: 5, median_hours: 3.5 }))).toBe("Replies in about 3.5 hours");
    expect(replyHeadline(rep({ quoted: 5, median_hours: 30.4 }))).toBe("Replies in about 30 hours");
  });
});

describe("the delivery spread", () => {
  it("splits early from exactly on time and drops empty parts", () => {
    const s = deliverySegments(del({ delivered: 8, on_time: 6, early: 2, late_1_3: 1, late_4_plus: 1 }));
    expect(s.map((x) => [x.key, x.n])).toEqual([["early", 2], ["on_time", 4], ["late_1_3", 1], ["late_4_plus", 1]]);
    expect(deliverySegments(del({ delivered: 3, on_time: 3 })).map((x) => x.key)).toEqual(["on_time"]);
    expect(deliverySegments(del())).toEqual([]);
  });
  it("never shows a negative part", () => {
    expect(deliverySegments(del({ delivered: 2, on_time: 1, early: 2 })).every((x) => x.n > 0)).toBe(true);
  });
});

describe("badge progress (the supplier's own view)", () => {
  it("shows how far and how much is left", () => {
    expect(badgeProgress(badge())).toEqual({ pct: 40, left: "6 more orders" });
    expect(badgeProgress(badge({ have: 0 }))).toEqual({ pct: 0, left: "10 more orders" });
  });
  it("is empty for an earned badge or when the database sent no progress", () => {
    expect(badgeProgress(badge({ earned: true }))).toBeNull();
    const b = badge(); delete b.have; delete b.need;
    expect(badgeProgress(b)).toBeNull();
  });
  it("a badge with enough events but a standard not yet met says so", () => {
    expect(badgeProgress(badge({ have: 12 }))?.left).toMatch(/keep the standard up/);
    expect(badgeProgress(badge({ have: 12 }))?.pct).toBe(100);
  });
  it("picks the nearest unearned badge", () => {
    const a = badge({ key: "fast_replies", title: "Fast replies", have: 1, need: 5 });
    const b = badge({ key: "repeat_buyers", title: "Buyers come back", have: 2, need: 3 });
    const c = badge({ key: "clean_record", title: "Never walked away", earned: true });
    expect(nextBadge([a, b, c])?.title).toBe("Buyers come back");
    expect(nextBadge([c])).toBeNull();
    expect(nextBadge([])).toBeNull();
  });
});

describe("errors", () => {
  it("are sentences", () => {
    expect(scorecardError(new Error("not_allowed"))).toMatch(/isn't available/);
    expect(scorecardError({ message: "Could not find the function public.get_supplier_scorecard" })).toMatch(/migration 21/);
    expect(scorecardError(new Error("boom"))).toMatch(/try again/);
  });
});
