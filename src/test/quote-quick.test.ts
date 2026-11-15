import { describe, expect, it } from "vitest";

import type { FairRankRules } from "@/lib/fair-rank-api";
import { sourceLabel, startForm, toDefaults, validateQuote } from "@/lib/quote-form";
import { durationText, speedMessage, speedStatus } from "@/lib/quote-speed";
import type { ProductSuggestion, QuoteItem, QuoteRequestDetail } from "@/lib/quote-requests-api";

const TODAY = new Date(2026, 10, 15, 12, 0, 0);

const sug = (over: Partial<ProductSuggestion> = {}): ProductSuggestion => ({
  product_id: "p1",
  name: "Mild Steel Plate 10 mm",
  price: 1500,
  unit: "Sheet",
  moq: null,
  availability: "Available",
  source: "product",
  confidence: "exact",
  quoted_on: null,
  unit_ok: true,
  auto: true,
  clean: true,
  ...over,
});
const item = (id: string, over: Partial<QuoteItem> = {}): QuoteItem => ({
  id,
  description: "MS plate 10mm",
  qty: 10,
  unit: "Sheet",
  suggestion: sug(),
  ...over,
});
const detail = (items: QuoteItem[], over: Partial<QuoteRequestDetail> = {}): QuoteRequestDetail => ({
  rfq: { id: "r", number: "RFQ-1", title: "t", category: "", due_date: null, notes: "", currency: "INR", open: true, invited: 2 },
  buyer: { name: "B", city: "", state: "" },
  invite: { status: "sent", state: "open", sent_at: "2026-11-15T08:00:00Z", viewed_at: null, responded_at: null, decline_reason: "", level_at_send: 1 },
  items,
  quote: null,
  last_terms: null,
  defaults: null,
  can_respond: true,
  ...over,
});

describe("quote in 60 seconds: what is filled in", () => {
  it("fills in confident matches and is ready in one tap when everything is clean", () => {
    const s = startForm(detail([item("a"), item("b", { suggestion: sug({ price: 210, unit: "Sheet" }) })]), TODAY);
    expect(s.form.prices).toEqual({ a: "1500", b: "210" });
    expect(s.prefilled).toEqual(["a", "b"]);
    expect(s.oneTap).toBe(true);
  });

  it("does not fill in a loose match, but offers it", () => {
    const s = startForm(detail([item("a", { suggestion: sug({ confidence: "possible", auto: false, clean: false }) })]), TODAY);
    expect(s.form.prices).toEqual({});
    expect(s.possible).toEqual(["a"]);
    expect(s.oneTap).toBe(false);
  });

  it("does not fill in a price per a different unit", () => {
    const s = startForm(detail([item("a", { suggestion: sug({ unit: "Kg", unit_ok: false, auto: false, clean: false }) })]), TODAY);
    expect(s.prefilled).toEqual([]);
    expect(s.unitMismatch).toEqual(["a"]);
    expect(s.possible).toEqual([]);
  });

  it("is not one tap when the buyer wants less than the minimum order", () => {
    const s = startForm(detail([item("a", { suggestion: sug({ moq: 20, clean: false }) })]), TODAY);
    expect(s.prefilled).toEqual(["a"]);
    expect(s.oneTap).toBe(false);
  });

  it("is not one tap when even one item has no price", () => {
    const s = startForm(detail([item("a"), item("b", { suggestion: null })]), TODAY);
    expect(s.prefilled).toEqual(["a"]);
    expect(s.oneTap).toBe(false);
  });

  it("never claims one tap with no items", () => {
    expect(startForm(detail([]), TODAY).oneTap).toBe(false);
  });

  it("still works with an older database that does not say how sure it is", () => {
    const old: ProductSuggestion = { product_id: "p", name: "x", price: 90.5, unit: "Sheet", moq: 10, availability: "Available" };
    const s = startForm(detail([item("a", { suggestion: old })]), TODAY);
    expect(s.form.prices).toEqual({ a: "90.5" });
    expect(s.oneTap).toBe(true); // moq 10 is not above qty 10, so it is clean
  });

  it("an older database: a different unit is a mismatch, a matching one fills in", () => {
    const kg: ProductSuggestion = { product_id: "p", name: "x", price: 5, unit: "Kg", moq: null, availability: "Available" };
    expect(startForm(detail([item("a", { suggestion: kg })]), TODAY).unitMismatch).toEqual(["a"]);
  });

  it("a quote already sent is never overwritten by suggestions, and is never one tap", () => {
    const d = detail([item("a")], {
      quote: { id: "q", revision: 1, received_at: "", gst_rate: 12, shipping: 5, other_charges: 0, delivery_days: 4, payment_terms_days: 10, valid_until: "2026-12-01", notes: "n", amounts: null, lines: [{ item_id: "a", unit_price: 1234 }] },
    });
    const s = startForm(d, TODAY);
    expect(s.form.prices).toEqual({ a: "1234" });
    expect(s.oneTap).toBe(false);
    expect(s.prefilled).toEqual([]);
  });
});

describe("quote in 60 seconds: the terms", () => {
  it("start from the saved usual terms first", () => {
    const d = detail([item("a")], {
      defaults: { gst_rate: 12, delivery_days: 5, payment_terms_days: 45, valid_days: 10, shipping: 250, other_charges: 20.5, notes: "Ex-works Pune." },
      last_terms: { gst_rate: 5, payment_terms_days: 1, delivery_days: 1 },
    });
    const s = startForm(d, TODAY);
    expect(s.usedDefaults).toBe(true);
    expect(s.form).toMatchObject({ gstRate: "12", deliveryDays: "5", paymentTermsDays: "45", shipping: "250", otherCharges: "20.5", notes: "Ex-works Pune.", validUntil: "2026-11-25" });
  });

  it("fall back to the last quote, then to sensible defaults", () => {
    const a = startForm(detail([item("a")], { last_terms: { gst_rate: 5, payment_terms_days: 45, delivery_days: 3 } }), TODAY);
    expect(a.usedDefaults).toBe(false);
    expect(a.form).toMatchObject({ gstRate: "5", paymentTermsDays: "45", deliveryDays: "3", shipping: "0", validUntil: "2026-11-30" });
    const b = startForm(detail([item("a")]), TODAY);
    expect(b.form).toMatchObject({ gstRate: "18", paymentTermsDays: "30", deliveryDays: "7" });
  });

  it("a one-tap form passes the same checks as a typed one", () => {
    const d = detail([item("a")]);
    expect(validateQuote(startForm(d, TODAY).form, d.items, TODAY)).toEqual({});
  });

  it("the form's terms can be saved as the usual terms", () => {
    const f = startForm(detail([item("a")], { defaults: { gst_rate: 12, delivery_days: 5, payment_terms_days: 45, valid_days: 10, shipping: 250, other_charges: 20.5, notes: "  Ex-works  " } }), TODAY).form;
    expect(toDefaults(f, TODAY)).toEqual({ gstRate: 12, deliveryDays: 5, paymentTermsDays: 45, validDays: 10, shipping: 250, otherCharges: 20.5, notes: "Ex-works" });
  });

  it("the saved validity is kept between 1 and 365 days", () => {
    const f = startForm(detail([item("a")]), TODAY).form;
    expect(toDefaults({ ...f, validUntil: "2026-11-15" }, TODAY).validDays).toBe(1);
    expect(toDefaults({ ...f, validUntil: "2028-01-01" }, TODAY).validDays).toBe(365);
  });
});

describe("where a price came from", () => {
  it("says so in plain words", () => {
    expect(sourceLabel(sug(), TODAY)).toBe("From your product list: Mild Steel Plate 10 mm");
    expect(sourceLabel(sug({ source: "past_quote", quoted_on: "2026-11-15" }), TODAY)).toBe("From a quote you sent today");
    expect(sourceLabel(sug({ source: "past_quote", quoted_on: "2026-11-14" }), TODAY)).toBe("From your quote yesterday");
    expect(sourceLabel(sug({ source: "past_quote", quoted_on: "2026-11-03" }), TODAY)).toBe("From your quote 12 days ago");
    expect(sourceLabel(sug({ source: "past_quote", quoted_on: null }), TODAY)).toBe("From a quote you sent before");
  });
});

const rules = {
  response: {
    max: 25,
    answered_weight: 0.5,
    speed_weight: 0.5,
    speed_bands: [
      { within_hours: 4, score: 1 },
      { within_hours: 24, score: 0.8 },
      { within_hours: 72, score: 0.5 },
      { within_hours: 168, score: 0.25 },
    ],
    slower_score: 0.1,
  },
} as unknown as FairRankRules;

describe("reply speed, in Fair Rank terms", () => {
  const sent = "2026-11-15T08:00:00Z";
  it("shows the time left in the current band while the request is open", () => {
    const s = speedStatus(sent, null, new Date("2026-11-15T09:00:00Z"), rules)!;
    expect(s).toMatchObject({ done: false, pct: 100, band: 4, nextPct: 80 });
    expect(s.hoursLeft).toBeCloseTo(3, 5);
    expect(speedMessage(s)).toBe("Quote within 3 hours for full speed points in your Fair Rank.");
  });

  it("warns when the reply is about to drop to a lower band", () => {
    const s = speedStatus(sent, null, new Date("2026-11-15T13:00:00Z"), rules)!;
    expect(s.pct).toBe(80);
    expect(speedMessage(s)).toBe("Quote within 19 hours to keep 80% of the speed points. After that it drops to 50%.");
  });

  it("is honest when the request is over a week old, and says it still counts as an answer", () => {
    const s = speedStatus(sent, null, new Date("2026-11-30T08:00:00Z"), rules)!;
    expect(s).toMatchObject({ pct: 10, hoursLeft: null, band: null });
    expect(speedMessage(s)).toContain("still counts as an answer");
  });

  it("reports a finished reply from the first reply time", () => {
    const fast = speedStatus(sent, "2026-11-15T08:12:00Z", new Date("2026-12-01T00:00:00Z"), rules)!;
    expect(fast).toMatchObject({ done: true, pct: 100 });
    expect(speedMessage(fast)).toBe("You replied in 12 minutes. That is the fastest band: full speed points in your Fair Rank.");
    const slow = speedStatus(sent, "2026-11-16T08:00:00Z", new Date("2026-12-01T00:00:00Z"), rules)!;
    expect(speedMessage(slow)).toBe("You replied in 1 day, worth 80% of the speed points in your Fair Rank.");
  });

  it("never reads a bad date as a time", () => {
    expect(speedStatus("nope", null, new Date(), rules)).toBeNull();
    expect(speedStatus(sent, "nope", new Date(), rules)).toBeNull();
  });

  it("a reply 'before' the request arrived counts as instant, not negative", () => {
    expect(speedStatus(sent, "2026-11-15T07:00:00Z", new Date(), rules)!.elapsedHours).toBe(0);
  });

  it("says durations like a person", () => {
    expect(durationText(0)).toBe("under a minute");
    expect(durationText(1 / 60)).toBe("1 minute");
    expect(durationText(0.5)).toBe("30 minutes");
    expect(durationText(1)).toBe("1 hour");
    expect(durationText(5.4)).toBe("5 hours");
    expect(durationText(24)).toBe("1 day");
    expect(durationText(72)).toBe("3 days");
    expect(durationText(-1)).toBe("a moment");
  });
});
