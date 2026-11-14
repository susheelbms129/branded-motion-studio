import { describe, expect, it } from "vitest";

import { badgeAlt, badgeSvg, type BadgeLevel } from "@/lib/passport-badge";
import { badgeHtml, badgePath, passportPath, passportUrl, quoteFooter, whatsappUrl } from "@/lib/passport-api";

describe("the shareable badge", () => {
  const levels: BadgeLevel[] = [0, 1, 2, 3, null];

  it("is valid-looking SVG for every level, with an accessible label", () => {
    for (const l of levels) {
      const s = badgeSvg(l);
      expect(s.startsWith("<svg ")).toBe(true);
      expect(s.endsWith("</svg>")).toBe(true);
      expect(s).toContain(`aria-label="${badgeAlt(l)}"`);
    }
  });

  it("says the truth for each level and never claims verification when there is none", () => {
    expect(badgeSvg(1)).toContain("Registered");
    expect(badgeSvg(2)).toContain(">Verified<");
    expect(badgeSvg(3)).toContain("Verified + Certificates");
    expect(badgeSvg(0)).toContain("Not verified today");
    expect(badgeSvg(null)).toContain("Not available");
    expect(badgeSvg(0)).not.toMatch(/>Verified</);
    expect(badgeSvg(null)).not.toMatch(/Registered|>Verified</);
  });

  it("only ever draws fixed words: no company name can be injected", () => {
    for (const l of levels) {
      expect(badgeSvg(l)).not.toMatch(/<script|onload|javascript:|&lt;|<!\[CDATA/i);
    }
  });

  it("each level has its own colour and the width fits the text", () => {
    const fills = new Set([0, 1, 2, 3].map((l) => /x="\d+" width="\d+" height="32" fill="(#[0-9a-f]{6})"/.exec(badgeSvg(l as BadgeLevel))![1]));
    expect(fills.size).toBe(4);
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(w(badgeSvg(3))).toBeGreaterThan(w(badgeSvg(1)));
  });
});

describe("the links a supplier shares", () => {
  it("build from the site address and the company slug", () => {
    expect(passportPath("kaveri-industrial")).toBe("/verified/kaveri-industrial");
    expect(badgePath("kaveri-industrial")).toBe("/api/public/badge/kaveri-industrial");
    expect(passportUrl("https://vendora.in", "kaveri-industrial")).toBe("https://vendora.in/verified/kaveri-industrial");
  });

  it("the badge code links to the page and shows the live badge", () => {
    const h = badgeHtml("https://vendora.in", "kaveri-industrial");
    expect(h).toContain('href="https://vendora.in/verified/kaveri-industrial"');
    expect(h).toContain('src="https://vendora.in/api/public/badge/kaveri-industrial"');
    expect(h).toContain('rel="noopener"');
  });

  it("the quotation line carries the link", () => {
    expect(quoteFooter("https://vendora.in", "a-b")).toContain("https://vendora.in/verified/a-b");
  });

  it("the WhatsApp message carries the company name and the link, safely encoded", () => {
    const u = whatsappUrl("https://vendora.in", "a-b", "Kaveri & Sons");
    expect(u.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(u.slice("https://wa.me/?text=".length));
    expect(text).toContain("Kaveri & Sons is verified on Vendora");
    expect(text).toContain("https://vendora.in/verified/a-b");
    expect(u).not.toContain("&Sons");
  });
});
