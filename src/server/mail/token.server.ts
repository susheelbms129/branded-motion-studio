/**
 * Stateless, tamper-proof invitation tokens (HMAC-SHA256). Server-only.
 * There is no database in this project, so instead of storing a token hash we sign the invitation
 * details. Changing the email, role, organization or expiry invalidates the signature, which is what
 * stops an invited employee from editing their assigned role.
 */

export interface InvitePayload {
  /** unique invitation id (used for idempotency / single-use tracking) */
  jti: string;
  e: string; // invited email
  r: string; // assigned role
  o: string; // organization name
  n: string; // inviter name
  ie?: string | undefined; // inviter email, for the "accepted" confirmation
  exp: number; // unix ms
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function secret(): string {
  const s = process.env.INVITE_SIGNING_SECRET ?? "";
  if (s.length < 24) throw new Error("INVITE_SIGNING_SECRET is missing or too short (min 24 chars)");
  return s;
}

export async function signInvite(p: InvitePayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  return `${body}.${b64url(await hmac(secret(), body))}`;
}

export type VerifyResult =
  | { ok: true; payload: InvitePayload }
  | { ok: false; reason: "invalid" | "expired" };

export async function verifyInvite(token: string): Promise<VerifyResult> {
  const [body, sig] = token.split(".");
  if (!body || !sig || token.length > 2000) return { ok: false, reason: "invalid" };
  try {
    const expected = await hmac(secret(), body);
    const given = fromB64url(sig);
    // constant-time comparison
    let diff = expected.length ^ given.length;
    for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ (given[i] ?? 0);
    if (diff !== 0) return { ok: false, reason: "invalid" };
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as InvitePayload;
    if (typeof payload.exp !== "number" || !payload.e || !payload.r || !payload.o) return { ok: false, reason: "invalid" };
    if (Date.now() > payload.exp) return { ok: false, reason: "expired" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export const randomId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
