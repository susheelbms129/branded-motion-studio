import { describe, expect, it } from "vitest";

import { checkGstin, gstinProblem } from "@/lib/gstin";

describe("GST number pre-check", () => {
  it("accepts real-world numbers", () => {
    for (const g of ["27AAPFU0939F1ZV", "07AAGFF2194N1Z1", "24AAACC1206D1ZM", "27AAACR5055K1Z7"]) {
      expect(checkGstin(g).checksumOk).toBe(true);
      expect(gstinProblem(g)).toBe("");
    }
  });
  it("catches a typo through the checksum", () => {
    expect(checkGstin("27AAPFU0939F1ZW").checksumOk).toBe(false);
    expect(gstinProblem("27AAPFU0939F1ZW")).toMatch(/typo/);
  });
  it("rejects wrong format and short input", () => {
    expect(checkGstin("HELLO").formatOk).toBe(false);
    expect(gstinProblem("27AAPF")).toMatch(/15 characters/);
    expect(gstinProblem("")).toBe("");
  });
  it("is tolerant of case and spaces, and compares the state", () => {
    const r = checkGstin(" 27aapfu0939f1zv ", "maharashtra");
    expect(r.checksumOk && r.stateMatches).toBe(true);
    expect(checkGstin("27AAPFU0939F1ZV", "Karnataka").stateMatches).toBe(false);
    expect(checkGstin("27AAPFU0939F1ZV").stateMatches).toBeNull();
  });
});
