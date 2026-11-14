import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODULES } from "@/lib/modules";
import { appPath } from "@/lib/nav";
import {
  buyerAppGuard,
  buyerOnboardingGuard,
  supplierOnboardingGuard,
  supplierPageGuard,
} from "@/lib/route-guards";
import { routeTree } from "@/routeTree.gen";
import { SUPPLIER_NAV } from "@/lib/supplier-nav";

// ── what each guard is allowed to be asked, and what the test pretends the database says ──
const auth = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  signedInAccountType: vi.fn(),
  requireSupplier: vi.fn(),
  hasSupplierWorkspace: vi.fn(),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  ...auth,
}));

const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
type AnyRoute = {
  id: string;
  fullPath: string;
  parentRoute?: AnyRoute;
  options: { beforeLoad?: unknown };
};
const routes = Object.values(router.routesById as unknown as Record<string, AnyRoute>).filter(
  (r) => r.id !== "__root__",
);

/**
 * Every guard that runs before a page opens: the page's own and those of its parent layouts. TanStack Router runs
 * parent guards first, so a page with its own extra guard (for example a redirect-only one) is still behind its parent's.
 */
function guardsOf(r: AnyRoute): unknown[] {
  const out: unknown[] = [];
  for (let x: AnyRoute | undefined = r; x; x = x.parentRoute)
    if (x.options.beforeLoad) out.push(x.options.beforeLoad);
  return out;
}

// Pages anyone may open. Anything not here, and not under a private area, makes the test fail on purpose:
// a new page has to be classified as public or private before it can go live.
const PUBLIC = new Set([
  "/",
  "/accept-invite",
  "/get-started",
  "/login",
  "/signin",
  "/signup",
  "/onboarding",
  "/buyer/signin",
  "/buyer/signup",
  "/supplier/signin",
  "/supplier/signup",
  "/api/public/resend-webhook",
]);

describe("every page is public on purpose or guarded", () => {
  it("lists the routes it checked (guards against an empty test)", () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it("every buyer page runs the buyer guard (own or inherited), never a supplier guard", () => {
    const buyer = routes.filter(
      (r) => r.id.startsWith("/buyer/dashboard") || r.id.startsWith("/app"),
    );
    expect(buyer.length).toBeGreaterThan(20);
    for (const r of buyer) expect(guardsOf(r), r.id).toContain(buyerAppGuard);
  });

  it("buyer setup runs the buyer-setup guard", () => {
    expect(guardsOf(routes.find((r) => r.id === "/buyer/onboarding")!)).toContain(
      buyerOnboardingGuard,
    );
  });

  it("every supplier page after setup runs the supplier guard", () => {
    const pages = routes.filter(
      (r) => r.id.startsWith("/supplier/") && !PUBLIC.has(r.id) && r.id !== "/supplier/onboarding",
    );
    expect(pages.map((r) => r.id).sort()).toEqual(
      expect.arrayContaining([
        "/supplier/dashboard",
        "/supplier/products",
        "/supplier/verification",
      ]),
    );
    for (const r of pages) expect(guardsOf(r), r.id).toContain(supplierPageGuard);
  });

  it("supplier setup runs the supplier-setup guard", () => {
    expect(guardsOf(routes.find((r) => r.id === "/supplier/onboarding")!)).toContain(
      supplierOnboardingGuard,
    );
  });

  it("the reviewer page has its own guard", () => {
    const admin = routes.filter((r) => r.id.startsWith("/admin"));
    expect(admin.length).toBeGreaterThan(0);
    for (const r of admin) expect(guardsOf(r).length, r.id).toBeGreaterThan(0);
  });

  it("no route is left unclassified", () => {
    const known = (r: AnyRoute) =>
      PUBLIC.has(r.id) ||
      /^\/(buyer\/dashboard|app|admin|supplier\/(dashboard|products|verification|onboarding)|buyer\/onboarding)/.test(
        r.id,
      );
    const loose = routes.filter((r) => !known(r)).map((r) => r.id);
    expect(
      loose,
      `Classify these pages as public (add to PUBLIC) or guard them: ${loose.join(", ")}`,
    ).toEqual([]);
  });

  it("the two sides never share a URL: buyer pages are not under /supplier, supplier pages not under /buyer or /app", () => {
    for (const r of routes) {
      if (guardsOf(r).includes(buyerAppGuard))
        expect(r.id.startsWith("/supplier"), r.id).toBe(false);
      if (guardsOf(r).includes(supplierPageGuard))
        expect(/^\/(buyer|app)/.test(r.id), r.id).toBe(false);
    }
  });
});

describe("menus only link to pages that exist and are guarded for that side", () => {
  it("every supplier menu link is a real supplier-guarded page", () => {
    for (const item of SUPPLIER_NAV) {
      if (item.to === null) continue;
      const r = routes.find((x) => x.id === item.to);
      expect(r, item.to).toBeDefined();
      expect(guardsOf(r!), item.to).toContain(supplierPageGuard);
    }
  });
  it("every buyer menu link is a real buyer-guarded page", () => {
    for (const m of Object.values(MODULES)) {
      const to = appPath(m.path);
      const r = routes.find((x) => x.id === to || x.id === `${to}/`);
      expect(r, to).toBeDefined();
      expect(guardsOf(r!), to).toContain(buyerAppGuard);
    }
  });
});

// ── the guards themselves, with the database's answers faked ──
const redirectTarget = async (p: Promise<unknown>) => {
  try {
    await p;
    return "open";
  } catch (e) {
    const o = e as { options?: { to?: string } };
    if (o?.options?.to) return o.options.to;
    throw e;
  }
};

describe("the guards send each person to the right place", () => {
  beforeEach(() => Object.values(auth).forEach((f) => f.mockReset()));

  it("a buyer who opens a supplier page lands on the buyer dashboard (and the supplier workspace is never even asked)", async () => {
    auth.requireSupplier.mockResolvedValue("buyer");
    expect(await redirectTarget(supplierPageGuard())).toBe("/buyer/dashboard");
    expect(auth.hasSupplierWorkspace).not.toHaveBeenCalled();
  });
  it("a stranger on a supplier page lands on the supplier sign-in", async () => {
    auth.requireSupplier.mockResolvedValue("signin");
    expect(await redirectTarget(supplierPageGuard())).toBe("/supplier/signin");
  });
  it("a supplier who has not finished setup is sent to setup", async () => {
    auth.requireSupplier.mockResolvedValue("ok");
    auth.hasSupplierWorkspace.mockResolvedValue(false);
    expect(await redirectTarget(supplierPageGuard())).toBe("/supplier/onboarding");
  });
  it("a finished supplier gets in, and cannot reopen setup", async () => {
    auth.requireSupplier.mockResolvedValue("ok");
    auth.hasSupplierWorkspace.mockResolvedValue(true);
    expect(await redirectTarget(supplierPageGuard())).toBe("open");
    expect(await redirectTarget(supplierOnboardingGuard())).toBe("/supplier/dashboard");
  });
  it("a supplier who opens a buyer page lands on the supplier dashboard", async () => {
    auth.requireWorkspace.mockResolvedValue("ok");
    auth.signedInAccountType.mockResolvedValue("supplier");
    expect(await redirectTarget(buyerAppGuard())).toBe("/supplier/dashboard");
    expect(await redirectTarget(buyerOnboardingGuard())).toBe("/supplier/dashboard");
  });
  it("a stranger on a buyer page lands on the buyer sign-in without the account type being looked up", async () => {
    auth.requireWorkspace.mockResolvedValue("signin");
    expect(await redirectTarget(buyerAppGuard())).toBe("/buyer/signin");
    expect(auth.signedInAccountType).not.toHaveBeenCalled();
  });
  it("a buyer without a company is sent to setup; with one, to the workspace", async () => {
    auth.signedInAccountType.mockResolvedValue("buyer");
    auth.requireWorkspace.mockResolvedValue("onboarding");
    expect(await redirectTarget(buyerAppGuard())).toBe("/buyer/onboarding");
    auth.requireWorkspace.mockResolvedValue("ok");
    expect(await redirectTarget(buyerAppGuard())).toBe("open");
    expect(await redirectTarget(buyerOnboardingGuard())).toBe("/buyer/dashboard");
  });
  it("if the account lookup fails, the page does NOT open (it never guesses)", async () => {
    auth.requireWorkspace.mockResolvedValue("ok");
    auth.signedInAccountType.mockRejectedValue(new Error("network"));
    await expect(buyerAppGuard()).rejects.toThrow("network");
    auth.requireSupplier.mockRejectedValue(new Error("network"));
    await expect(supplierPageGuard()).rejects.toThrow("network");
  });
});
