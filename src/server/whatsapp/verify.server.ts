/**
 * Checks for the two doors into the WhatsApp routes. Server-only, no imports, so a test can run it as is.
 *  - Meta signs every webhook call with the app secret (X-Hub-Signature-256: sha256=<hex of HMAC-SHA256 of the raw body>).
 *  - The sender job (cron) proves itself with a shared secret in the Authorization header.
 * Both comparisons take the same time whether or not the first characters match.
 */

const enc = new TextEncoder();

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** True only for a header of the form `sha256=<hex>` that matches the body. A missing secret or header is always false. */
export async function verifyMetaSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const given = header.slice("sha256=".length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  return safeEqual(given, await hmacHex(secret, body));
}

/** True only for `Bearer <secret>` with a long enough secret. */
export function verifyBearer(secret: string, header: string | null): boolean {
  if (!secret || secret.length < 24 || !header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  return !!m && safeEqual(m[1]!, secret);
}
