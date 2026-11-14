import { AVAILABILITY, SUPPLY_CATEGORIES } from "@/features/supplier/draft";

/**
 * "Buyer-search readiness" for ONE product: a score out of 100 and the exact things that would make buyers pick it.
 * Pure functions (no browser, no database), so a test can prove the rules. The same rules also check the form before
 * it is sent; the database checks everything again, because the browser is never trusted.
 */

export interface ProductDraft {
  name: string;
  category: string;
  description: string;
  unit: string;
  moq: string;
  price: string;
  availability: string;
}

export const EMPTY_PRODUCT: ProductDraft = {
  name: "",
  category: "",
  description: "",
  unit: "",
  moq: "",
  price: "",
  availability: "Available",
};

export const PRODUCT_WEIGHTS = {
  name: 10,
  category: 10,
  description: 25,
  price: 25,
  unit: 10,
  moq: 10,
  availability: 10,
} as const;

export interface Tip {
  key: keyof typeof PRODUCT_WEIGHTS;
  points: number;
  text: string;
}

export interface Readiness {
  score: number;
  tier: "Needs details" | "Almost there" | "Ready for buyers";
  tips: Tip[];
}

const filled = (v: string) => v.trim().length > 0;

export function productReadiness(p: ProductDraft): Readiness {
  const checks: [Tip["key"], boolean, string][] = [
    [
      "name",
      p.name.trim().length >= 4,
      'Use a specific name, like "OPC 53 Grade Cement, 50 kg bag", not just "Cement".',
    ],
    [
      "category",
      filled(p.category),
      "Pick a category. It decides which buyer searches show this product.",
    ],
    [
      "description",
      p.description.trim().length >= 60,
      "Write at least a sentence on grade, size or standard. Buyers compare these first.",
    ],
    [
      "price",
      filled(p.price),
      "Add a price. Products with a price get compared; products without one get skipped.",
    ],
    [
      "unit",
      filled(p.unit),
      "Say what the price is per (kg, piece, box). Without it the price is unclear.",
    ],
    ["moq", filled(p.moq), "Add your minimum order, so buyers know before they ask."],
    [
      "availability",
      p.availability === "Available" || p.availability === "Made to order",
      "This product shows as unavailable, so buyers may scroll past it.",
    ],
  ];
  const tips: Tip[] = checks
    .filter(([, ok]) => !ok)
    .map(([key, , text]) => ({ key, points: PRODUCT_WEIGHTS[key], text }));
  const score = Math.max(0, 100 - tips.reduce((n, t) => n + t.points, 0));
  const tier: Readiness["tier"] =
    score >= 85 ? "Ready for buyers" : score >= 60 ? "Almost there" : "Needs details";
  return { score, tier, tips: tips.sort((a, b) => b.points - a.points) };
}

/** What the person typed, checked before it is sent. Returns one friendly message per bad field. */
export function validateProduct(p: ProductDraft): Partial<Record<keyof ProductDraft, string>> {
  const e: Partial<Record<keyof ProductDraft, string>> = {};
  const name = p.name.trim();
  if (name.length < 2) e.name = "Enter the product name (at least 2 letters).";
  else if (name.length > 120) e.name = "Keep the name under 120 characters.";
  if (!(SUPPLY_CATEGORIES as readonly string[]).includes(p.category))
    e.category = "Pick a category.";
  if (p.description.trim().length > 1000)
    e.description = "Keep the description under 1000 characters.";
  if (p.unit.trim().length > 40) e.unit = "Keep the unit under 40 characters.";
  if (!(AVAILABILITY as readonly string[]).includes(p.availability))
    e.availability = "Pick the availability.";
  const num = /^[0-9]{1,12}(\.[0-9]{1,3})?$/;
  if (filled(p.price) && !num.test(p.price.trim())) e.price = "Enter a number like 1500 or 12.5.";
  if (filled(p.moq) && !num.test(p.moq.trim())) e.moq = "Enter a number like 100.";
  return e;
}

/** Catalog-level view: how many products are ready, and the one change that helps the most. */
export function catalogHealth(items: ProductDraft[]) {
  const scored = items.map((p) => productReadiness(p));
  const ready = scored.filter((s) => s.tier === "Ready for buyers").length;
  const average =
    scored.length === 0 ? 0 : Math.round(scored.reduce((n, s) => n + s.score, 0) / scored.length);
  const missing: Record<string, number> = {};
  for (const s of scored) for (const t of s.tips) missing[t.key] = (missing[t.key] ?? 0) + 1;
  const top = Object.entries(missing).sort(
    (a, b) =>
      b[1] - a[1] || PRODUCT_WEIGHTS[b[0] as Tip["key"]] - PRODUCT_WEIGHTS[a[0] as Tip["key"]],
  )[0];
  return {
    total: items.length,
    ready,
    average,
    topGap: top ? { key: top[0] as Tip["key"], count: top[1] } : null,
  };
}
