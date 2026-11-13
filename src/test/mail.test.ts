import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimit, sendEmail, suppress } from "../server/mail/resend.server";
import { announcementEmail, esc, inviteEmail, notifyEmail } from "../server/mail/templates.server";
import { signInvite, verifyInvite } from "../server/mail/token.server";

const payload = () => ({ jti: "inv1", e: "new@acme.in", r: "employee", o: "Acme", n: "Asha", exp: Date.now() + 60_000 });

beforeEach(() => {
  process.env.INVITE_SIGNING_SECRET = "test-secret-test-secret-test-secret";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => vi.restoreAllMocks());

describe("invitation tokens", () => {
  it("accepts a valid token", async () => {
    const v = await verifyInvite(await signInvite(payload()));
    expect(v.ok).toBe(true);
  });
  it("rejects a token whose role was edited (employee cannot promote themselves)", async () => {
    const t = await signInvite(payload());
    const [body, sig] = t.split(".");
    const forged = JSON.parse(atob(body!.replace(/-/g, "+").replace(/_/g, "/")));
    forged.r = "owner";
    const b = btoa(JSON.stringify(forged)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect((await verifyInvite(`${b}.${sig}`)).ok).toBe(false);
  });
  it("rejects expired and garbage tokens", async () => {
    const expired = await signInvite({ ...payload(), exp: Date.now() - 1 });
    expect(await verifyInvite(expired)).toEqual({ ok: false, reason: "expired" });
    expect((await verifyInvite("nope")).ok).toBe(false);
    expect((await verifyInvite("a.b")).ok).toBe(false);
  });
  it("rejects a token signed with another secret", async () => {
    const t = await signInvite(payload());
    process.env.INVITE_SIGNING_SECRET = "a-different-secret-a-different-secret";
    expect((await verifyInvite(t)).ok).toBe(false);
  });
});

describe("templates", () => {
  it("escapes user-controlled text", () => {
    expect(esc('<script>alert("x")</script>')).not.toContain("<script>");
    const m = announcementEmail({ orgName: "Acme", senderName: "<b>Evil</b>", subject: "<i>hi</i>", message: "<img src=x onerror=1>", support: "s@v.in" });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).not.toContain("<b>Evil</b>");
  });
  it("invitation email has everything the spec requires", () => {
    const m = inviteEmail({ orgName: "Acme", inviterName: "Asha", roleLabel: "Approver", url: "https://app.test/accept-invite?token=abc", expiresAt: Date.now() + 86_400_000, support: "help@v.in" });
    for (const s of ["Acme", "Asha", "Approver", "Accept invitation", "https://app.test/accept-invite?token=abc", "ignore this email"]) expect(m.html).toContain(s);
    expect(m.text).toContain("https://app.test/accept-invite?token=abc");
    expect(m.subject).toContain("Acme");
  });
  it("notification email marks demo deliveries", () => {
    const m = notifyEmail({ kind: "request_decided", orgName: "Acme", title: "PR-1 · Steel", status: "approved", support: "s@v.in", demo: true });
    expect(m.subject).toMatch(/^\[Demo\] /);
    expect(m.subject).toContain("approved");
  });
});

describe("Resend transport", () => {
  const args = { to: "a@b.com", subject: "s", html: "<p>x</p>", text: "x", idempotencyKey: "key-1", fromName: "Asha" };
  const res = (status: number, json: object) => new Response(JSON.stringify(json), { status });

  it("retries temporary failures with the SAME idempotency key (no duplicates)", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503, { message: "down" })).mockResolvedValueOnce(res(200, { id: "msg_1" }));
    vi.stubGlobal("fetch", f);
    const r = await sendEmail(args);
    expect(r).toEqual({ ok: true, id: "msg_1" });
    expect(f).toHaveBeenCalledTimes(2);
    const keys = f.mock.calls.map((c) => (c[1] as RequestInit & { headers: Record<string, string> }).headers["Idempotency-Key"]);
    expect(keys).toEqual(["key-1", "key-1"]);
  });
  it("does not retry permanent errors", async () => {
    const f = vi.fn().mockResolvedValue(res(422, { message: "bad address" }));
    vi.stubGlobal("fetch", f);
    const r = await sendEmail(args);
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("never throws when the provider is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const r = await sendEmail({ ...args, idempotencyKey: "key-net" });
    expect(r.ok).toBe(false);
  }, 15_000);
  it("keeps the real sending address and only changes the display name", async () => {
    process.env.MAIL_FROM = "Vendora <notifications@vendora.in>";
    const f = vi.fn().mockResolvedValue(res(200, { id: "m" }));
    vi.stubGlobal("fetch", f);
    await sendEmail({ ...args, fromName: 'Asha <evil@x.com>"' });
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.from).toMatch(/<notifications@vendora\.in>$/);
    expect(body.from).not.toContain("evil@x.com");
    expect(body.from).not.toContain("@x.com");
    delete process.env.MAIL_FROM;
  });
  it("skips suppressed (bounced) recipients and missing config", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    suppress("Bounced@Acme.in");
    expect((await sendEmail({ ...args, to: "bounced@acme.in" })).ok).toBe(false);
    process.env.RESEND_API_KEY = "";
    expect((await sendEmail(args)).ok).toBe(false);
    expect(f.mock.calls.length).toBe(0);
  });
});

describe("abuse protection", () => {
  it("rate limits after the allowed number of calls", () => {
    const k = `t-${Math.random()}`;
    expect([1, 2, 3].map(() => rateLimit(k, 3, 60_000))).toEqual([true, true, true]);
    expect(rateLimit(k, 3, 60_000)).toBe(false);
  });
});
