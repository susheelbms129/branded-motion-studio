import { describe, expect, it } from "vitest";

import type { DirectorySupplier } from "@/lib/directory-api";
import { isVerified, trustWatch, watchLabel } from "@/lib/sourcing-health";

const TODAY = new Date(2026, 10, 14); // 14 Nov 2026

function sup(over: Partial<DirectorySupplier> & { name: string }): DirectorySupplier {
  return {
    org_id: `id-${over.name}`,
    city: "Bengaluru",
    state: "Karnataka",
    categories: [],
    description: "",
    level: 2,
    level_name: "Verified",
    valid_through: "2027-06-01",
    proofs: 2,
    government_checked: true,
    ...over,
  };
}

describe("trust watch", () => {
  it("stays quiet when every saved supplier is verified for a long time", () => {
    expect(trustWatch([sup({ name: "A" }), sup({ name: "B", level: 3 })], TODAY)).toEqual([]);
  });

  it("flags suppliers with nothing verified", () => {
    const w = trustWatch([sup({ name: "New", level: 0, valid_through: null, proofs: 0 })], TODAY);
    expect(w).toHaveLength(1);
    expect(w[0]?.kind).toBe("unverified");
    expect(watchLabel(w[0]!)).toBe("Not verified yet");
  });

  it("flags proofs that end within 30 days, and not later ones", () => {
    const w = trustWatch(
      [sup({ name: "Soon", valid_through: "2026-11-24" }), sup({ name: "Edge", valid_through: "2026-12-14" }), sup({ name: "Later", valid_through: "2026-12-15" })],
      TODAY,
    );
    expect(w.map((x) => x.supplier.name)).toEqual(["Soon", "Edge"]);
    expect(w[0]?.daysLeft).toBe(10);
    expect(watchLabel(w[0]!)).toBe("Proof ends in 10 days");
  });

  it("words today and tomorrow naturally", () => {
    const w = trustWatch([sup({ name: "T0", valid_through: "2026-11-14" }), sup({ name: "T1", valid_through: "2026-11-15" })], TODAY);
    expect(w.map(watchLabel)).toEqual(["Proof ends today", "Proof ends tomorrow"]);
  });

  it("puts the soonest expiry first, then unverified suppliers", () => {
    const w = trustWatch(
      [
        sup({ name: "Zed", level: 0, valid_through: null }),
        sup({ name: "Later", valid_through: "2026-12-10" }),
        sup({ name: "Sooner", valid_through: "2026-11-20" }),
      ],
      TODAY,
    );
    expect(w.map((x) => x.supplier.name)).toEqual(["Sooner", "Later", "Zed"]);
  });

  it("ignores proofs that already ended and unreadable dates", () => {
    const w = trustWatch([sup({ name: "Old", valid_through: "2026-10-01" }), sup({ name: "Odd", valid_through: "not-a-date" })], TODAY);
    expect(w).toEqual([]);
  });

  it("counts only level 2 and 3 as verified", () => {
    expect([0, 1, 2, 3].map((level) => isVerified({ level: level as 0 | 1 | 2 | 3 }))).toEqual([false, false, true, true]);
  });
});
