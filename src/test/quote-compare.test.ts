import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

import { comparisonCsv, compareQuotes, csvCell, landedOf } from "@/lib/quote-compare";
import { getRfqQuotes, rfqQuotesError, type RfqQuote } from "@/lib/rfq-quotes-api";

const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20261126000015_rfq_quotes.sql"),
  "utf8",
);
const TODAY = "2026-11-14";

function quote(id: string, over: Partial<RfqQuote> = {}): RfqQuote {
  return {
    quote_id: id,
    supplier_org: `org-${id}`,
    name: `Supplier ${id}`,
    city: "Bengaluru",
    state: "Karnataka",
    level_now: 2,
    level_at_send: 2,
    revision: 1,
    sent_at: "2026-11-10T08:00:00Z",
    received_at: "2026-11-10T10:00:00Z",
    gst_rate: 18,
    shipping: 0,
    other_charges: 0,
    delivery_days: 10,
    payment_terms_days: 30,
    valid_until: "2026-12-30",
    notes: "",
    lines: [{ item_id: "i1", qty: 100, unit_price: 100 }],
    amounts: null,
    ...over,
  };
}

describe("landed cost per quote", () => {
  it("adds GST on goods, freight and other charges", () => {
    const l = landedOf(quote("a", { gst_rate: 18, shipping: 500, other_charges: 100 }));
    expect(l).toEqual({
      subtotal: 10000,
      gst: 1800,
      shipping: 500,
      otherCharges: 100,
      total: 12400,
    });
  });
});

describe("compareQuotes", () => {
  it("returns nothing for no quotes", () => {
    const c = compareQuotes([], TODAY);
    expect(c.views).toEqual([]);
    expect(c.pick).toBeNull();
    expect(c.stats.lowest).toBeNull();
  });

  it("ranks on landed cost, not the sticker price, and says so", () => {
    const cheapSticker = quote("a", {
      lines: [{ item_id: "i1", qty: 100, unit_price: 90 }],
      shipping: 3000,
    }); // 9000+1620+3000
    const cheapLanded = quote("b", { lines: [{ item_id: "i1", qty: 100, unit_price: 100 }] }); // 10000+1800
    const c = compareQuotes([cheapSticker, cheapLanded], TODAY, "cheapest");
    expect(c.pick?.quote.quote_id).toBe("b");
    expect(c.insights[0]).toContain("Supplier a shows the lowest item prices");
    expect(c.insights[0]).toContain("Supplier b is");
  });

  it("changes the winner with the priority", () => {
    const slowCheap = quote("slow", {
      lines: [{ item_id: "i1", qty: 100, unit_price: 90 }],
      delivery_days: 30,
    });
    const fastDear = quote("fast", {
      lines: [{ item_id: "i1", qty: 100, unit_price: 110 }],
      delivery_days: 2,
    });
    expect(compareQuotes([slowCheap, fastDear], TODAY, "cheapest").pick?.quote.quote_id).toBe(
      "slow",
    );
    expect(compareQuotes([slowCheap, fastDear], TODAY, "fastest").pick?.quote.quote_id).toBe(
      "fast",
    );
  });

  it("rewards longer payment terms on the cash flow priority", () => {
    const a = quote("a", { payment_terms_days: 0 });
    const b = quote("b", { payment_terms_days: 60 });
    expect(compareQuotes([a, b], TODAY, "cashflow").pick?.quote.quote_id).toBe("b");
  });

  it("never recommends or ranks an expired quote, however cheap", () => {
    const old = quote("old", {
      lines: [{ item_id: "i1", qty: 100, unit_price: 1 }],
      valid_until: "2026-11-13",
    });
    const ok = quote("ok");
    const c = compareQuotes([old, ok], TODAY);
    expect(c.pick?.quote.quote_id).toBe("ok");
    expect(c.views.map((v) => v.quote.quote_id)).toEqual(["ok", "old"]);
    expect(c.views[1]!.rank).toBeNull();
    expect(c.views[1]!.fit).toBeNull();
    expect(c.stats.lowest).toBe(landedOf(ok).total);
    expect(c.insights.join(" ")).toContain("expired");
  });

  it("treats the validity day itself as still valid, and flags quotes that end soon", () => {
    const c = compareQuotes(
      [quote("a", { valid_until: TODAY }), quote("b", { valid_until: "2026-11-30" })],
      TODAY,
    );
    expect(c.views.every((v) => !v.expired)).toBe(true);
    expect(c.views.find((v) => v.quote.quote_id === "a")!.expiresSoon).toBe(true);
    expect(c.views.find((v) => v.quote.quote_id === "a")!.daysLeft).toBe(0);
  });

  it("returns no pick when every quote has expired", () => {
    const c = compareQuotes([quote("a", { valid_until: "2026-01-01" })], TODAY);
    expect(c.pick).toBeNull();
    expect(c.stats.valid).toBe(0);
  });

  it("flags a supplier whose proof lapsed after the RFQ went out", () => {
    const c = compareQuotes([quote("a", { level_at_send: 2, level_now: 0 }), quote("b")], TODAY);
    expect(c.views.find((v) => v.quote.quote_id === "a")!.lapsed).toBe(true);
    expect(c.insights.join(" ")).toContain("proof has lapsed");
  });

  it("is deterministic on a tie (earlier reply wins)", () => {
    const a = quote("a", { received_at: "2026-11-11T10:00:00Z" });
    const b = quote("b", { received_at: "2026-11-10T10:00:00Z" });
    expect(compareQuotes([a, b], TODAY).pick?.quote.quote_id).toBe("b");
    expect(compareQuotes([b, a], TODAY).pick?.quote.quote_id).toBe("b");
  });

  it("gives no badge for ties and reports the spread", () => {
    const a = quote("a");
    const b = quote("b", { lines: [{ item_id: "i1", qty: 100, unit_price: 150 }] });
    const c = compareQuotes([a, b], TODAY);
    const top = c.views[0]!;
    expect(top.reasons.some((r) => r.includes("delivery"))).toBe(false); // equal delivery
    expect(top.reasons[0]).toContain("Lowest total landed cost");
    expect(c.stats.spreadPct).toBe(50);
    expect(c.views[1]!.aboveLowest).toBe(landedOf(b).total - landedOf(a).total);
  });

  it("finds the best price per item among valid quotes only", () => {
    const a = quote("a", { lines: [{ item_id: "i1", qty: 100, unit_price: 100 }] });
    const b = quote("b", { lines: [{ item_id: "i1", qty: 100, unit_price: 95 }] });
    const old = quote("old", {
      lines: [{ item_id: "i1", qty: 100, unit_price: 10 }],
      valid_until: "2026-01-01",
    });
    expect(compareQuotes([a, b, old], TODAY).bestLinePrice).toEqual({ i1: 95 });
  });

  it("matches the database's own amounts (same maths as quoting)", () => {
    const q = quote("a", {
      gst_rate: 12,
      shipping: 250.5,
      other_charges: 49.5,
      lines: [{ item_id: "i1", qty: 3, unit_price: 33.33 }],
    });
    const l = landedOf(q);
    expect(l.subtotal).toBe(99.99);
    expect(l.gst).toBe(12); // round(99.99 * 12 / 100, 2) = 12.00
    expect(l.total).toBe(411.99);
  });
});

describe("csv export", () => {
  it("neutralises spreadsheet formulas and quotes commas", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+91 98")).toBe("'+91 98");
    expect(csvCell("Acme, Ltd")).toBe('"Acme, Ltd"');
    expect(csvCell(12.5)).toBe("12.5");
  });
  it("has one column per supplier and the landed total", () => {
    const c = compareQuotes([quote("a"), quote("b", { shipping: 100 })], TODAY);
    const csv = comparisonCsv([{ id: "i1", description: "Rice", qty: 100, unit: "kg" }], c);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Supplier,Supplier a,Supplier b");
    expect(lines.find((l) => l.startsWith("Total landed cost"))).toBe(
      "Total landed cost,11800,11900",
    );
  });
});

describe("api", () => {
  beforeEach(() => rpc.mockReset());
  it("maps numbers and tolerates an empty answer", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const e = await getRfqQuotes("r");
    expect(e.quotes).toEqual([]);
    expect(e.currency).toBe("INR");
    rpc.mockResolvedValue({
      data: {
        currency: "INR",
        today: TODAY,
        quotes: [
          {
            ...quote("a"),
            gst_rate: "18.00",
            lines: [{ item_id: "i1", qty: "2", unit_price: "5.50" }],
          },
        ],
      },
      error: null,
    });
    const d = await getRfqQuotes("r");
    expect(rpc).toHaveBeenLastCalledWith("get_rfq_quotes", { p_rfq: "r" });
    expect(d.quotes[0]!.gst_rate).toBe(18);
    expect(d.quotes[0]!.lines[0]).toEqual({ item_id: "i1", qty: 2, unit_price: 5.5 });
  });
  it("turns database codes into plain messages", async () => {
    expect(rfqQuotesError(new Error("not_found"))).toContain("aren't available");
    expect(
      rfqQuotesError({ message: "Could not find the function public.get_rfq_quotes" }),
    ).toContain("migration 15");
    rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });
    await expect(getRfqQuotes("x")).rejects.toThrow("aren't available");
  });
});

describe("migration 15", () => {
  it("only reads: no table is created, altered or written", () => {
    const code = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(
      /\b(create table|alter table|insert into|update public|delete from|drop )/i,
    );
  });
  it("is limited to members of the buyer company and the signed-in", () => {
    expect(sql).toContain("not_authenticated");
    expect(sql).toContain("public._req_role(org_id) is not null");
    expect(sql).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(sql).toContain(
      "grant execute on function public.get_rfq_quotes(uuid) to authenticated;",
    );
  });
  it("is a hardened security definer function", () => {
    expect(sql).toContain("security definer set search_path = ''");
  });
});
