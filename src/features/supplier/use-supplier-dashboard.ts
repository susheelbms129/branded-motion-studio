import { useCallback, useEffect, useMemo, useState } from "react";

import { loadSupplierDashboard, type DashboardData } from "@/lib/supplier-dashboard-api";
import { computeStrength, type Strength } from "@/lib/supplier-strength";

/** Loads the dashboard for the supplier's own company. Ignores a late answer if the page was left or the company changed. */
export function useSupplierDashboard(orgId: string | null, name: string, state: string) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(
    async (live: { on: boolean }) => {
      if (!orgId) {
        setStatus("error");
        return;
      }
      setStatus("loading");
      try {
        const d = await loadSupplierDashboard(orgId, name, state);
        if (live.on) {
          setData(d);
          setStatus("ready");
        }
      } catch {
        if (live.on) setStatus("error");
      }
    },
    [orgId, name, state],
  );

  useEffect(() => {
    const live = { on: true };
    void load(live);
    return () => {
      live.on = false;
    };
  }, [load]);

  const strength: Strength | null = useMemo(
    () => (data ? computeStrength(data.strength) : null),
    [data],
  );
  return { data, strength, status, reload: () => void load({ on: true }) };
}
