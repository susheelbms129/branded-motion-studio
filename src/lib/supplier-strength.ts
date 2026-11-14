/**
 * "Storefront strength": how ready a supplier's public storefront is to win buyers, as a score out of 100 plus a ranked
 * list of next steps. Pure functions on purpose (no browser, no database), so a test can prove the rules and the page
 * can never show a number the rules did not produce.
 *
 * Every step says WHY it matters to a buyer. That is the point: a supplier does not fill a profile "because the app
 * asked", they do it because it moves them up in what buyers see.
 */

export type TrustLevel = 0 | 1 | 2 | 3;

export interface StrengthInput {
  descriptionLength: number;
  hasLogo: boolean;
  categoryCount: number;
  hasContact: boolean;
  productCount: number;
  pricedProductCount: number;
  hasCoverage: boolean;
  hasDeliveryTime: boolean;
  hasMinOrder: boolean;
  locationCount: number;
  trustLevel: TrustLevel;
  /** Proofs waiting on the supplier (rejected or expired). */
  proofsNeedingFix: number;
  /** Proofs the supplier submitted that a reviewer has not finished. */
  proofsInReview: number;
}

export interface Step {
  key: string;
  title: string;
  why: string;
  /** Points added to the score when done. */
  points: number;
  done: boolean;
  /** Where the supplier goes to do it. null = that page is not built yet. */
  to: "/supplier/verification" | null;
  cta: string;
}

export interface Strength {
  score: number;
  tier: "Getting started" | "Taking shape" | "Buyer-ready" | "Standout";
  steps: Step[];
  /** Open steps, biggest gain first. */
  next: Step[];
}

/** Points per area. They add up to exactly 100 (a test checks this). */
export const WEIGHTS = {
  description: 10,
  logo: 5,
  categories: 5,
  contact: 5,
  products: 15,
  prices: 5,
  capabilities: 10,
  locations: 5,
  registered: 15,
  verified: 15,
  certified: 10,
} as const;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeStrength(i: StrengthInput): Strength {
  const steps: Step[] = [
    {
      key: "registered",
      title: "Verify your GST registration",
      points: WEIGHTS.registered,
      done: i.trustLevel >= 1,
      why: "Buyers filter by verified suppliers first. Unverified companies are skipped before anyone reads the profile.",
      to: "/supplier/verification",
      cta: i.proofsNeedingFix > 0 ? "Fix your proof" : "Start",
    },
    {
      key: "verified",
      title: "Add address and bank proof",
      points: WEIGHTS.verified,
      done: i.trustLevel >= 2,
      why: "Reaches the Verified level, the one buyers trust before sending a purchase order.",
      to: "/supplier/verification",
      cta: "Add proof",
    },
    {
      key: "certified",
      title: "Show a quality certificate",
      points: WEIGHTS.certified,
      done: i.trustLevel >= 3,
      why: "ISO, BIS or FSSAI with its expiry date. Buyers with compliance rules need this to shortlist you.",
      to: "/supplier/verification",
      cta: "Add certificate",
    },
    {
      key: "products",
      title: "List at least 3 products",
      points: WEIGHTS.products,
      done: i.productCount >= 3,
      why: "Buyers search for what they need to buy. A supplier with no products cannot be found by that search.",
      to: null,
      cta: "Soon",
    },
    {
      key: "prices",
      title: "Show a price on your products",
      points: WEIGHTS.prices,
      done: i.productCount > 0 && i.pricedProductCount / i.productCount >= 0.5,
      why: "Suppliers that show a price get compared. Suppliers that hide it get skipped.",
      to: null,
      cta: "Soon",
    },
    {
      key: "description",
      title: "Write what makes you different",
      points: WEIGHTS.description,
      done: i.descriptionLength >= 120,
      why: "Two or three honest sentences about what you make, who you serve and how fast you deliver.",
      to: null,
      cta: "Soon",
    },
    {
      key: "capabilities",
      title: "Set delivery time and minimum order",
      points: WEIGHTS.capabilities,
      done: i.hasCoverage && i.hasDeliveryTime && i.hasMinOrder,
      why: "Answers the first two questions every buyer asks, so they do not have to message you to find out.",
      to: null,
      cta: "Soon",
    },
    {
      key: "logo",
      title: "Add your logo",
      points: WEIGHTS.logo,
      done: i.hasLogo,
      why: "A logo makes your card the one buyers recognise when they see it twice.",
      to: null,
      cta: "Soon",
    },
    {
      key: "categories",
      title: "Pick your categories",
      points: WEIGHTS.categories,
      done: i.categoryCount > 0,
      why: "Categories decide which buyer searches you appear in.",
      to: null,
      cta: "Soon",
    },
    {
      key: "contact",
      title: "Add a contact person",
      points: WEIGHTS.contact,
      done: i.hasContact,
      why: "Buyers trust a named person over a generic company inbox.",
      to: null,
      cta: "Soon",
    },
    {
      key: "locations",
      title: "Say where you deliver",
      points: WEIGHTS.locations,
      done: i.locationCount > 0,
      why: "Buyers outside your delivery area never see you. Buyers inside it see you sooner.",
      to: null,
      cta: "Soon",
    },
  ];

  const score = clamp(steps.reduce((sum, s) => sum + (s.done ? s.points : 0), 0));
  const tier: Strength["tier"] =
    score >= 90
      ? "Standout"
      : score >= 70
        ? "Buyer-ready"
        : score >= 40
          ? "Taking shape"
          : "Getting started";
  // Steps the supplier can act on today come before steps that need a page that is not built yet; within that, biggest gain first.
  const next = steps
    .filter((s) => !s.done)
    .sort((a, b) => Number(b.to !== null) - Number(a.to !== null) || b.points - a.points);
  return { score, tier, steps, next };
}

/** The four Trust Passport levels, in order, for the ladder on the dashboard. */
export const TRUST_LADDER: { level: TrustLevel; name: string; needs: string }[] = [
  { level: 0, name: "Not verified", needs: "Nothing checked yet" },
  { level: 1, name: "Registered", needs: "GST registration checked" },
  { level: 2, name: "Verified", needs: "Plus address and bank" },
  { level: 3, name: "Certified", needs: "Plus a quality certificate" },
];

/** A logo is a data URL the database already validated; the browser checks again before using it as an image source. */
export function safeLogo(v: string | null | undefined): string | null {
  return typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
    ? v
    : null;
}
