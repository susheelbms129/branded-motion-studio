import { differenceInCalendarDays, parseISO, subMonths } from "date-fns";

import type { Insight, PurchaseOrder, PurchaseRequest, Supplier, Material } from "@/types/domain";

interface Input {
  pos: PurchaseOrder[];
  requests: PurchaseRequest[];
  suppliers: Supplier[];
  materials: Material[];
}

const live = (p: PurchaseOrder) => p.status !== "draft" && p.status !== "cancelled";
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Every insight is derived from records and carries the evidence it came from. */
export function computeInsights({ pos, requests, suppliers, materials }: Input): Insight[] {
  const out: Insight[] = [];
  const now = new Date().toISOString();
  const sName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? id;
  const good = pos.filter(live);

  // 1. Price increase: last 3 purchases vs the previous purchases of the same material
  for (const m of materials) {
    const pts = good
      .flatMap((p) =>
        p.lines
          .filter((l) => l.materialId === m.id)
          .map((l) => ({ p, price: l.unitPrice, qty: l.qty })),
      )
      .sort((a, b) => a.p.createdAt.localeCompare(b.p.createdAt));
    if (pts.length < 6) continue;
    const recent = pts.slice(-3),
      before = pts.slice(0, -3).slice(-6);
    const r = avg(recent.map((x) => x.price)),
      b = avg(before.map((x) => x.price));
    const pct = (r - b) / b;
    if (pct < 0.08) continue;
    out.push({
      id: `ins-price-${m.id}`,
      type: "price_increase",
      severity: pct > 0.15 ? "high" : "medium",
      title: `${m.name} is ${(pct * 100).toFixed(0)}% costlier`,
      whatHappened: `The average unit price over the last 3 orders is ${inr(r)}/${m.unit}, up from ${inr(b)}/${m.unit} across the ${before.length} orders before.`,
      whyFlagged: "Recent purchase prices exceed the earlier baseline by more than 8%.",
      confidence: Math.min(0.95, 0.5 + pts.length * 0.03),
      evidence: recent.map((x) => ({
        kind: "purchase_order" as const,
        id: x.p.id,
        label: x.p.number,
        detail: `${inr(x.price)}/${m.unit} · ${sName(x.p.supplierId)}`,
      })),
      suggestedAction:
        "Request fresh quotes from alternate suppliers or negotiate a rate contract before the next order.",
      impactAmount: Math.round((r - b) * avg(recent.map((x) => x.qty)) * 3),
      status: "open",
      createdAt: now,
    });
  }

  // 2. Repeated delay: supplier late by 3+ days on at least 3 of its last 6 deliveries
  for (const s of suppliers) {
    const d = good
      .filter((p) => p.supplierId === s.id && p.deliveredAt)
      .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""))
      .slice(0, 6);
    const late = d.filter(
      (p) =>
        differenceInCalendarDays(parseISO(p.deliveredAt as string), parseISO(p.expectedAt)) >= 3,
    );
    if (d.length < 4 || late.length < 3) continue;
    out.push({
      id: `ins-delay-${s.id}`,
      type: "repeated_delay",
      severity: late.length >= 4 ? "high" : "medium",
      title: `${s.name} keeps delivering late`,
      whatHappened: `${late.length} of the last ${d.length} deliveries arrived 3 or more days after the promised date.`,
      whyFlagged: "Three or more late deliveries in the recent window.",
      confidence: Math.min(0.95, 0.55 + d.length * 0.05),
      evidence: late.map((p) => ({
        kind: "purchase_order" as const,
        id: p.id,
        label: p.number,
        detail: `${differenceInCalendarDays(parseISO(p.deliveredAt as string), parseISO(p.expectedAt))} days late`,
      })),
      suggestedAction:
        "Add buffer to lead times, discuss a service-level commitment, or invite an alternate supplier on the next RFQ.",
      impactAmount: null,
      status: "open",
      createdAt: now,
    });
  }

  // 3. Lower landed cost elsewhere: same material, cheaper supplier in the last 6 months
  const since = subMonths(new Date(), 6).toISOString();
  for (const m of materials) {
    const by = new Map<string, { sum: number; n: number; qty: number; pos: PurchaseOrder[] }>();
    for (const p of good.filter((x) => x.createdAt >= since))
      for (const l of p.lines.filter((x) => x.materialId === m.id)) {
        const e = by.get(p.supplierId) ?? { sum: 0, n: 0, qty: 0, pos: [] };
        e.sum += l.unitPrice;
        e.n += 1;
        e.qty += l.qty;
        e.pos.push(p);
        by.set(p.supplierId, e);
      }
    if (by.size < 2) continue;
    const arr = [...by.entries()].map(([id, e]) => ({ id, price: e.sum / e.n, ...e }));
    const main = arr.sort((a, b) => b.n - a.n)[0]!;
    const cheap = arr
      .filter((x) => x.id !== main.id && x.n >= 2)
      .sort((a, b) => a.price - b.price)[0];
    if (!cheap || (main.price - cheap.price) / main.price < 0.05) continue;
    out.push({
      id: `ins-cost-${m.id}`,
      type: "lower_landed_cost",
      severity: "low",
      title: `${sName(cheap.id)} sells ${m.name} cheaper`,
      whatHappened: `Average price ${inr(cheap.price)}/${m.unit} vs ${inr(main.price)}/${m.unit} from ${sName(main.id)}, your most-used supplier.`,
      whyFlagged:
        "Another supplier priced the same material at least 5% lower over multiple orders (GST is identical per material).",
      confidence: Math.min(0.9, 0.45 + cheap.n * 0.1),
      evidence: [...main.pos.slice(-1), ...cheap.pos.slice(-2)].map((p) => ({
        kind: "purchase_order" as const,
        id: p.id,
        label: p.number,
        detail: sName(p.supplierId),
      })),
      suggestedAction: `Include ${sName(cheap.id)} on the next RFQ for ${m.name}; confirm freight before switching.`,
      impactAmount: Math.round((main.price - cheap.price) * (main.qty / main.n) * 3),
      status: "open",
      createdAt: now,
    });
  }

  // 4. Possible duplicate requests: same material, same category, raised within 21 days
  const reqs = requests.filter((r) => r.status !== "rejected" && r.status !== "draft");
  const seen = new Set<string>();
  for (let i = 0; i < reqs.length; i++)
    for (let j = i + 1; j < reqs.length; j++) {
      const a = reqs[i]!,
        b = reqs[j]!;
      const shared = a.items.find((x) => b.items.some((y) => y.materialId === x.materialId));
      if (
        !shared ||
        Math.abs(differenceInCalendarDays(parseISO(a.createdAt), parseISO(b.createdAt))) > 21
      )
        continue;
      const key = [a.id, b.id].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `ins-dup-${key}`,
        type: "possible_duplicate",
        severity: "medium",
        title: `${a.number} and ${b.number} may be duplicates`,
        whatHappened: `Both ask for ${shared.description} within three weeks of each other.`,
        whyFlagged: "Same material requested twice in a short window.",
        confidence: 0.6,
        evidence: [a, b].map((r) => ({
          kind: "purchase_request" as const,
          id: r.id,
          label: r.number,
          detail: r.title,
        })),
        suggestedAction:
          "Confirm both are needed, or merge them into a single RFQ to get better volume pricing.",
        impactAmount: null,
        status: "open",
        createdAt: now,
      });
    }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (b.impactAmount ?? 0) - (a.impactAmount ?? 0),
  );
}
