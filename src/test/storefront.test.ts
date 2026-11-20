import { describe, expect, it } from "vitest";

import { profileProblems, toForm, toInput, type FormState } from "@/features/supplier/CompanyProfilePage";
import {
  isUuid,
  jsonLdText,
  logoPath,
  parseImage,
  productPhotoPath,
  sitemapXml,
  storefrontDescription,
  storefrontJsonLd,
  storefrontPath,
  storefrontUrl,
  storefrontWhatsappUrl,
  type PublicStorefront,
} from "@/lib/storefront-api";

const sf = {
  slug: "kaveri-industrial",
  name: "Kaveri Industrial",
  city: "Coimbatore",
  state: "Tamil Nadu",
  country: "India",
  business_type: "Manufacturer",
  year_established: 2009,
  tagline: "Food-grade packaging in 3 days",
  description: "We make food-grade packaging for dairy and bakery brands across South India.",
  has_logo: true,
  categories: ["Packaging Materials"],
  show_prices: false,
  products: [{ id: "a", name: "Cup 200ml", category: "Packaging Materials", description: "", unit: "Pieces", moq: 500, price: null, currency: "INR", availability: "Available", has_photo: false }],
  product_count: 1,
  delivery: null,
  service_areas: [{ country: "India", state: "Karnataka", city: "Bengaluru" }],
  as_of: "2026-12-04",
  updated_at: "2026-12-04T10:00:00Z",
  passport: { level: 2, level_name: "Verified" },
} as unknown as PublicStorefront;

describe("storefront links", () => {
  it("builds the public address, the photo addresses and the share link", () => {
    expect(storefrontPath("kaveri-industrial")).toBe("/s/kaveri-industrial");
    expect(storefrontUrl("https://vendora.in", "kaveri-industrial")).toBe("https://vendora.in/s/kaveri-industrial");
    expect(logoPath("kaveri-industrial")).toBe("/api/public/storefront-image/kaveri-industrial/logo");
    expect(productPhotoPath("kaveri-industrial", "x")).toBe("/api/public/storefront-image/kaveri-industrial/x");
    expect(decodeURIComponent(storefrontWhatsappUrl("https://vendora.in", "kaveri-industrial", "Kaveri Industrial"))).toContain("https://vendora.in/s/kaveri-industrial");
  });
  it("only accepts real uuids as photo ids", () => {
    expect(isUuid("3f2b8c1e-5a4d-4e8b-9c1a-2b3c4d5e6f70")).toBe(true);
    expect(isUuid("logo")).toBe(false);
    expect(isUuid("../etc/passwd")).toBe(false);
  });
});

describe("images served to Google", () => {
  it("decodes a plain png and refuses everything else", () => {
    const ok = parseImage("data:image/png;base64,iVBORw0KGgo=");
    expect(ok?.type).toBe("image/png");
    expect(ok?.bytes.length).toBeGreaterThan(0);
    expect(parseImage("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(parseImage("data:text/html;base64,PGI+")).toBeNull();
    expect(parseImage("https://evil.example/x.png")).toBeNull();
  });
});

describe("what Google reads", () => {
  it("describes the company with its headline and its proof level", () => {
    const d = storefrontDescription(sf);
    expect(d).toContain("Kaveri Industrial");
    expect(d).toContain("Coimbatore, Tamil Nadu");
    expect(d).toContain("Food-grade packaging in 3 days");
    expect(d).toContain("Verified on Vendora");
    expect(d.length).toBeLessThanOrEqual(300);
  });
  it("structured data never carries a phone, email or price that is hidden", () => {
    const text = JSON.stringify(storefrontJsonLd(sf, "https://vendora.in"));
    expect(text).not.toMatch(/telephone|email|price/i);
    expect(text).toContain("https://vendora.in/s/kaveri-industrial");
    expect(text).toContain("https://vendora.in/api/public/storefront-image/kaveri-industrial/logo");
  });
  it("shows a price in structured data only when the owner made it public", () => {
    const priced = { ...sf, products: [{ ...sf.products[0]!, price: 12.5 }] } as PublicStorefront;
    expect(JSON.stringify(storefrontJsonLd(priced, "https://vendora.in"))).toContain('"price":12.5');
  });
  it("cannot close the script tag early", () => {
    expect(jsonLdText({ a: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
  it("the sitemap lists the home page and storefronts, escapes text and drops bad slugs", () => {
    const x = sitemapXml("https://vendora.in", [
      { slug: "kaveri-industrial", updated_at: "2026-12-04T10:00:00Z" },
      { slug: "bad slug<>", updated_at: "2026-12-04T10:00:00Z" },
      { slug: "no-date", updated_at: "not a date" },
    ]);
    expect(x).toContain("<loc>https://vendora.in/</loc>");
    expect(x).toContain("<loc>https://vendora.in/s/kaveri-industrial</loc>");
    expect(x).toContain("<lastmod>2026-12-04T10:00:00.000Z</lastmod>");
    expect(x).not.toContain("bad slug");
    expect(x).toContain("<loc>https://vendora.in/s/no-date</loc></url>");
  });
});

const good: FormState = {
  tagline: "",
  description: "x".repeat(60),
  categories: ["Chemicals"],
  logo: null,
  contactName: "Asha Rao",
  designation: "",
  email: "asha@example.com",
  phoneCode: "+91",
  phone: "98450 12345",
  altPhone: "",
  coverage: ["Across India"],
  deliveryTime: "",
  minOrderValue: "",
  deliveryOptions: [],
  pickup: "",
  locations: [],
};

describe("company profile form", () => {
  it("accepts a complete form", () => {
    expect(profileProblems(good)).toEqual({});
  });
  it("explains each missing piece the same way the database will", () => {
    const e = profileProblems({ ...good, description: "short", categories: [], contactName: "A", email: "nope", phone: "12", coverage: [], minOrderValue: "-3" });
    expect(Object.keys(e).sort()).toEqual(["categories", "contactName", "coverage", "description", "email", "minOrderValue", "phone"]);
  });
  it("sends an empty minimum order as null and drops delivery areas without a country", () => {
    const i = toInput({ ...good, minOrderValue: "", locations: [{ country: "", state: "", city: "" }, { country: " India ", state: "Goa", city: "" }] });
    expect(i.minOrderValue).toBeNull();
    expect(i.locations).toEqual([{ country: "India", state: "Goa", city: "" }]);
  });
  it("round-trips what the database returned", () => {
    const f = toForm({
      profile: { tagline: "t", description: "d", logo: null, categories: ["A"], contact_name: "n", designation: "", email: "e@x.co", phone_code: "", phone: "1234567", alt_phone: "" },
      capabilities: { coverage: ["Across India"], delivery_time: "1–3 days", min_order_value: 5000, currency: "INR", delivery_options: [], pickup: "Yes" },
      locations: [],
    } as never);
    expect(f.phoneCode).toBe("+91");
    expect(f.minOrderValue).toBe("5000");
    expect(toInput(f).minOrderValue).toBe(5000);
  });
});
