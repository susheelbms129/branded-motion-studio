import { describe, expect, it } from "vitest";

import { confirmMessage, hourLabel, normalizePhone, quietLabel, recentLabel } from "@/lib/whatsapp";
import { classify } from "@/server/whatsapp/cloud.server";
import { appLink, cleanParam, compose, digestLine, isStopReply, wording, type ClaimedRow, type WaEnv } from "@/server/whatsapp/message.server";
import { hmacHex, safeEqual, verifyBearer, verifyMetaSignature } from "@/server/whatsapp/verify.server";

const env: WaEnv = { appUrl: "https://app.vendora.in/", alertTemplate: "vendora_alert", verifyTemplate: "vendora_verify_code", language: "en" };
const ID = "123e4567-e89b-12d3-a456-426614174000";
const row = (o: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: "m1", kind: "rfq", title: "Kaveri sent a quote", body: "Steel rods", link_to: `rfqs/${ID}`, merged: 1, attempts: 1,
  phone: "+919876543210", digest: { quotes: 3, lowest: 92000, average: 100000 }, ...o,
});

describe("phone numbers", () => {
  it("takes an Indian mobile number in the ways people type it", () => {
    for (const x of ["98765 43210", "09876543210", "+91 98765-43210", "919876543210", "0091 98765 43210", " 98765.43210 "]) expect(normalizePhone(x), x).toBe("+919876543210");
  });
  it("keeps other countries when a + is given", () => expect(normalizePhone("+1 (415) 555-0132")).toBe("+14155550132"));
  it("refuses what cannot be a mobile number", () => {
    for (const x of ["", "12345", "5876543210", "abc", "+0123456789", "+91", "98765"]) expect(normalizePhone(x), x).toBeNull();
  });
});

describe("wording", () => {
  it("a buyer's alert leads with the verdict from the real quotes", () => {
    expect(wording(row()).detail).toBe("3 quotes in. Lowest ₹92,000, 8% below the average. Totals include GST and freight.");
  });
  it("is honest when quotes are all close, and when only one is in", () => {
    expect(digestLine({ quotes: 3, lowest: 99800, average: 100000 })).toContain("all close to ₹1,00,000");
    expect(digestLine({ quotes: 1, lowest: 50000, average: 50000 })).toContain("First quote is in: ₹50,000");
  });
  it("says how many updates were merged into one message", () => {
    expect(wording(row({ merged: 3 })).headline).toBe("3 updates on your RFQ: Steel rods");
  });
  it("falls back to the plain text when there are no numbers", () => {
    expect(wording(row({ digest: null })).detail).toBe("Steel rods.");
  });
  it("a supplier is only told about its own request, with no digest and no prices", () => {
    const w = wording(row({ link_to: `quote-requests/${ID}`, digest: null, title: "New quote request from Alpha Mills" }));
    expect(w.headline).toBe("New quote request from Alpha Mills");
    expect(w.detail).toBe("Steel rods. Open it to send your quote.");
  });
  it("orders: one update or several", () => {
    expect(wording(row({ kind: "po", link_to: `orders/${ID}`, title: "New purchase order", body: "PO-2026-0001 · Steel" })).detail).toBe("PO-2026-0001 · Steel.");
    expect(wording(row({ kind: "po", merged: 2, body: "PO acknowledged" })).detail).toBe("2 updates. Latest: PO acknowledged.");
  });
});

describe("template messages", () => {
  it("builds an alert with exactly three clean variables and a deep link", () => {
    const m = compose(row(), env);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.message.to).toBe("919876543210");
    expect(m.message.template).toBe("vendora_alert");
    const params = (m.message.components[0] as { parameters: { text: string }[] }).parameters.map((p) => p.text);
    expect(params).toHaveLength(3);
    expect(params[2]).toBe(`https://app.vendora.in/buyer/dashboard/rfqs/${ID}`);
    for (const p of params) expect(p).not.toMatch(/[\n\t]| {2,}/);
  });
  it("links each kind to the right side of the app, and never to anything else", () => {
    expect(appLink("https://a.in", `orders/${ID}`)).toBe(`https://a.in/supplier/orders/${ID}`);
    expect(appLink("https://a.in", `quote-requests/${ID}`)).toBe(`https://a.in/supplier/quote-requests/${ID}`);
    expect(appLink("https://a.in", `purchase-orders/${ID}`)).toBe(`https://a.in/buyer/dashboard/purchase-orders/${ID}`);
    for (const bad of ["https://evil.example/x", "rfqs/../admin", "rfqs/not-a-uuid", "", null, `rfqs/${ID}/x`]) expect(appLink("https://a.in", bad as string | null), String(bad)).toBeNull();
    expect(compose(row({ link_to: "https://evil.example" }), env)).toMatchObject({ ok: true });
  });
  it("a verification code goes in the body AND the button, as WhatsApp requires", () => {
    const m = compose(row({ kind: "verify", body: "482913", link_to: null, digest: null }), env);
    expect(m.ok && m.message.template).toBe("vendora_verify_code");
    if (m.ok) expect(m.message.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "482913" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482913" }] },
    ]);
  });
  it("refuses a bad code, a bad number or a missing app url instead of sending rubbish", () => {
    expect(compose(row({ kind: "verify", body: "12" }), env)).toEqual({ ok: false, error: "bad_code" });
    expect(compose(row({ phone: "+12" }), env)).toEqual({ ok: false, error: "bad_phone" });
    expect(compose(row(), { ...env, appUrl: "" })).toEqual({ ok: false, error: "app_url_missing" });
  });
  it("cleans variables the way WhatsApp demands", () => {
    expect(cleanParam("a\n\nb\t c   d")).toBe("a b c d");
    expect(cleanParam("   ")).toBe("Vendora");
    expect(cleanParam("x".repeat(500), 50)).toHaveLength(50);
  });
});

describe("the two doors", () => {
  it("accepts Meta's signature only for the exact body and secret", async () => {
    const body = '{"entry":[]}';
    const sig = `sha256=${await hmacHex("app-secret", body)}`;
    expect(await verifyMetaSignature("app-secret", body, sig)).toBe(true);
    expect(await verifyMetaSignature("app-secret", body + " ", sig)).toBe(false);
    expect(await verifyMetaSignature("other", body, sig)).toBe(false);
    expect(await verifyMetaSignature("app-secret", body, null)).toBe(false);
    expect(await verifyMetaSignature("app-secret", body, "sha256=zz")).toBe(false);
    expect(await verifyMetaSignature("", body, sig)).toBe(false);
  });
  it("the sender job needs the long shared secret", () => {
    const s = "a".repeat(32);
    expect(verifyBearer(s, `Bearer ${s}`)).toBe(true);
    expect(verifyBearer(s, `Bearer ${s}x`)).toBe(false);
    expect(verifyBearer(s, s)).toBe(false);
    expect(verifyBearer(s, null)).toBe(false);
    expect(verifyBearer("short", "Bearer short")).toBe(false);
    expect(verifyBearer("", "Bearer ")).toBe(false);
    expect(safeEqual("ab", "abc")).toBe(false);
  });
  it("understands STOP in the usual ways, and nothing else", () => {
    for (const x of ["STOP", " stop ", "Stop.", "unsubscribe", "BAND"]) expect(isStopReply(x), x).toBe(true);
    for (const x of ["please don't stop", "ok", "stop sending quotes at night", ""]) expect(isStopReply(x), x).toBe(false);
  });
});

describe("how WhatsApp problems are handled", () => {
  it("our own setup problems wait (hold); temporary ones retry; a number that cannot be reached fails", () => {
    expect(classify(401, 190, "expired").outcome).toBe("hold");
    expect(classify(400, 132001, "template missing").outcome).toBe("hold");
    expect(classify(400, 131048, "spam").outcome).toBe("hold");
    expect(classify(429, 130429, "rate").outcome).toBe("retry");
    expect(classify(500, undefined, "oops").outcome).toBe("retry");
    expect(classify(400, 131026, "not on whatsapp").outcome).toBe("failed");
  });
});

describe("the settings panel's words", () => {
  it("hours and quiet hours", () => {
    expect(hourLabel(0)).toBe("12 am");
    expect(hourLabel(12)).toBe("12 pm");
    expect(hourLabel(21)).toBe("9 pm");
    expect(quietLabel(21, 8)).toBe("Quiet from 9 pm to 8 am (India time)");
    expect(quietLabel(9, 9)).toBe("No quiet hours");
  });
  it("wrong code tells how many tries are left", () => {
    expect(confirmMessage({ ok: false, error: "wrong_code", left: 4 })).toBe("That code isn't right. 4 tries left.");
    expect(confirmMessage({ ok: false, error: "wrong_code", left: 1 })).toBe("That code isn't right. 1 try left.");
    expect(confirmMessage({ ok: false, error: "expired" })).toContain("expired");
  });
  it("messages get a plain word", () => {
    const r = { kind: "rfq", title: "t", created_at: "x", delivered: false, merged: 1 } as const;
    expect(recentLabel({ ...r, status: "sent" }).text).toBe("Sent");
    expect(recentLabel({ ...r, status: "sent", delivered: true }).text).toBe("Delivered");
    expect(recentLabel({ ...r, status: "queued" }).tone).toBe("wait");
    expect(recentLabel({ ...r, status: "failed" }).tone).toBe("bad");
    expect(recentLabel({ ...r, status: "skipped" }).text).toBe("Not sent");
  });
});
