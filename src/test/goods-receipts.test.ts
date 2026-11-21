import { describe, expect, it } from "vitest";

import {
  checkDraft, fmtQty, initialDraft, parseQty, photoPath, photoProblem, progress, receivingError, responseLabel, standing,
  type DraftLine, type Receiving, type ReceivingLine,
} from "@/lib/goods-receipts";

const line = (o: Partial<ReceivingLine> = {}): ReceivingLine => ({
  id: "l1", description: "Steel rods", unit: "Nos", ordered: 100, accepted: 0, rejected: 0, remaining: 100, ...o,
});
const lines = [line(), line({ id: "l2", description: "Steel plates", ordered: 50, remaining: 50 })];
const TODAY = "2026-11-21";
const dr = (o: Partial<DraftLine>, i = 0): DraftLine[] => initialDraft(lines).map((d, j) => (j === i ? { ...d, ...o } : d));

describe("quantities", () => {
  it("reads what people type", () => {
    expect(parseQty("60")).toBe(60);
    expect(parseQty(" 12.5 ")).toBe(12.5);
    expect(parseQty("1,250")).toBe(1250);
    expect(parseQty("")).toBe(0);
  });
  it("refuses what is not a quantity", () => {
    for (const x of ["abc", "-1", "1.2345", "1e3", "1..2", "٣"]) expect(parseQty(x), x).toBeNull();
  });
  it("shows quantities without trailing zeros", () => {
    expect(fmtQty(100)).toBe("100");
    expect(fmtQty(12.5)).toBe("12.5");
    expect(fmtQty(0.1 + 0.2)).toBe("0.3");
  });
});

describe("the form starts as 'everything still to come arrived fine'", () => {
  it("fills what is still to be accepted", () => {
    expect(initialDraft([line({ accepted: 60, remaining: 40 }), line({ id: "l2", remaining: 0, accepted: 50, ordered: 50 })]).map((d) => d.accepted)).toEqual(["40", ""]);
  });
});

describe("checking a delivery before sending it", () => {
  it("accepts the default form", () => {
    const c = checkDraft(initialDraft(lines), lines, TODAY, TODAY);
    expect(c.ok).toBe(true);
    expect(c.acceptedTotal).toBe(150);
    expect(c.lines).toHaveLength(2);
  });
  it("sends only items that have a quantity", () => {
    const c = checkDraft(dr({ accepted: "" }), lines, TODAY, TODAY);
    expect(c.ok && c.lines.map((x) => x.lineId)).toEqual(["l2"]);
  });
  it("refuses an empty delivery", () => {
    expect(checkDraft(dr({ accepted: "" }, 0).map((d) => ({ ...d, accepted: "" })), lines, TODAY, TODAY).error).toBe("Enter a quantity for at least one item.");
  });
  it("never accepts more than is still to come", () => {
    expect(checkDraft(dr({ accepted: "101" }), lines, TODAY, TODAY).error).toBe("Steel rods: only 100 Nos are still to be accepted.");
  });
  it("needs a reason for a rejection, and keeps it", () => {
    expect(checkDraft(dr({ accepted: "60", rejected: "10" }), lines, TODAY, TODAY).error).toBe("Steel rods: say why the goods were rejected.");
    const c = checkDraft(dr({ accepted: "60", rejected: "10", reason: "  bent in transit " }), lines, TODAY, TODAY);
    expect(c.ok).toBe(true);
    expect(c.lines[0]).toEqual({ lineId: "l1", accepted: 60, rejected: 10, reason: "bent in transit" });
    expect(c.rejectedTotal).toBe(10);
  });
  it("drops a stray reason when nothing was rejected", () => {
    const c = checkDraft(dr({ reason: "leftover" }), lines, TODAY, TODAY);
    expect(c.lines[0]!.reason).toBe("");
  });
  it("cannot reject more than was ordered", () => {
    expect(checkDraft(dr({ accepted: "0", rejected: "101", reason: "all bad" }), lines, TODAY, TODAY).error).toContain("cannot reject more than was ordered");
  });
  it("checks the date", () => {
    expect(checkDraft(initialDraft(lines), lines, "", TODAY).error).toBe("Choose the date the goods arrived.");
    expect(checkDraft(initialDraft(lines), lines, "2026-11-22", TODAY).error).toBe("The delivery date cannot be in the future.");
    expect(checkDraft(initialDraft(lines), lines, "2026-10-01", TODAY, "2026-10-15").error).toBe("The delivery date cannot be before the order was placed.");
    expect(checkDraft(initialDraft(lines), lines, "2026-10-15", TODAY, "2026-10-15").ok).toBe(true);
  });
  it("names the item whose quantity is not a number", () => {
    expect(checkDraft(dr({ accepted: "ten" }), lines, TODAY, TODAY).error).toContain("Steel rods");
  });
});

describe("progress and where the order stands", () => {
  it("counts only accepted goods, never more than ordered", () => {
    const p = progress([line({ accepted: 60, remaining: 40 }), line({ id: "l2", ordered: 50, accepted: 50, remaining: 0 })]);
    expect(p).toEqual({ percent: 73, accepted: 110, ordered: 150 });
    expect(progress([])).toEqual({ percent: 0, accepted: 0, ordered: 0 });
  });
  const base = { po_status: "partially_received", lines, closed_short: false, legacy: false, delivered_at: null } as Pick<Receiving, "po_status" | "lines" | "closed_short" | "legacy" | "delivered_at">;
  it("says nothing is received yet", () => {
    expect(standing({ ...base, po_status: "acknowledged" }, "buyer")).toBe("Nothing received yet.");
  });
  it("explains a rejection with nothing accepted, without promising a start date", () => {
    expect(standing({ ...base, lines: [line({ rejected: 10 })] }, "supplier")).toContain("Goods were rejected and nothing is accepted yet");
  });
  it("explains a partial delivery and what starts the payment period", () => {
    const t = standing({ ...base, lines: [line({ accepted: 60, remaining: 40 })] }, "buyer");
    expect(t).toContain("Partly received (60% accepted)");
    expect(t).toContain("closes it as short-delivered");
  });
  it("says the payment period runs once everything is accepted or closed short", () => {
    expect(standing({ ...base, po_status: "received" }, "buyer")).toBe("Everything was accepted. The payment period is running.");
    expect(standing({ ...base, po_status: "received", closed_short: true }, "supplier")).toContain("short-delivered");
  });
  it("is honest about orders delivered before receipts existed", () => {
    expect(standing({ ...base, po_status: "received", legacy: true }, "buyer")).toContain("only the date is known");
  });
});

describe("the supplier's answer, photos and error words", () => {
  it("words the supplier's answer", () => {
    expect(responseLabel({ supplier_response: "agreed" })).toEqual({ text: "Supplier agreed", tone: "good" });
    expect(responseLabel({ supplier_response: "disputed" }).tone).toBe("bad");
    expect(responseLabel({ supplier_response: null }).text).toBe("Waiting for the supplier");
  });
  it("accepts only photos", () => {
    expect(photoProblem({ type: "image/jpeg", size: 1 })).toBeNull();
    expect(photoProblem({ type: "image/webp", size: 1 })).toBeNull();
    expect(photoProblem({ type: "application/pdf", size: 1 })).toContain("JPG, PNG or WEBP");
  });
  it("builds the folder path the private bucket requires", () => {
    expect(photoPath("org-1", "rcpt-2", "JPG", "abc")).toBe("org-1/rcpt-2/abc.jpg");
    expect(photoPath("org-1", "rcpt-2", "../x", "abc")).toBe("org-1/rcpt-2/abc.x");
    expect(photoPath("o", "r", "", "n")).toBe("o/r/n.jpg");
  });
  it("shows the database's own detailed messages, and plain words for the rest", () => {
    expect(receivingError(new Error("over_received: only 40 still to accept of Steel rods"))).toBe("Only 40 still to accept of Steel rods");
    expect(receivingError(new Error("locked: a payment or an objection already depends on this delivery"))).toContain("already depends");
    expect(receivingError(new Error("not_receivable"))).toContain("can't take a delivery");
    expect(receivingError(new Error("Could not find the function public.get_po_receiving"))).toContain("migration 26");
    expect(receivingError(new Error("boom"))).toContain("Something went wrong");
  });
});
