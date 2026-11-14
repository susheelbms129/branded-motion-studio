import { create } from "zustand";

import { loadSavedIds, saveSupplier, unsaveSupplier } from "@/lib/directory-api";

/**
 * Which suppliers this company has saved. The browser only remembers the answer for speed; the database decides who may
 * read or change the list, and a stale answer here can never grant anything.
 */
interface SavedState {
  orgId: string | null;
  ids: ReadonlySet<string>;
  status: "idle" | "loading" | "ready" | "error";
  busy: ReadonlySet<string>;
  load: (orgId: string) => Promise<void>;
  /** Saves or removes right away on screen, undoes it if the database says no, and throws that reason. Returns the new state. */
  toggle: (orgId: string, supplierId: string) => Promise<boolean>;
  reset: () => void;
}

export const useSaved = create<SavedState>((set, get) => ({
  orgId: null,
  ids: new Set(),
  status: "idle",
  busy: new Set(),
  async load(orgId) {
    const cur = get();
    if (cur.orgId === orgId && (cur.status === "ready" || cur.status === "loading")) return;
    set({ orgId, ids: new Set(), status: "loading", busy: new Set() });
    try {
      const ids = await loadSavedIds(orgId);
      if (get().orgId === orgId) set({ ids: new Set(ids), status: "ready" });
    } catch {
      if (get().orgId === orgId) set({ status: "error" });
    }
  },
  async toggle(orgId, supplierId) {
    const { ids, busy } = get();
    if (get().orgId !== orgId || busy.has(supplierId)) return ids.has(supplierId);
    const was = ids.has(supplierId);
    const apply = (on: boolean, working: boolean) =>
      set((s) => {
        const nextIds = new Set(s.ids);
        if (on) nextIds.add(supplierId);
        else nextIds.delete(supplierId);
        const nextBusy = new Set(s.busy);
        if (working) nextBusy.add(supplierId);
        else nextBusy.delete(supplierId);
        return { ids: nextIds, busy: nextBusy };
      });
    apply(!was, true);
    try {
      if (was) await unsaveSupplier(orgId, supplierId);
      else await saveSupplier(orgId, supplierId);
      apply(!was, false);
      return !was;
    } catch (e) {
      apply(was, false);
      throw e;
    }
  },
  reset: () => set({ orgId: null, ids: new Set(), status: "idle", busy: new Set() }),
}));
