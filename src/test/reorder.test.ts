import { describe, expect, it } from "vitest";

import {
  blockerText,
  deliveryText,
  deliveryTone,
  dueText,
  dueTone,
  estimateTotal,
  needsOwner,
  parseQty,
  priceChangePct,
  priceChangeText,
  reorderError,
  rhythmText,
  type Rhythm,
} from "@/lib/reorder-api";

const rh = (o: Partial<Rhythm> = {}): Rhythm => ({
  orders: 3,
  last_order_on: "2026-11-10",
  gap_days: 30,
  next_due: "2026-12-10",
  days_until: 20,
  ...o,
});

describe("the last delivery in words", () => {
  it("says late, early, on the day and unknown", () => {
    expect(deliveryText(2)).toBe("Last delivery came 2 days late.");
    expect(deliveryText(1)).toBe("Last delivery came 1 day late.");
    expect(deliveryText(-3)).toBe("Last delivery came 3 days early.");
    expect(deliveryText(0)).toBe("Last delivery came on the promised day.");
    expect(deliveryText(null)).toBe("Last delivery date wasn't recorded.");
  });
  it("colours it", () => {
    expect(deliveryTone(-1)).toBe("good");
    expect(deliveryTone(0)).toBe("good");
    expect(deliveryTone(3)).toBe("warn");
    expect(deliveryTone(4)).toBe("bad");
    expect(deliveryTone(null)).toBe("none");
  });
});

describe("when the next order is due", () => {
  it("words the distance", () => {
    expect(dueText(6)).toBe("Due in 6 days");
    expect(dueText(1)).toBe("Due tomorrow");
    expect(dueText(0)).toBe("Due today");
    expect(dueText(-9)).toBe("9 days late");
    expect(dueText(-1)).toBe("1 day late");
    expect(dueText(null)).toBeNull();
  });
  it("colours it", () => {
    expect(dueTone(-1)).toBe("late");
    expect(dueTone(0)).toBe("soon");
    expect(dueTone(14)).toBe("soon");
    expect(dueTone(15)).toBe("later");
    expect(dueTone(null)).toBe("none");
  });
  it("explains the rhythm, or says it is still learning", () => {
    expect(rhythmText(rh())).toBe("You usually reorder this every 30 days (3 orders so far).");
    expect(rhythmText(rh({ orders: 2, gap_days: 1 }))).toBe(
      "You usually reorder this every 1 day (2 orders so far).",
    );
    expect(rhythmText(rh({ orders: 1, gap_days: null }))).toContain("will learn");
    expect(rhythmText(null)).toContain("will learn");
  });
});

describe("price changes", () => {
  it("compares with the order before", () => {
    expect(priceChangePct(1500, 1400)).toBe(7.1);
    expect(priceChangePct(200, 200)).toBe(0);
    expect(priceChangePct(90, 100)).toBe(-10);
    expect(priceChangePct(100, null)).toBeNull();
    expect(priceChangePct(100, 0)).toBeNull();
    expect(priceChangePct(Number.NaN, 100)).toBeNull();
  });
  it("words it", () => {
    expect(priceChangeText(7.1)).toBe("▲ 7.1% vs before");
    expect(priceChangeText(-10)).toBe("▼ 10% vs before");
    expect(priceChangeText(0)).toBe("Same as before");
    expect(priceChangeText(null)).toBe("No earlier price");
  });
});

describe("quantities typed by a person", () => {
  it("accepts up to 3 decimals above zero", () => {
    expect(parseQty("10")).toBe(10);
    expect(parseQty(" 25.5 ")).toBe(25.5);
    expect(parseQty("0.001")).toBe(0.001);
  });
  it("rejects everything else", () => {
    for (const t of ["", "0", "0.000", "-1", "1.2345", "abc", "1e3", "1,5", "100000000", "5 kg"])
      expect(parseQty(t)).toBeNull();
  });
});

describe("the estimated total mirrors the database", () => {
  it("adds GST per line and the old shipping", () => {
    // 10 x 1500 = 15000, GST 2700; 25.5 x 210.5 = 5367.75, GST 966.20 (rounded); shipping 500, other 100
    expect(
      estimateTotal(
        [
          { qty: 10, unit_price: 1500, gst_rate: 18 },
          { qty: 25.5, unit_price: 210.5, gst_rate: 18 },
        ],
        500,
        100,
      ),
    ).toBe(24633.95);
  });
  it("leaves out lines without a quantity", () => {
    expect(
      estimateTotal(
        [
          { qty: null, unit_price: 1500, gst_rate: 18 },
          { qty: 2, unit_price: 100, gst_rate: 0 },
        ],
        0,
        0,
      ),
    ).toBe(200);
    expect(estimateTotal([], 0, 0)).toBe(0);
  });
});

describe("the owner-only line", () => {
  it("applies above Rs 2,00,000 to everyone but the owner", () => {
    expect(needsOwner(200000, false)).toBe(false);
    expect(needsOwner(200000.01, false)).toBe(true);
    expect(needsOwner(500000, true)).toBe(false);
    expect(needsOwner(10, false)).toBe(false);
  });
});

describe("messages", () => {
  it("turns database codes into sentences", () => {
    expect(reorderError(new Error("duplicate_open"))).toContain("already on its way");
    expect(reorderError({ message: "owner_required" })).toContain("owner");
    expect(reorderError(new Error("daily_limit"))).toContain("30");
    expect(reorderError(new Error("supplier_not_verified"))).toContain("no longer verified");
    expect(reorderError(new Error("Could not find the function public.preview_reorder"))).toContain(
      "migration 22",
    );
    expect(reorderError(new Error("boom"))).toContain("Something went wrong");
    expect(reorderError(null)).toContain("Something went wrong");
  });
  it("explains every blocker", () => {
    for (const b of ["role", "not_delivered", "supplier_not_verified", "no_lines"] as const)
      expect(blockerText(b).length).toBeGreaterThan(10);
  });
});
