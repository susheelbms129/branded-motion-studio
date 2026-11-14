import { describe, expect, it } from "vitest";

import { fillTemplate, looksLikeNotFound, normalizeTaxpayer, toIsoDate } from "../../supabase/functions/_shared/gst-normalize";

const rec = { gstin: "29AABCT1332L1ZN", lgnm: "KAVERI INDUSTRIES PRIVATE LIMITED", tradeNam: "Kaveri Industries", sts: "ACTIVE", rgdt: "01/07/2017", ctb: "Private Limited Company" };

describe("GST provider response normalizer", () => {
  it("reads a bare GSTN record", () => {
    expect(normalizeTaxpayer(rec)).toEqual({
      legal_name: "KAVERI INDUSTRIES PRIVATE LIMITED", trade_name: "Kaveri Industries", gst_status: "Active",
      registered_on: "2017-07-01", cancelled_on: null, constitution: "Private Limited Company",
    });
  });
  it("finds the record inside different provider wrappers", () => {
    expect(normalizeTaxpayer({ code: 200, data: { data: rec } })?.gst_status).toBe("Active");
    expect(normalizeTaxpayer({ status: "success", result: { taxpayer: rec } })?.legal_name).toMatch(/KAVERI/);
    expect(normalizeTaxpayer({ data: { legal_name: "Acme Ltd", status: "ok", gstin_status: "Cancelled", cancellation_date: "2024-02-29" } })).toMatchObject({ gst_status: "Cancelled", cancelled_on: "2024-02-29" });
  });
  it("never treats a wrapper 'status: success' as the GST status", () => {
    expect(normalizeTaxpayer({ status: "success", data: { lgnm: "X Co" } })?.gst_status).toBe("Unknown");
  });
  it("returns null when there is no taxpayer record", () => {
    expect(normalizeTaxpayer({ error: "invalid" })).toBeNull();
    expect(normalizeTaxpayer(null)).toBeNull();
    expect(normalizeTaxpayer("text")).toBeNull();
  });
  it("parses dates strictly", () => {
    expect(toIsoDate("19/06/2023")).toBe("2023-06-19");
    expect(toIsoDate("2023-06-19T10:00:00Z")).toBe("2023-06-19");
    expect(toIsoDate("31/02/2023")).toBeNull();
    expect(toIsoDate("garbage")).toBeNull();
  });
  it("tells 'number not found' apart from 'provider broken'", () => {
    expect(looksLikeNotFound(404, "")).toBe(true);
    expect(looksLikeNotFound(400, '{"error":"Invalid GSTIN"}')).toBe(true);
    expect(looksLikeNotFound(401, "invalid api key not found")).toBe(false);
    expect(looksLikeNotFound(500, "not found")).toBe(false);
    expect(looksLikeNotFound(429, "")).toBe(false);
    expect(looksLikeNotFound(200, "ok")).toBe(false);
  });
  it("escapes the GST number inside URL and JSON templates", () => {
    expect(fillTemplate("https://x/api?g={{gstin}}", "A&b=c", "url")).toBe("https://x/api?g=A%26b%3Dc");
    expect(JSON.parse(fillTemplate('{"gstin":"{{gstin}}"}', 'a"b', "json"))).toEqual({ gstin: 'a"b' });
  });
});
