import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  EMPTY_PRODUCT,
  PRODUCT_WEIGHTS,
  catalogHealth,
  productReadiness,
  validateProduct,
  type ProductDraft,
} from "@/lib/product-quality";

const full: ProductDraft = {
  name: "OPC 53 Grade Cement, 50 kg bag",
  category: "Construction Materials",
  description:
    "Ordinary Portland Cement, 53 grade, IS 269 certified, for structural concrete work.",
  unit: "Boxes",
  moq: "100",
  price: "385",
  availability: "Available",
};

describe("product readiness", () => {
  it("weights add up to 100", () => {
    expect(Object.values(PRODUCT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("a complete product is ready and has no tips", () => {
    const r = productReadiness(full);
    expect(r.score).toBe(100);
    expect(r.tier).toBe("Ready for buyers");
    expect(r.tips).toHaveLength(0);
  });
  it("a missing price costs the most and is suggested first after description", () => {
    const r = productReadiness({ ...full, price: "", description: "" });
    expect(r.score).toBe(50);
    expect(r.tier).toBe("Needs details");
    expect(
      r.tips
        .map((t) => t.key)
        .slice(0, 2)
        .sort(),
    ).toEqual(["description", "price"]);
  });
  it("an unavailable product loses its availability points", () => {
    expect(productReadiness({ ...full, availability: "Temporarily unavailable" }).score).toBe(90);
  });
});

describe("product form checks", () => {
  it("accepts a good product and rejects an empty one", () => {
    expect(validateProduct(full)).toEqual({});
    const e = validateProduct(EMPTY_PRODUCT);
    expect(e.name).toBeTruthy();
    expect(e.category).toBeTruthy();
  });
  it("rejects bad numbers, a made-up category and an over-long name", () => {
    expect(validateProduct({ ...full, price: "-5" }).price).toBeTruthy();
    expect(validateProduct({ ...full, price: "1e9" }).price).toBeTruthy();
    expect(validateProduct({ ...full, moq: "abc" }).moq).toBeTruthy();
    expect(validateProduct({ ...full, category: "Weapons" }).category).toBeTruthy();
    expect(validateProduct({ ...full, name: "x".repeat(121) }).name).toBeTruthy();
  });
});

describe("catalog health", () => {
  it("counts ready products and names the most common gap", () => {
    const h = catalogHealth([
      full,
      { ...full, price: "" },
      { ...full, price: "", name: "Steel TMT Bar Fe500" },
    ]);
    expect(h.total).toBe(3);
    expect(h.ready).toBe(1);
    expect(h.topGap).toEqual({ key: "price", count: 2 });
  });
  it("an empty catalogue has no gap", () => {
    expect(catalogHealth([])).toEqual({ total: 0, ready: 0, average: 0, topGap: null });
  });
});

// The browser can never be trusted, so the safety rules live in the migration. This guards against someone loosening them by accident.
describe("migration 10 keeps products locked to the owning supplier", () => {
  const sql = readFileSync("supabase/migrations/20261121000010_supplier_products.sql", "utf8");
  it("only active owner / procurement-manager members of a SUPPLIER company can write", () => {
    expect(sql).toMatch(/b\.kind = 'supplier'/);
    expect(sql).toMatch(/m\.status = 'active'/);
    expect(sql).toMatch(/m\.role in \('owner', 'procurement_manager'\)/);
  });
  it("changes and removals are scoped to the proven company", () => {
    expect(sql).toMatch(/where id = v_id and org_id = p_org/);
    expect(sql).toMatch(/delete from public\.supplier_products where id = p_id and org_id = p_org/);
  });
  it("functions are revoked from everyone and granted only to signed-in users", () => {
    expect(sql).toMatch(/revoke all on function/);
    expect(sql).not.toMatch(/grant execute[^;]*to (anon|public)/);
    expect(sql).toMatch(
      /grant execute on function public\.save_supplier_product\(uuid, jsonb\) to authenticated/,
    );
  });
  it("is audited, size-limited and race-safe", () => {
    expect(sql).toMatch(/_audit\(/);
    expect(sql).toMatch(/>= 200/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
  });
});
