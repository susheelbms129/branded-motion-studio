import { describe, expect, it } from "vitest";

import { MODULES } from "@/lib/modules";
import { appPath } from "@/lib/nav";
import { SUPPLIER_NAV } from "@/lib/supplier-nav";

// Buyers and suppliers are two separate products on one site. These checks make sure the two menus never mix,
// so a future change that adds a buyer page to the supplier menu (or the reverse) fails here before anyone sees it.
describe("buyer and supplier menus stay separate", () => {
  const buyerLabels = Object.values(MODULES).map((m) => m.label.toLowerCase());

  it("every supplier menu link lives under /supplier", () => {
    for (const item of SUPPLIER_NAV) {
      if (item.to !== null) expect(item.to.startsWith("/supplier/")).toBe(true);
    }
  });

  it("no supplier menu link points into the buyer area", () => {
    for (const item of SUPPLIER_NAV) {
      expect(String(item.to ?? "")).not.toMatch(/^\/(buyer|app)(\/|$)/);
    }
  });

  it("the supplier menu has no buyer-only page (only the word Dashboard is shared)", () => {
    const shared = SUPPLIER_NAV.map((i) => i.label.toLowerCase()).filter((l) => buyerLabels.includes(l));
    expect(shared).toEqual(["dashboard"]);
  });

  it("the supplier menu is exactly what a supplier needs", () => {
    expect(SUPPLIER_NAV.map((i) => i.label)).toEqual(["Dashboard", "Trust Passport", "Products", "Company profile"]);
  });

  it("every buyer page lives under /buyer/dashboard, never under /supplier", () => {
    for (const m of Object.values(MODULES)) {
      expect(appPath(m.path).startsWith("/buyer/dashboard")).toBe(true);
    }
  });
});
