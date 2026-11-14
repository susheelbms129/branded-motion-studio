import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

import {
  createRequest,
  decideRequest,
  getRequest,
  listRequests,
  requestError,
} from "@/lib/requests-api";

const ORG = "00000000-0000-4000-8000-000000000001";

describe("requests api", () => {
  beforeEach(() => rpc.mockReset());

  it("has a plain-language message for every error the database can raise", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/20261123000012_purchase_requests.sql"),
      "utf8",
    );
    const codes = new Set(
      [...sql.matchAll(/'((?:invalid|not|no|too|comment)_[a-z_]+)'/g)].map((m) => m[1] as string),
    );
    expect(codes.size).toBeGreaterThan(15);
    for (const code of codes) {
      expect(requestError(new Error(code)), code).not.toMatch(/Something went wrong/);
    }
  });

  it("never shows raw database text for an unknown failure", () => {
    expect(requestError({ message: "duplicate key value violates unique constraint" })).toMatch(/Something went wrong/);
  });

  it("tells the person when the migration has not been run", () => {
    expect(requestError({ message: "Could not find the function public.list_requests" })).toMatch(/migration 12/);
  });

  it("asks for a company's requests and turns database numbers into numbers", async () => {
    rpc.mockResolvedValue({
      data: {
        total: "2",
        counts: { draft: 1, approved: 1 },
        items: [{ id: "a", number: "PR-2026-0001", total: "1500.50", item_count: "2" }],
      },
      error: null,
    });
    const r = await listRequests(ORG, "approved");
    expect(rpc).toHaveBeenCalledWith("list_requests", { p_org: ORG, p_status: "approved", p_limit: 100, p_offset: 0 });
    expect(r.total).toBe(2);
    expect(r.items[0]?.total).toBe(1500.5);
    expect(r.items[0]?.item_count).toBe(2);
  });

  it("sends 'all' as no status filter", async () => {
    rpc.mockResolvedValue({ data: { total: 0, counts: {}, items: [] }, error: null });
    await listRequests(ORG, "all");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_status: null });
  });

  it("copes with an empty answer", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(listRequests(ORG)).resolves.toEqual({ total: 0, counts: {}, items: [] });
  });

  it("reads a request's detail with numeric lines", async () => {
    rpc.mockResolvedValue({
      data: {
        request: { id: "r", total: "300" },
        items: [{ id: "i", qty: "3.000", unit_price: "100.00" }],
        is_requester: true,
        can_decide: false,
        can_withdraw: true,
      },
      error: null,
    });
    const d = await getRequest("r");
    expect(d.request.total).toBe(300);
    expect(d.items[0]).toMatchObject({ qty: 3, unit_price: 100 });
    expect(d.approvals).toEqual([]);
    expect(d.events).toEqual([]);
  });

  it("creates a request through the database function", async () => {
    rpc.mockResolvedValue({ data: { id: "r", number: "PR-2026-0001", status: "draft" }, error: null });
    const input = {
      title: "Plates",
      department: "Production",
      category: "Raw material",
      priority: "medium" as const,
      neededBy: "2030-01-01",
      justification: "Needed for the new line.",
      items: [{ description: "MS plate", qty: 1, unit: "pcs", unitPrice: 10 }],
    };
    await createRequest(ORG, input, true);
    expect(rpc).toHaveBeenCalledWith("create_request", { p_org: ORG, p_data: input, p_submit: true });
  });

  it("turns a database refusal into a friendly sentence", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_your_turn" } });
    await expect(decideRequest("r", "approved", "")).rejects.toThrow(/waiting for someone else/);
  });
});
