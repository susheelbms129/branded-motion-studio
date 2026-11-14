import { useCallback, useEffect, useRef, useState } from "react";

import { listSavedSuppliers, type DirectorySupplier } from "@/lib/directory-api";

export interface SavedPreview {
  status: "idle" | "loading" | "ready" | "error";
  /** How many suppliers the company has saved in total (from the database). */
  total: number;
  /** The first page only (newest first). Enough for the dashboard; the full list lives on the Saved suppliers page. */
  items: DirectorySupplier[];
  message: string;
  reload: () => void;
}

/**
 * The buyer dashboard's view of the shortlist. Everything comes from list_saved_suppliers() in the database, which decides
 * who may read it, so a company can only ever see its own list. The browser keeps nothing between visits.
 */
export function useSavedPreview(orgId: string | null): SavedPreview {
  const [state, setState] = useState<Omit<SavedPreview, "reload">>({ status: "idle", total: 0, items: [], message: "" });
  const ticket = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    if (!orgId) {
      setState({ status: "idle", total: 0, items: [], message: "" });
      return;
    }
    setState((s) => ({ ...s, status: "loading", message: "" }));
    try {
      const page = await listSavedSuppliers(orgId, 0);
      if (mine === ticket.current) setState({ status: "ready", total: page.total, items: page.items, message: "" });
    } catch (e) {
      if (mine === ticket.current) {
        setState((s) => ({ ...s, status: "error", message: e instanceof Error ? e.message : "We couldn't load your saved suppliers." }));
      }
    }
  }, [orgId]);

  useEffect(() => {
    void load();
    // A late answer for a company we have since left must never be shown.
    return () => {
      ticket.current++;
    };
  }, [load]);

  return { ...state, reload: () => void load() };
}
