import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Loader2, MailCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VendoraLogo } from "@/components/vendora/Logo";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";
import { acceptInvite, checkInvite } from "@/server/mail.functions";

type Info = Extract<Awaited<ReturnType<typeof checkInvite>>, { valid: true }>;
type View =
  | { s: "loading" }
  | { s: "ok"; info: Info }
  | { s: "bad"; reason: "expired" | "invalid" | "used" | "rate_limited" };

const USED_KEY = "vendora-used-invites";
const readUsed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(USED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

const BAD_COPY: Record<string, [string, string]> = {
  expired: ["This invitation has expired", "Ask your administrator to send you a fresh invitation."],
  used: ["This invitation was already used", "Each invitation link works once. Sign in instead, or ask for a new one."],
  rate_limited: ["Too many attempts", "Please wait a minute and reload this page."],
  invalid: ["This invitation link isn't valid", "It may have been copied incorrectly or revoked. Ask your administrator for a new one."],
};

export function AcceptInvitePage() {
  const nav = useNavigate();
  const [view, setView] = useState<View>({ s: "loading" });
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(t);
    if (!t) return setView({ s: "bad", reason: "invalid" });
    void checkInvite({ data: { token: t } })
      .then((r) => {
        if (!r.valid) return setView({ s: "bad", reason: r.reason });
        if (readUsed().includes(r.invitationId)) return setView({ s: "bad", reason: "used" });
        setView({ s: "ok", info: r });
      })
      .catch(() => setView({ s: "bad", reason: "invalid" }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (view.s !== "ok") return;
    if (name.trim().length < 2) return setErr("Enter your full name");
    if (pw.length < 8) return setErr("Password must be at least 8 characters");
    setErr("");
    setBusy(true);
    try {
      // The server re-verifies the signed token; role, email and organization come only from it.
      const r = await acceptInvite({ data: { token, name: name.trim() } });
      if (!r.ok || !r.role || !r.email || !r.orgName) {
        setErr(r.ok ? "This invitation is not valid." : r.error);
        return setBusy(false);
      }
      localStorage.setItem(USED_KEY, JSON.stringify([...readUsed(), view.info.invitationId]));
      const ui = useUi.getState();
      ui.signIn({ name: name.trim(), email: r.email, company: r.orgName });
      ui.setRole(r.role);
      ui.finishOnboarding(true);
      useWs.getState().reset(true);
      useWs.getState().updateOrg({ name: r.orgName });
      void nav({ to: "/app" });
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-lavender px-4 py-10">
      <Link to="/" className="mb-8 rounded-xl bg-navy px-4 py-2">
        <VendoraLogo height={28} />
      </Link>
      <div className="w-full max-w-md rounded-3xl border bg-card p-6 shadow-lift sm:p-8">
        {view.s === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking your invitation…
          </div>
        ) : null}

        {view.s === "bad" ? (
          <div className="py-4 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold">{BAD_COPY[view.reason]![0]}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{BAD_COPY[view.reason]![1]}</p>
            <Button asChild className="mt-6" variant="outline">
              <Link to="/login">Go to sign in</Link>
            </Button>
          </div>
        ) : null}

        {view.s === "ok" ? (
          <form onSubmit={submit} noValidate>
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <MailCheck className="size-6" />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Join {view.info.orgName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {view.info.inviterName} invited you to Vendora as <b className="text-foreground">{view.info.roleLabel}</b>.
            </p>
            <div className="mt-6 space-y-4">
              <div>
                <Label htmlFor="ie">Email</Label>
                <Input id="ie" className="mt-1.5" value={view.info.email} readOnly disabled />
              </div>
              <div>
                <Label htmlFor="in">Full name</Label>
                <Input id="in" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
              <div>
                <Label htmlFor="ip">Create a password</Label>
                <Input id="ip" type="password" className="mt-1.5" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              </div>
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                Accept invitation
                {busy ? null : <ArrowRight />}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Your email and role are set by the invitation and can't be changed here.
              </p>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
