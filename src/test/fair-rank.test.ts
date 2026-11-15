import { describe, expect, it } from "vitest";

import { FAIR_PROMISES, hoursText, rankTier, rankTips, type MyFairRank } from "@/lib/fair-rank-api";

const rules: MyFairRank["rules"] = {
  version: 1,
  max: 100,
  trust: { max: 50, by_level: { "0": 0, "1": 30, "2": 42, "3": 50 } },
  response: {
    max: 25,
    answered_weight: 0.5,
    speed_weight: 0.5,
    speed_bands: [
      { within_hours: 4, score: 1 },
      { within_hours: 24, score: 0.8 },
    ],
    slower_score: 0.1,
  },
  delivery: { max: 25 },
  window_days: 180,
  prior: 0.5,
  prior_weight: 5,
  min_samples: 3,
  tie_band: 1,
};

const rank = (over: Partial<MyFairRank> = {}): MyFairRank => ({
  day: "2026-11-15",
  level: 1,
  ranked: true,
  is_new: false,
  score: 60,
  ahead_of_pct: 50,
  verified_suppliers: 10,
  trust: { points: 30, max: 50 },
  response: { points: 20, max: 25, rfqs_counted: 10, answered: 10, quoted: 10, median_hours: 3 },
  delivery: { points: 20, max: 25, orders_counted: 10, on_time: 10 },
  rules,
  ...over,
});

describe("fair rank wording", () => {
  it("says reply times in plain words", () => {
    expect(hoursText(null)).toBe("Not enough replies yet");
    expect(hoursText(0.4)).toBe("under an hour");
    expect(hoursText(1)).toBe("about 1 hour");
    expect(hoursText(3.2)).toBe("about 3 hours");
    expect(hoursText(24)).toBe("about 1 day");
    expect(hoursText(100)).toBe("about 4 days");
  });

  it("names a tier from the score, and none when there is no score", () => {
    expect(rankTier(null)).toBeNull();
    expect(rankTier(90)).toBe("Excellent");
    expect(rankTier(70)).toBe("Strong");
    expect(rankTier(55)).toBe("Building");
    expect(rankTier(30)).toBe("Getting started");
  });
});

describe("what would raise a supplier's rank", () => {
  it("tells an unverified supplier to get verified, and nothing else", () => {
    const t = rankTips(rank({ ranked: false, level: 0, score: null }));
    expect(t.map((x) => x.id)).toEqual(["verify"]);
  });

  it("never suggests spending money", () => {
    const all = [
      rankTips(rank({ level: 1, response: { points: 5, max: 25, rfqs_counted: 10, answered: 2, quoted: 1, median_hours: 90 }, delivery: { points: 5, max: 25, orders_counted: 4, on_time: 1 } })),
      rankTips(rank({ level: 2 })),
      rankTips(rank({ is_new: true, response: { points: 12.5, max: 25, rfqs_counted: 0, answered: 0, quoted: 0, median_hours: null }, delivery: { points: 12.5, max: 25, orders_counted: 0, on_time: 0 } })),
    ].flat();
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) expect(`${t.title} ${t.body}`).not.toMatch(/\b(pay|paid|buy|subscription|upgrade|sponsor|boost|credit|₹|rs\.?)\b/i);
  });

  it("gives at most three tips, biggest first", () => {
    const t = rankTips(
      rank({
        level: 1,
        response: { points: 4, max: 25, rfqs_counted: 10, answered: 3, quoted: 2, median_hours: 80 },
        delivery: { points: 3, max: 25, orders_counted: 5, on_time: 1 },
      }),
    );
    expect(t.length).toBeLessThanOrEqual(3);
    expect(t.length).toBeGreaterThan(0);
  });

  it("points a level 1 supplier to more proofs and a level 2 supplier to a certificate", () => {
    expect(rankTips(rank({ level: 1 })).some((x) => x.id === "trust" && /address and a bank/i.test(x.title))).toBe(true);
    expect(rankTips(rank({ level: 2 })).some((x) => x.id === "trust" && /certificate/i.test(x.title))).toBe(true);
    expect(rankTips(rank({ level: 3 })).some((x) => x.id === "trust")).toBe(false);
  });

  it("a newcomer is told to answer and deliver once, not that they are bad", () => {
    const t = rankTips(
      rank({
        is_new: true,
        level: 3,
        response: { points: 12.5, max: 25, rfqs_counted: 0, answered: 0, quoted: 0, median_hours: null },
        delivery: { points: 12.5, max: 25, orders_counted: 0, on_time: 0 },
      }),
    );
    expect(t.map((x) => x.id).sort()).toEqual(["first-delivery", "first-reply"]);
  });

  it("a supplier with a perfect record gets no nagging", () => {
    expect(rankTips(rank({ level: 3, trust: { points: 50, max: 50 } }))).toEqual([]);
  });
});

describe("the promises", () => {
  it("state the two things that set Vendora apart: no paid rank and no selling of leads", () => {
    const text = FAIR_PROMISES.map((p) => `${p.title} ${p.body}`).join(" ").toLowerCase();
    expect(text).toContain("can't be bought");
    expect(text).toContain("no selling of leads");
    expect(FAIR_PROMISES.length).toBe(5);
  });
});
