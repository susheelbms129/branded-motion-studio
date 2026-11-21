import { describe, expect, it } from "vitest";

import { fillTemplate, looksLikeNotFound, normalizeTaxpayer, toIsoDate } from "../../supabase/functions/_shared/gst-normalize";

const rec = { gstin: "29AABCT1332L1ZN", lgnm: "KAVERI INDUSTRIES PRIVATE LIMITED", tradeNam: "Kaveri Industries", sts: "ACTIVE", rgdt: "01/07/2017", ctb: "Private Limited Company" };

describe("GST provider response normalizer", () => {
  it("reads a bare GSTN record", () => {
    expect(normalizeTaxpayer(rec)).toEqual({
      legal_name: "KAVERI INDUSTRIES PRIVATE LIMITED", trade_name: "Kaveri Industries", gst_status: "Active",
      registered_on: "2017-07-01", cancelled_on: null, constitution: "Private Limited Company",
      state: "Karnataka", // worked out from the first two digits of the GST number
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
  it("reads the gstinapi.in response shape (status, registration_date, business_constitution)", () => {
    const body = { success: true, gstin: "33AAACC1206D1ZN", credits_remaining: 9, data: { gstin: "33AAACC1206D1ZN", legal_name: "CENTRAL WAREHOUSING CORPORATION", trade_name: "CENTRAL WAREHOUSING CORPORATION", status: "Active", registration_date: "2017-07-01", cancellation_date: null, business_constitution: null } };
    expect(normalizeTaxpayer(body)).toMatchObject({ legal_name: "CENTRAL WAREHOUSING CORPORATION", gst_status: "Active", registered_on: "2017-07-01", cancelled_on: null });
    expect(normalizeTaxpayer({ success: true, data: { legal_name: "X", status: "Cancelled", cancellation_date: "2024-03-01" } })).toMatchObject({ gst_status: "Cancelled", cancelled_on: "2024-03-01" });
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

  it("reads the full gstinapi.in identity: type, address built from parts, city, state, pincode, block status", () => {
    const body = { success: true, data: { gstin: "33AAACC1206D1ZN", legal_name: "CENTRAL WAREHOUSING CORPORATION", trade_name: "CENTRAL WAREHOUSING CORPORATION", status: "Active", taxpayer_type: "Regular", registration_date: "2017-07-01", state_code: "33", address: "Registered business address", city: "Chennai", pincode: "600015", nature_of_business: null, block_status: "Unblocked",
      address_details: { building_number: "No.4", building_name: "Thiruvalar Illam", floor: null, street: "North Avenue", locality: "Srinagar Colony", district: null, city: null, state: null, landmark: null, pincode: "600015" } } };
    expect(normalizeTaxpayer(body, "33AAACC1206D1ZN")).toMatchObject({
      taxpayer_type: "Regular", city: "Chennai", state: "Tamil Nadu", pincode: "600015", block_status: "Unblocked",
      address: "No.4, Thiruvalar Illam, North Avenue, Srinagar Colony, Chennai, Tamil Nadu 600015",
    });
  });
  it("uses a real flat address, never the placeholder", () => {
    expect(normalizeTaxpayer({ data: { legal_name: "X", address: "Shop 12, Business Park, Mumbai", pincode: "400001", state_code: "27" } })?.address).toBe("Shop 12, Business Park, Mumbai");
    expect(normalizeTaxpayer({ data: { legal_name: "X", address: "Registered business address", city: "Pune" } })?.address).toBeUndefined();
  });
  it("reads the raw GSTN shape (pradr, nba list)", () => {
    expect(normalizeTaxpayer({ lgnm: "RAW", sts: "Active", pradr: { adr: "1 MG Road, Bengaluru, Karnataka, 560001" }, nba: ["Retail Business", "Supplier of Services"] }, "29AABCT1332L1ZN"))
      .toMatchObject({ address: "1 MG Road, Bengaluru, Karnataka, 560001", nature_of_business: "Retail Business, Supplier of Services" });
  });
});
