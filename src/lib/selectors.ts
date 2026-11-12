import { format, parseISO, startOfMonth, subMonths } from "date-fns";

import type { PurchaseOrder, Supplier } from "@/types/domain";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function poTotals(po: PurchaseOrder) {
  const subtotal = r2(po.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const gst = r2(po.lines.reduce((s, l) => s + (l.qty * l.unitPrice * l.gstRate) / 100, 0));
  return {
    subtotal,
    gst,
    shipping: po.shipping,
    otherCharges: po.otherCharges,
    total: r2(subtotal + gst + po.shipping + po.otherCharges),
  };
}
export const requestTotal = (items: { qty: number; unitPrice: number }[]) =>
  r2(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
export const isSpend = (po: PurchaseOrder) => po.status !== "draft" && po.status !== "cancelled";

export function spendByMonth(pos: PurchaseOrder[], months = 12) {
  const start = startOfMonth(subMonths(new Date(), months - 1));
  const out = Array.from({ length: months }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    return { key: format(d, "yyyy-MM"), month: format(d, "MMM yy"), spend: 0, count: 0 };
  });
  for (const po of pos.filter(isSpend)) {
    const p = out.find((x) => x.key === format(parseISO(po.createdAt), "yyyy-MM"));
    if (p) {
      p.spend += poTotals(po).total;
      p.count += 1;
    }
  }
  return out.map((p) => ({ ...p, spend: Math.round(p.spend) }));
}

export function spendBy(pos: PurchaseOrder[], keyOf: (po: PurchaseOrder) => string) {
  const m: Record<string, number> = {};
  for (const po of pos.filter(isSpend)) m[keyOf(po)] = (m[keyOf(po)] ?? 0) + poTotals(po).total;
  return m;
}

export const nameOf = <T extends { id: string; name: string }>(
  list: T[],
  id: string | null | undefined,
) => list.find((x) => x.id === id)?.name ?? "—";
export const supplierName = (s: Supplier[], id: string) => nameOf(s, id);

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
