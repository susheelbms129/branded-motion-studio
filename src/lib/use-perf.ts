import { useMemo } from "react";

import { computeSupplierPerformance, type SupplierPerformance } from "@/lib/performance";
import { useWs } from "@/lib/ws-store";

export function usePerf(): Record<string, SupplierPerformance> {
  const suppliers = useWs((s) => s.suppliers),
    pos = useWs((s) => s.purchaseOrders),
    rfqs = useWs((s) => s.rfqs),
    quotations = useWs((s) => s.quotations);
  return useMemo(
    () =>
      Object.fromEntries(
        suppliers.map((s) => [s.id, computeSupplierPerformance(s.id, pos, rfqs, quotations)]),
      ),
    [suppliers, pos, rfqs, quotations],
  );
}
