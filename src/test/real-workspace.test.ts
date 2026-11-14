import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the database: one signed-in person who belongs to one buyer company.
const db = vi.hoisted(() => ({ userId: "user-1", company: "Acme Foods" }));

interface Chain {
  select: () => Chain;
  eq: () => Chain;
  order: () => Chain;
  then: (resolve: (v: unknown) => unknown) => Promise<unknown>;
}

vi.mock("@/lib/supabase", () => {
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (resolve) =>
      Promise.resolve({
        data: [{ role: "owner", businesses: { id: "org-1", name: db.company, kind: "buyer" } }],
        error: null,
      }).then(resolve),
  };
  return {
    isSupabaseConfigured: true,
    getSupabase: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: db.userId, email: `${db.userId}@example.com`, user_metadata: { name: "Test Buyer" } } } },
        }),
      },
      from: () => chain,
    }),
  };
});

import { clearAuthCache, requireWorkspace } from "@/lib/auth";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";

describe("a real company workspace", () => {
  beforeEach(() => {
    clearAuthCache();
    db.userId = "user-1";
    db.company = "Acme Foods";
    useUi.setState({ demo: true });
    useWs.getState().reset(true); // the browser still holds sample data from an earlier visit
  });

  it("never shows sample data, and shows the company name from the database", async () => {
    expect(useWs.getState().suppliers.length).toBeGreaterThan(0);
    expect(await requireWorkspace()).toBe("ok");
    expect(useUi.getState().demo).toBe(false);
    expect(useUi.getState().orgId).toBe("org-1");
    expect(useWs.getState().suppliers).toHaveLength(0);
    expect(useWs.getState().requests).toHaveLength(0);
    expect(useWs.getState().organizations[0]?.name).toBe("Acme Foods");
  });

  it("does not carry one person's workspace over to the next person who signs in", async () => {
    await requireWorkspace();
    useWs.getState().updateOrg({ industry: "Steel" });
    expect(useWs.getState().organizations[0]?.industry).toBe("Steel");

    clearAuthCache();
    db.userId = "user-2";
    db.company = "Other Traders";
    await requireWorkspace();
    expect(useWs.getState().organizations[0]?.industry).toBe("—");
    expect(useWs.getState().organizations[0]?.name).toBe("Other Traders");
  });
});
