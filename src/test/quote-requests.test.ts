import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

import {
  addDays,
  deadline,
  daysUntil,
  liveTotals,
  parseAmount,
  startForm,
  toInput,
  validateQuote,
  ymd,
  type QuoteForm,
} from "@/lib/quote-form";
import {
  countOpenQuoteRequests,
  declineQuoteRequest,
  getQuoteRequest,
  listQuoteRequests,
  quoteError,
  submitQuotation,
  type QuoteItem,
  type QuoteRequestDetail,
} from "@/lib/quote-requests-api";

const ORG = "00000000-0000-4000-8000-000000000001";
const RFQ = "00000000-0000-4000-8000-000000000002";
const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20261125000014_quote_requests.sql"),
  "utf8",
);
const NOW = new Date(2026, 10, 14); // 14 Nov 2026

const items: QuoteItem[] = [
  {
    id: "a",
    description: "Basmati rice 1121",
    qty: 100,
    unit: "kg",
    suggestion: {
      product_id: "p1",
      name: "Basmati rice 1121",
      price: 90,
      unit: "kg",
      moq: 50,
      availability: "Available",
    },
  },
  {
    id: "b",
    description: "Jute bags",
    qty: 10,
    unit: "piece",
    suggestion: {
      product_id: "p2",
      name: "Jute bag",
      price: 600,
      unit: "box",
      moq: null,
      availability: "Available",
    },
  },
  { id: "c", description: "Labels", qty: 5, unit: "box", suggestion: null },
];

function detail(over: Partial<QuoteRequestDetail> = {}): QuoteRequestDetail {
  return {
    rfq: {
      id: RFQ,
      number: "RFQ-2026-0001",
      title: "Packaging",
      category: "Food",
      due_date: "2026-11-20",
      notes: "",
      currency: "INR",
      open: true,
      invited: 3,
    },
    buyer: { name: "Acme Foods", city: "Pune", state: "Maharashtra" },
    invite: {
      status: "viewed",
      state: "open",
      sent_at: "2026-11-13T10:00:00Z",
      viewed_at: "2026-11-14T10:00:00Z",
      responded_at: null,
      decline_reason: "",
      level_at_send: 2,
    },
    items,
    quote: null,
    last_terms: null,
    can_respond: true,
    ...over,
  };
}

describe("migration 14 and the app stay in step", () => {
  it("has a plain-language message for every error the database can raise", () => {
    const codes = new Set(
      [...sql.matchAll(/raise exception '([a-z_]{2,})'|'(invalid_[a-z_]+)'/g)].map(
        (m) => (m[1] ?? m[2]) as string,
      ),
    );
    expect(codes.size).toBeGreaterThan(12);
    for (const code of codes)
      expect(quoteError(new Error(code)), code).not.toMatch(/Something went wrong/);
  });

  it("locks quotations against direct browser writes and grants only the four functions", () => {
    expect(sql).toMatch(
      /revoke insert, update, delete on public\.quotations, public\.quotation_lines from authenticated/,
    );
    for (const fn of [
      "list_quote_requests",
      "get_quote_request",
      "submit_quotation",
      "decline_quote_request",
    ]) {
      expect(sql, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\(`));
    }
    expect(sql).not.toMatch(/grant execute on function public\._quote/);
  });

  it("every function that touches supplier data checks the caller first", () => {
    for (const fn of [
      "list_quote_requests",
      "get_quote_request",
      "submit_quotation",
      "decline_quote_request",
    ]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`));
      expect(body.slice(0, 900), fn).toMatch(/_quote_guard\(p_org\)/);
    }
  });

  it("the notification link the buyer RFQ migration sends matches the page route", () => {
    const m13 = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20261124000013_rfqs.sql"),
      "utf8",
    );
    expect(m13).toContain("'quote-requests/' || v_rfq::text");
    expect(
      readFileSync(
        path.resolve(process.cwd(), "src/routes/supplier.quote-requests.$id.tsx"),
        "utf8",
      ),
    ).toContain('"/supplier/quote-requests/$id"');
  });
});

describe("quote requests api", () => {
  beforeEach(() => rpc.mockReset());

  it("tells the person when the migration has not been run", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.list_quote_requests" },
    });
    await expect(listQuoteRequests(ORG)).rejects.toThrow(/migration 14/);
  });

  it("turns numbers from the database into numbers", async () => {
    rpc.mockResolvedValue({
      data: {
        total: "2",
        counts: { open: "1", quoted: "1" },
        items: [
          { rfq_id: RFQ, item_count: "3", invited: "4", my_total: "1180.50", state: "quoted" },
        ],
      },
      error: null,
    });
    const r = await listQuoteRequests(ORG, "all");
    expect(r.total).toBe(2);
    expect(r.counts.open).toBe(1);
    expect(r.items[0]).toMatchObject({ item_count: 3, invited: 4, my_total: 1180.5 });
    expect(rpc).toHaveBeenCalledWith("list_quote_requests", {
      p_org: ORG,
      p_filter: null,
      p_limit: 100,
      p_offset: 0,
    });
  });

  it("the menu badge count never throws", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await countOpenQuoteRequests(ORG)).toBe(0);
    rpc.mockResolvedValue({ data: { counts: { open: 4 } }, error: null });
    expect(await countOpenQuoteRequests(ORG)).toBe(4);
  });

  it("reads a detail, parsing money and the supplier's own suggestion", async () => {
    rpc.mockResolvedValue({
      data: {
        ...detail(),
        items: [
          {
            id: "a",
            description: "Rice",
            qty: "100",
            unit: "kg",
            suggestion: {
              product_id: "p",
              name: "Rice",
              price: "90.5",
              unit: "kg",
              moq: "10",
              availability: "Available",
            },
          },
        ],
      },
      error: null,
    });
    const d = await getQuoteRequest(ORG, RFQ);
    expect(d.items[0]).toMatchObject({ qty: 100 });
    expect(d.items[0]!.suggestion).toMatchObject({ price: 90.5, moq: 10 });
    expect(rpc).toHaveBeenCalledWith("get_quote_request", { p_org: ORG, p_rfq: RFQ });
  });

  it("submits and declines through the functions, never a table", async () => {
    rpc.mockResolvedValue({ data: { id: "q", revision: 1, amounts: {} }, error: null });
    const input = toInput(startForm(detail(), NOW).form, items);
    await submitQuotation(ORG, RFQ, input);
    expect(rpc).toHaveBeenCalledWith("submit_quotation", { p_org: ORG, p_rfq: RFQ, p_data: input });
    await declineQuoteRequest(ORG, RFQ, "  not our grade  ");
    expect(rpc).toHaveBeenLastCalledWith("decline_quote_request", {
      p_org: ORG,
      p_rfq: RFQ,
      p_reason: "not our grade",
    });
    await declineQuoteRequest(ORG, RFQ, "   ");
    expect(rpc).toHaveBeenLastCalledWith("decline_quote_request", {
      p_org: ORG,
      p_rfq: RFQ,
      p_reason: null,
    });
  });

  it("shows the plain message when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "rfq_closed" } });
    await expect(
      submitQuotation(ORG, RFQ, toInput(startForm(detail(), NOW).form, items)),
    ).rejects.toThrow(/closed/);
  });
});

describe("quote in 60 seconds: the form starts filled", () => {
  it("prices come from the product list when the unit matches, and not when it does not", () => {
    const s = startForm(detail(), NOW);
    expect(s.form.prices["a"]).toBe("90");
    expect(s.prefilled).toEqual(["a"]);
    expect(s.form.prices["b"]).toBeUndefined();
    expect(s.unitMismatch).toEqual(["b"]);
    expect(s.form.prices["c"]).toBeUndefined();
  });

  it("starts from the last terms when there are some, from sensible defaults when not", () => {
    expect(startForm(detail(), NOW).form).toMatchObject({
      gstRate: "18",
      paymentTermsDays: "30",
      deliveryDays: "7",
      validUntil: "2026-11-29",
    });
    const s = startForm(
      detail({ last_terms: { gst_rate: 5, payment_terms_days: 45, delivery_days: 3 } }),
      NOW,
    );
    expect(s.form).toMatchObject({ gstRate: "5", paymentTermsDays: "45", deliveryDays: "3" });
  });

  it("revising starts from the quote already sent", () => {
    const q = {
      id: "q",
      revision: 1,
      received_at: "x",
      gst_rate: 12,
      shipping: 500,
      other_charges: 0,
      delivery_days: 5,
      payment_terms_days: 15,
      valid_until: "2026-12-01",
      notes: "hi",
      amounts: null,
      lines: [{ item_id: "a", unit_price: 95 }],
    };
    const s = startForm(detail({ quote: q }), NOW);
    expect(s.form).toMatchObject({
      gstRate: "12",
      shipping: "500",
      validUntil: "2026-12-01",
      notes: "hi",
    });
    expect(s.form.prices["a"]).toBe("95");
    expect(s.prefilled).toEqual([]);
  });
});

describe("the form is checked before it is sent", () => {
  const good = (): QuoteForm => ({
    prices: { a: "90", b: "55.5", c: "1,200" },
    gstRate: "18",
    shipping: "0",
    otherCharges: "0",
    deliveryDays: "7",
    paymentTermsDays: "30",
    validUntil: "2026-11-29",
    notes: "",
  });

  it("accepts a complete quote", () => {
    expect(validateQuote(good(), items, NOW)).toEqual({});
  });
  it("needs a price on every item, above zero", () => {
    const f = good();
    f.prices["b"] = "";
    f.prices["c"] = "0";
    const e = validateQuote(f, items, NOW);
    expect(Object.keys(e).sort()).toEqual(["price:b", "price:c"]);
  });
  it("rejects bad money, GST, days and dates", () => {
    const f = {
      ...good(),
      gstRate: "41",
      shipping: "-1",
      otherCharges: "abc",
      deliveryDays: "7.5",
      paymentTermsDays: "400",
      validUntil: "2026-11-13",
      notes: "x".repeat(1001),
    };
    expect(Object.keys(validateQuote(f, items, NOW)).sort()).toEqual([
      "deliveryDays",
      "gstRate",
      "notes",
      "otherCharges",
      "paymentTermsDays",
      "shipping",
      "validUntil",
    ]);
    expect(
      validateQuote({ ...good(), validUntil: ymd(addDays(NOW, 366)) }, items, NOW)["validUntil"],
    ).toBeDefined();
    expect(
      validateQuote({ ...good(), validUntil: ymd(NOW) }, items, NOW)["validUntil"],
    ).toBeUndefined();
  });
  it("parses amounts the way the database does", () => {
    expect(parseAmount("1,250.50")).toBe(1250.5);
    expect(parseAmount("12.345")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });
  it("builds the payload with every item priced once", () => {
    const i = toInput(good(), items);
    expect(i.lines).toEqual([
      { itemId: "a", unitPrice: 90 },
      { itemId: "b", unitPrice: 55.5 },
      { itemId: "c", unitPrice: 1200 },
    ]);
    expect(i).toMatchObject({
      gstRate: 18,
      deliveryDays: 7,
      paymentTermsDays: 30,
      validUntil: "2026-11-29",
    });
  });
});

describe("the live number is the landed cost the buyer will compare", () => {
  it("adds GST on goods, then freight and other charges", () => {
    const f: QuoteForm = {
      prices: { a: "100", b: "10", c: "20" },
      gstRate: "18",
      shipping: "500",
      otherCharges: "50",
      deliveryDays: "1",
      paymentTermsDays: "1",
      validUntil: "2026-11-29",
      notes: "",
    };
    const t = liveTotals(f, items); // 100x100 + 10x10 + 5x20 = 10200
    expect(t.subtotal).toBe(10200);
    expect(t.gst).toBe(1836);
    expect(t.total).toBe(12586);
    expect(t.priced).toBe(3);
  });
  it("counts only items that have a valid price", () => {
    const f = startForm(detail(), NOW).form;
    expect(liveTotals(f, items).priced).toBe(1);
  });
});

describe("deadlines", () => {
  it("counts whole calendar days", () => {
    expect(daysUntil("2026-11-14", NOW)).toBe(0);
    expect(daysUntil("2026-11-20", NOW)).toBe(6);
    expect(daysUntil("2026-11-13", NOW)).toBe(-1);
    expect(daysUntil("nonsense", NOW)).toBeNull();
  });
  it("labels them in plain words with an urgency tone", () => {
    expect(deadline(null, NOW)).toMatchObject({ tone: "none" });
    expect(deadline("2026-11-14", NOW)).toMatchObject({ label: "Due today", tone: "soon" });
    expect(deadline("2026-11-15", NOW)).toMatchObject({ label: "Due tomorrow", tone: "soon" });
    expect(deadline("2026-11-17", NOW)).toMatchObject({ label: "3 days left", tone: "soon" });
    expect(deadline("2026-11-24", NOW)).toMatchObject({ label: "10 days left", tone: "ok" });
    expect(deadline("2026-11-01", NOW)).toMatchObject({ tone: "late" });
  });
});
