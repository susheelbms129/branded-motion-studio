import { describe, expect, it } from "vitest";

import {
  appliesText, daysText, deductionText, matchesFilter, payError, STATUS_LABEL, statusTone, udyamProblem, type PayState, type PayStatus,
} from "@/lib/msme-payments";
import { SUPPLIER_NAV } from "@/lib/supplier-nav";
import { MODULES } from "@/lib/modules";

describe("Udyam number check", () => {
  it("accepts the real format, with spaces and lower case", () => {
    expect(udyamProblem("UDYAM-MH-12-1234567")).toBe("");
    expect(udyamProblem(" udyam-mh-12-1234567 ")).toBe("");
    expect(udyamProblem("UDYAM MH 12 1234567".replace(/ /g, "-"))).toBe("");
  });
  it("explains what is wrong", () => {
    expect(udyamProblem("")).toMatch(/Enter/);
    expect(udyamProblem("UDYAM-MH-1-12345")).toMatch(/look like/);
    expect(udyamProblem("MH-12-1234567")).toMatch(/look like/);
    expect(udyamProblem("UDYAM-M1-12-1234567")).toMatch(/look like/);
    expect(udyamProblem("UDYAM-MH-12-12345678")).toMatch(/look like/);
  });
});

describe("days text", () => {
  it("speaks plainly", () => {
    expect(daysText(null)).toBe("");
    expect(daysText(0)).toBe("due today");
    expect(daysText(1)).toBe("1 day left");
    expect(daysText(5)).toBe("5 days left");
    expect(daysText(-1)).toBe("1 day overdue");
    expect(daysText(-30)).toBe("30 days overdue");
  });
});

describe("status words and colours", () => {
  const all: PayStatus[] = ["none", "not_started", "on_hold", "on_track", "due_soon", "due_today", "overdue", "paid", "paid_late"];
  it("every status has words, so colour is never the only signal", () => {
    for (const s of all) expect(STATUS_LABEL[s].length).toBeGreaterThan(2);
  });
  it("overdue is red, soon is amber, paid in time is green", () => {
    expect(statusTone("overdue")).toBe("red");
    expect(statusTone("due_soon")).toBe("amber");
    expect(statusTone("due_today")).toBe("amber");
    expect(statusTone("paid")).toBe("green");
    expect(statusTone("paid_late")).toBe("amber");
    expect(statusTone("none")).toBe("grey");
  });
});

describe("who the rule covers, in words", () => {
  it("covered", () => {
    expect(appliesText({ applies: "yes", applies_why: "small" }, "buyer")).toMatch(/small enterprise.*applies to you/);
    expect(appliesText({ applies: "yes", applies_why: "micro" }, "supplier")).toMatch(/micro enterprise/);
  });
  it("traders and medium suppliers are outside it", () => {
    expect(appliesText({ applies: "no", applies_why: "trader" }, "buyer")).toMatch(/trader/);
    expect(appliesText({ applies: "no", applies_why: "medium" }, "supplier")).toMatch(/medium/);
  });
  it("unknown asks for the Udyam proof from the right side", () => {
    expect(appliesText({ applies: "unknown", applies_why: "no_udyam" }, "buyer")).toMatch(/Ask them/);
    expect(appliesText({ applies: "unknown", applies_why: "no_udyam" }, "supplier")).toMatch(/Add your Udyam/);
  });
});

describe("the tax-year sentence", () => {
  const fmt = (n: number) => `Rs ${n}`;
  const d = (x: string) => x;
  const s = (deduction: PayState["deduction"]) => ({ deduction, fy_end: "2027-03-31", balance: 500 });
  it("warns when the deduction is at risk", () => expect(deductionText(s("at_risk"), fmt, d)).toBe("Pay Rs 500 by 2027-03-31. If it is still unpaid then, this expense can only be deducted next year."));
  it("says so when it already moved", () => expect(deductionText(s("deferred"), fmt, d)).toMatch(/year of payment/));
  it("is quiet when there is nothing to say", () => expect(deductionText(s("na"), fmt, d)).toBe(""));
  it("reassures when safe", () => expect(deductionText(s("safe"), fmt, d)).toMatch(/safe/));
});

describe("tracker tabs", () => {
  const st = (status: PayStatus, deduction: PayState["deduction"] = "na") => ({ status, deduction });
  it("needs attention: overdue, due soon, due today; for buyers also deduction at risk", () => {
    expect(matchesFilter(st("overdue"), "attention", "buyer")).toBe(true);
    expect(matchesFilter(st("due_soon"), "attention", "supplier")).toBe(true);
    expect(matchesFilter(st("on_track", "at_risk"), "attention", "buyer")).toBe(true);
    expect(matchesFilter(st("on_track", "at_risk"), "attention", "supplier")).toBe(false);
    expect(matchesFilter(st("on_hold"), "attention", "supplier")).toBe(true);
    expect(matchesFilter(st("on_hold"), "attention", "buyer")).toBe(false);
    expect(matchesFilter(st("on_track"), "attention", "buyer")).toBe(false);
  });
  it("open and paid are opposites", () => {
    for (const s of ["not_started", "on_hold", "on_track", "due_soon", "due_today", "overdue"] as PayStatus[]) {
      expect(matchesFilter(st(s), "open", "buyer")).toBe(true);
      expect(matchesFilter(st(s), "paid", "buyer")).toBe(false);
    }
    expect(matchesFilter(st("paid"), "paid", "buyer")).toBe(true);
    expect(matchesFilter(st("paid_late"), "paid", "supplier")).toBe(true);
    expect(matchesFilter(st("paid"), "open", "buyer")).toBe(false);
    expect(matchesFilter(st("none"), "open", "buyer")).toBe(false);
  });
  it("all shows everything", () => expect(matchesFilter(st("none"), "all", "buyer")).toBe(true));
});

describe("errors", () => {
  it("turn database codes into sentences", () => {
    expect(payError(new Error("too_much: only 100 is still owed"))).toBe("That's more than is still owed.");
    expect(payError({ message: "invalid_date: the payment date must be between delivery and today" })).toMatch(/future/);
    expect(payError(new Error("not_delivered: record the delivery first"))).toMatch(/Record the delivery/);
    expect(payError(new Error("Could not find the function public.list_payables"))).toMatch(/migration 20/);
    expect(payError(new Error("boom"))).toMatch(/Something went wrong/);
  });
  it("a missing explanation shows the database's own words", () => {
    expect(payError(new Error("note_required: say what is wrong (10 to 500 characters)"))).toBe("say what is wrong (10 to 500 characters)");
  });
});

describe("menus", () => {
  it("the supplier menu has a payments page that does not share a label with the buyer menu", () => {
    const item = SUPPLIER_NAV.find((i) => i.key === "payments");
    expect(item?.to).toBe("/supplier/payments");
    expect(Object.values(MODULES).map((m) => m.label.toLowerCase())).not.toContain(item!.label.toLowerCase());
  });
  it("the buyer menu has Payments", () => expect(MODULES.payments.path).toBe("payments"));
});
