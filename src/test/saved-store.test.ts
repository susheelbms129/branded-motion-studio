import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  loadSavedIds: vi.fn(),
  saveSupplier: vi.fn(),
  unsaveSupplier: vi.fn(),
}));
vi.mock("@/lib/directory-api", () => api);

import { useSaved } from "@/lib/saved-store";

const ORG = "00000000-0000-4000-8000-000000000001";
const SUP = "00000000-0000-4000-8000-0000000000aa";

describe("saved suppliers store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSaved.getState().reset();
  });

  it("loads the saved ids once per company", async () => {
    api.loadSavedIds.mockResolvedValue([SUP]);
    await useSaved.getState().load(ORG);
    await useSaved.getState().load(ORG);
    expect(api.loadSavedIds).toHaveBeenCalledTimes(1);
    expect(useSaved.getState().ids.has(SUP)).toBe(true);
  });

  it("saves on screen at once and keeps it when the database agrees", async () => {
    api.loadSavedIds.mockResolvedValue([]);
    api.saveSupplier.mockResolvedValue(undefined);
    await useSaved.getState().load(ORG);
    const p = useSaved.getState().toggle(ORG, SUP);
    expect(useSaved.getState().ids.has(SUP)).toBe(true); // optimistic
    await expect(p).resolves.toBe(true);
    expect(useSaved.getState().ids.has(SUP)).toBe(true);
    expect(useSaved.getState().busy.has(SUP)).toBe(false);
  });

  it("puts everything back and tells the reason when the database refuses", async () => {
    api.loadSavedIds.mockResolvedValue([]);
    api.saveSupplier.mockRejectedValue(new Error("Only owners can do that."));
    await useSaved.getState().load(ORG);
    await expect(useSaved.getState().toggle(ORG, SUP)).rejects.toThrow("Only owners");
    expect(useSaved.getState().ids.has(SUP)).toBe(false);
    expect(useSaved.getState().busy.has(SUP)).toBe(false);
  });

  it("removes a saved supplier, and ignores a second click while one is in flight", async () => {
    api.loadSavedIds.mockResolvedValue([SUP]);
    let done: () => void = () => undefined;
    api.unsaveSupplier.mockReturnValue(new Promise<void>((r) => (done = r)));
    await useSaved.getState().load(ORG);
    const first = useSaved.getState().toggle(ORG, SUP);
    await useSaved.getState().toggle(ORG, SUP); // ignored
    done();
    await first;
    expect(api.unsaveSupplier).toHaveBeenCalledTimes(1);
    expect(useSaved.getState().ids.has(SUP)).toBe(false);
  });

  it("never carries one company's list into another", async () => {
    api.loadSavedIds.mockResolvedValueOnce([SUP]).mockResolvedValueOnce([]);
    await useSaved.getState().load(ORG);
    await useSaved.getState().load("00000000-0000-4000-8000-000000000002");
    expect(useSaved.getState().ids.size).toBe(0);
  });
});
