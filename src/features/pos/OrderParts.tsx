import { Panel } from "@/components/vendora/kit";
import { formatDate, formatMoney, type CurrencyCode } from "@/lib/format";
import type { OrderAmounts, OrderLine } from "@/lib/orders-api";

export const asCurrency = (c: string | undefined): CurrencyCode =>
  (["INR", "USD", "EUR", "AED"].includes(c ?? "") ? c : "INR") as CurrencyCode;

/** Lines and money of one order. Used by both the buyer and the supplier page, so both always show the same numbers. */
export function OrderLines({
  lines,
  amounts,
  currency,
}: {
  lines: OrderLine[];
  amounts: OrderAmounts;
  currency: CurrencyCode;
}) {
  const m = (n: number, decimals = 0) => formatMoney(n, { currency, decimals });
  return (
    <Panel title="Line items" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
              <th className="px-5 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">GST</th>
              <th className="px-5 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-5 py-3">{l.description}</td>
                <td className="px-3 py-3 text-right tabular">
                  {l.qty} {l.unit}
                </td>
                <td className="px-3 py-3 text-right tabular">{m(l.unit_price, 2)}</td>
                <td className="px-3 py-3 text-right tabular">{l.gst_rate}%</td>
                <td className="px-5 py-3 text-right tabular">{m(l.qty * l.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="space-y-1.5 border-t p-5 text-sm">
        {(
          [
            ["Subtotal", amounts.subtotal],
            ["GST", amounts.gst],
            ["Shipping", amounts.shipping],
            ["Other charges", amounts.other_charges],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between text-muted-foreground">
            <dt>{k}</dt>
            <dd className="tabular">{m(v)}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 text-base font-semibold">
          <dt>Total landed cost</dt>
          <dd className="tabular">{m(amounts.total)}</dd>
        </div>
      </dl>
    </Panel>
  );
}

export function DetailList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const day = (d: string | null) => (d ? formatDate(d) : "—");
