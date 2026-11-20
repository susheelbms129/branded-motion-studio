import { describe, expect, it } from "vitest";

import { detail, headline, nextStep, toneOf, type QuoteInsightRow } from "@/lib/quote-insights";

const row = (o: Partial<QuoteInsightRow> = {}): QuoteInsightRow => ({
  po_id: "p1",
  po_number: "PO-2026-0001",
  title: "Steel rods",
  rfq_id: "r1",
  issued_at: null,
  quotes: 3,
  paid: 108000,
  average: 100000,
  cheapest: 92000,
  dearest: 108000,
  rank: 3,
  pct_vs_average: 8,
  diff_vs_average: 8000,
  extra_vs_cheapest: 16000,
  saved_vs_dearest: 0,
  ...o,
});

describe("paid vs quotes", () => {
  it("flags 8% or more above the average, and 15% or more as high", () => {
    expect(toneOf(row({ pct_vs_average: 7.9 }))).toBe("neutral");
    expect(toneOf(row({ pct_vs_average: 8 }))).toBe("medium");
    expect(toneOf(row({ pct_vs_average: 15 }))).toBe("high");
  });
  it("celebrates paying clearly below the average", () => {
    expect(toneOf(row({ pct_vs_average: -3 }))).toBe("good");
    expect(headline(row({ pct_vs_average: -12 }))).toBe("You paid 12% below the average quote");
    expect(nextStep(row({ pct_vs_average: -12 }))).toBeNull();
  });
  it("says it in plain words", () => {
    expect(headline(row())).toBe("You paid 8% above the average quote");
    expect(headline(row({ pct_vs_average: 1 }))).toBe("You paid about the average quote");
  });
  it("shows the cheaper quote that existed, without calling the choice wrong", () => {
    const d = detail(row());
    expect(d).toContain("3 quotes were compared");
    expect(d).toContain("₹16,000 cheaper");
    expect(d).toContain("may have been good reasons");
    expect(d).toContain("₹8,000 more than the average of ₹1,00,000");
  });
  it("when the cheapest was chosen, says so and does not mention a cheaper quote", () => {
    const d = detail(row({ rank: 1, extra_vs_cheapest: 0, pct_vs_average: -8, diff_vs_average: -8000, paid: 92000 }));
    expect(d).toContain("You chose the cheapest quote.");
    expect(d).not.toContain("cheaper was available");
    expect(d).toContain("less than the average");
  });
  it("only suggests a next step when something was above average", () => {
    expect(nextStep(row())).toContain("match the lowest quote");
    expect(nextStep(row({ pct_vs_average: 2 }))).toBeNull();
  });
});
