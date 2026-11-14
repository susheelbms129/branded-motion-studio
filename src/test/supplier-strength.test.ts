import { describe, expect, it } from "vitest";

import { WEIGHTS, computeStrength, safeLogo, type StrengthInput } from "@/lib/supplier-strength";

const empty: StrengthInput = {
  descriptionLength: 0,
  hasLogo: false,
  categoryCount: 0,
  hasContact: false,
  productCount: 0,
  pricedProductCount: 0,
  hasCoverage: false,
  hasDeliveryTime: false,
  hasMinOrder: false,
  locationCount: 0,
  trustLevel: 0,
  proofsNeedingFix: 0,
  proofsInReview: 0,
};
const full: StrengthInput = {
  descriptionLength: 300,
  hasLogo: true,
  categoryCount: 3,
  hasContact: true,
  productCount: 5,
  pricedProductCount: 5,
  hasCoverage: true,
  hasDeliveryTime: true,
  hasMinOrder: true,
  locationCount: 2,
  trustLevel: 3,
  proofsNeedingFix: 0,
  proofsInReview: 0,
};

describe("storefront strength", () => {
  it("the weights add up to exactly 100", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("an empty storefront scores 0 and a complete one scores 100", () => {
    expect(computeStrength(empty).score).toBe(0);
    expect(computeStrength(full).score).toBe(100);
    expect(computeStrength(full).next).toHaveLength(0);
  });
  it("names the tier from the score", () => {
    expect(computeStrength(empty).tier).toBe("Getting started");
    expect(computeStrength(full).tier).toBe("Standout");
    expect(computeStrength({ ...full, trustLevel: 0 }).tier).toBe("Taking shape");
    expect(computeStrength({ ...full, trustLevel: 2 }).tier).toBe("Standout");
  });
  it("puts steps the supplier can act on today first, biggest gain first", () => {
    const { next } = computeStrength(empty);
    expect(next[0]?.key).toBe("registered");
    const firstSoon = next.findIndex((s) => s.to === null);
    expect(next.slice(firstSoon).every((s) => s.to === null)).toBe(true);
  });
  it("every open step explains why it matters to a buyer", () => {
    for (const s of computeStrength(empty).steps) expect(s.why.length).toBeGreaterThan(20);
  });
  it("prices count only when at least half the products show one", () => {
    expect(
      computeStrength({ ...empty, productCount: 4, pricedProductCount: 1 }).steps.find(
        (s) => s.key === "prices",
      )?.done,
    ).toBe(false);
    expect(
      computeStrength({ ...empty, productCount: 4, pricedProductCount: 2 }).steps.find(
        (s) => s.key === "prices",
      )?.done,
    ).toBe(true);
  });
  it("a fix-needed proof changes the call to action", () => {
    expect(computeStrength({ ...empty, proofsNeedingFix: 1 }).next[0]?.cta).toBe("Fix your proof");
  });
});

describe("safeLogo", () => {
  it("accepts a real image data URL and nothing else", () => {
    expect(safeLogo("data:image/png;base64,iVBORw0KGgo=")).not.toBeNull();
    expect(safeLogo("https://evil.example/x.png")).toBeNull();
    expect(safeLogo("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(safeLogo("javascript:alert(1)")).toBeNull();
    expect(safeLogo(null)).toBeNull();
  });
});
