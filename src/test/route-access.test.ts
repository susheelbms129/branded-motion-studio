import { describe, expect, it } from "vitest";

import {
  decideAccess,
  signedOutDestination,
  type AccountType,
  type Area,
  type Who,
} from "@/lib/route-access";

const people: Record<string, Who> = {
  stranger: {
    signedIn: false,
    type: "buyer",
    hasBuyerWorkspace: false,
    hasSupplierWorkspace: false,
  },
  "new buyer": {
    signedIn: true,
    type: "buyer",
    hasBuyerWorkspace: false,
    hasSupplierWorkspace: false,
  },
  buyer: { signedIn: true, type: "buyer", hasBuyerWorkspace: true, hasSupplierWorkspace: false },
  "new supplier": {
    signedIn: true,
    type: "supplier",
    hasBuyerWorkspace: false,
    hasSupplierWorkspace: false,
  },
  supplier: {
    signedIn: true,
    type: "supplier",
    hasBuyerWorkspace: false,
    hasSupplierWorkspace: true,
  },
};

// Every area x every kind of person. If someone changes a rule, the expected table below must change on purpose.
const expected: Record<Area, Record<string, string | "open">> = {
  "buyer-app": {
    stranger: "/buyer/signin",
    "new buyer": "/buyer/onboarding",
    buyer: "open",
    "new supplier": "/supplier/dashboard",
    supplier: "/supplier/dashboard",
  },
  "buyer-onboarding": {
    stranger: "/buyer/signin",
    "new buyer": "open",
    buyer: "/buyer/dashboard",
    "new supplier": "/supplier/dashboard",
    supplier: "/supplier/dashboard",
  },
  "supplier-page": {
    stranger: "/supplier/signin",
    "new buyer": "/buyer/dashboard",
    buyer: "/buyer/dashboard",
    "new supplier": "/supplier/onboarding",
    supplier: "open",
  },
  "supplier-onboarding": {
    stranger: "/supplier/signin",
    "new buyer": "/buyer/dashboard",
    buyer: "/buyer/dashboard",
    "new supplier": "open",
    supplier: "/supplier/dashboard",
  },
};

describe("who may open what", () => {
  for (const area of Object.keys(expected) as Area[]) {
    for (const [name, who] of Object.entries(people)) {
      it(`${area}: ${name}`, () => {
        const a = decideAccess(area, who);
        const want = expected[area][name];
        if (want === "open") expect(a).toEqual({ ok: true });
        else expect(a).toEqual({ ok: false, redirect: want });
      });
    }
  }

  it("a supplier is never let into any buyer area, even with a buyer workspace on record", () => {
    const sneaky: Who = {
      signedIn: true,
      type: "supplier",
      hasBuyerWorkspace: true,
      hasSupplierWorkspace: true,
    };
    expect(decideAccess("buyer-app", sneaky).ok).toBe(false);
    expect(decideAccess("buyer-onboarding", sneaky).ok).toBe(false);
  });

  it("a buyer is never let into any supplier area, even with a supplier workspace on record", () => {
    const sneaky: Who = {
      signedIn: true,
      type: "buyer",
      hasBuyerWorkspace: true,
      hasSupplierWorkspace: true,
    };
    expect(decideAccess("supplier-page", sneaky).ok).toBe(false);
    expect(decideAccess("supplier-onboarding", sneaky).ok).toBe(false);
  });

  it("nobody is sent to the other side's pages as a destination, except their own home", () => {
    for (const area of Object.keys(expected) as Area[]) {
      for (const who of Object.values(people)) {
        const a = decideAccess(area, who);
        if (a.ok || !who.signedIn) continue;
        const own = (t: AccountType) => (t === "buyer" ? "/buyer/" : "/supplier/");
        const sameSide = area.startsWith(who.type);
        // A signed-in person who is bounced goes to their own side, unless they are on their own side's setup/dashboard flow.
        expect(a.redirect.startsWith(own(who.type)) || sameSide).toBe(true);
      }
    }
  });
});

describe("signing out with a private page open", () => {
  it("sends every private buyer page to the buyer sign-in", () => {
    for (const p of [
      "/buyer/dashboard",
      "/buyer/dashboard/",
      "/buyer/dashboard/requests/new",
      "/buyer/onboarding",
      "/app",
      "/app/team",
    ]) {
      expect(signedOutDestination(p)).toBe("/buyer/signin");
    }
  });
  it("sends every private supplier page to the supplier sign-in, including pages added later", () => {
    for (const p of [
      "/supplier/dashboard",
      "/supplier/onboarding",
      "/supplier/products",
      "/supplier/verification",
      "/supplier/anything-new",
    ]) {
      expect(signedOutDestination(p)).toBe("/supplier/signin");
    }
  });
  it("leaves public pages alone", () => {
    for (const p of [
      "/",
      "/buyer/signin",
      "/buyer/signup",
      "/supplier/signin",
      "/supplier/signup",
      "/accept-invite",
      "/get-started",
      "/supplierx",
      "/applause",
    ]) {
      expect(signedOutDestination(p)).toBeNull();
    }
  });
});
