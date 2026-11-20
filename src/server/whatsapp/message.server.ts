/**
 * What a WhatsApp alert says. Pure functions only (no secrets, no network), so a test can prove every sentence.
 *
 * Rules that make these messages different from a generic "you have a notification":
 *  - decision first: a buyer's quote alert carries the verdict ("3 quotes in. Lowest ₹92,000, 8% below the average"),
 *    computed by the database from the buyer's own real quotes at SEND time, so a merged message is never stale;
 *  - a supplier is only ever told about its OWN request or order: no other supplier's price or name is ever in a message;
 *  - WhatsApp template rules are enforced here (no line breaks or runs of spaces inside a variable, never empty, length limits),
 *    because a template message with a bad variable is rejected by WhatsApp and the person hears nothing.
 */

export type WaKind = "verify" | "test" | "rfq" | "po";

export interface Digest {
  quotes: number;
  lowest: number;
  average: number;
}

/** One row handed out by the database function wa_claim_batch. */
export interface ClaimedRow {
  id: string;
  kind: WaKind;
  title: string;
  body: string;
  link_to: string | null;
  merged: number;
  attempts: number;
  /** E.164 with a leading + */
  phone: string;
  digest: Digest | null;
}

export interface WaEnv {
  appUrl: string;
  alertTemplate: string;
  verifyTemplate: string;
  language: string;
}

export interface TemplateMessage {
  /** Digits only, no +, as the Cloud API wants it. */
  to: string;
  template: string;
  language: string;
  components: unknown[];
}

export type Composed = { ok: true; message: TemplateMessage } | { ok: false; error: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** In-app page for a notification link. Only the four known shapes; anything else gives null (the app home is used instead). */
export function appLink(appUrl: string, linkTo: string | null): string | null {
  const base = appUrl.replace(/\/$/, "");
  if (!base || !linkTo) return null;
  const m = new RegExp(`^(rfqs|purchase-orders|quote-requests|orders)/(${UUID})$`).exec(linkTo);
  if (!m) return null;
  const prefix = {
    rfqs: "/buyer/dashboard/rfqs/",
    "purchase-orders": "/buyer/dashboard/purchase-orders/",
    "quote-requests": "/supplier/quote-requests/",
    orders: "/supplier/orders/",
  }[m[1] as "rfqs" | "purchase-orders" | "quote-requests" | "orders"];
  return `${base}${prefix}${m[2]}`;
}

/** A WhatsApp template variable: no line breaks, tabs or runs of spaces, never empty, bounded length. */
export function cleanParam(text: string, max = 200): string {
  const t = (text ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  const cut = t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  return cut || "Vendora";
}

export const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;

const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

/** "3 quotes in. Lowest ₹92,000, 8% below the average." Nothing is said that the numbers do not show. */
export function digestLine(d: Digest): string {
  if (d.quotes <= 1) return `First quote is in: ${inr(d.lowest)} all in (GST and freight included).`;
  const pct = d.average > 0 ? Math.round(((d.average - d.lowest) / d.average) * 100) : 0;
  const tail = "Totals include GST and freight.";
  if (pct < 1) return `${d.quotes} quotes in, all close to ${inr(d.average)}. ${tail}`;
  return `${d.quotes} quotes in. Lowest ${inr(d.lowest)}, ${pct}% below the average. ${tail}`;
}

/** The two lines of an alert. */
export function wording(row: ClaimedRow): { headline: string; detail: string } {
  const merged = Math.max(1, Math.floor(row.merged || 1));
  if (row.kind === "test") return { headline: row.title, detail: row.body };
  if (row.kind === "rfq" && row.link_to?.startsWith("rfqs/")) {
    // a buyer: quotes are coming in on their RFQ
    const headline = merged > 1 ? `${merged} updates on your RFQ: ${row.body}` : row.title;
    return { headline, detail: row.digest ? digestLine(row.digest) : sentence(row.body) };
  }
  if (row.kind === "rfq") {
    // a supplier: a buyer asked them for a quote
    return { headline: row.title, detail: `${sentence(row.body)} Open it to send your quote.` };
  }
  // an order, for either side
  return { headline: row.title, detail: merged > 1 ? `${merged} updates. Latest: ${sentence(row.body)}` : sentence(row.body) };
}

/** Everything WhatsApp needs for one claimed row, or why it cannot be sent. */
export function compose(row: ClaimedRow, env: WaEnv): Composed {
  const to = row.phone.replace(/^\+/, "");
  if (!/^[1-9][0-9]{7,14}$/.test(to)) return { ok: false, error: "bad_phone" };

  if (row.kind === "verify") {
    if (!/^[0-9]{6}$/.test(row.body)) return { ok: false, error: "bad_code" };
    return {
      ok: true,
      message: {
        to,
        template: env.verifyTemplate,
        language: env.language,
        // WhatsApp copy-code authentication templates need the code in the body AND in the button
        components: [
          { type: "body", parameters: [{ type: "text", text: row.body }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: row.body }] },
        ],
      },
    };
  }

  const base = env.appUrl.replace(/\/$/, "");
  if (!base) return { ok: false, error: "app_url_missing" };
  const { headline, detail } = wording(row);
  const link = appLink(base, row.link_to) ?? `${base}/`;
  return {
    ok: true,
    message: {
      to,
      template: env.alertTemplate,
      language: env.language,
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: cleanParam(headline, 120) },
            { type: "text", text: cleanParam(detail, 300) },
            { type: "text", text: cleanParam(link, 250) },
          ],
        },
      ],
    },
  };
}

/** A person replied to us. STOP in any of the common spellings pauses everything. */
export function isStopReply(text: string): boolean {
  return /^\s*(stop|stop all|unsubscribe|cancel|band|band karo|रोकें|बंद)\s*[.!]?\s*$/i.test(text ?? "");
}
