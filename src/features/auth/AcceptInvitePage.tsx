import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Loader2, MailCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VendoraLogo } from "@/components/vendora/Logo";
import {
  clearAuthCache,
  setActiveOrg,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
} from "@/lib/auth";
import {
  acceptInvite,
  forgetInvite,
  isInviteToken,
  peekInvite,
  previewInvite,
  rememberInvite,
  type DeadState,
  type PreviewResult,
} from "@/lib/invites";
import { ROLE_LABEL } from "@/lib/permissions";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";

type View =
  | { s: "loading" }
  | { s: "dead"; reason: DeadState }
  | { s: "auth"; masked: string }
  | { s: "check"; email: string }
  | {
      s: "review";
      p: Extract<PreviewResult, { state: "ok" | "wrong_email" | "unverified" }>;
      userEmail: string;
    };

const DEAD_COPY: Record<DeadState, [string, string]> = {
  expired: [
    "This invitation has expired",
    "Ask your administrator to send you a fresh invitation.",
  ],
  used: [
    "This invitation was already used",
    "Each invitation link works once. Sign in instead, or ask your administrator for a new one.",
  ],
  revoked: [
    "This invitation was cancelled",
    "Ask your administrator to send you a new invitation.",
  ],
  invalid: [
    "This invitation link isn't valid",
    "It may have been copied incorrectly. Ask your administrator for a new one.",
  ],
};

export function AcceptInvitePage() {
  const nav = useNavigate();
  const [view, setView] = useState<View>({ s: "loading" });
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(t: string) {
    setView({ s: "loading" });
    try {
      // Anyone with the link may learn only whether it is usable (plus a masked email).
      const peek = await peekInvite(t);
      if (peek.state !== "valid") {
        forgetInvite();
        return setView({ s: "dead", reason: peek.state });
      }
      rememberInvite(t);
      const { data } = await getSupabase().auth.getSession();
      const user = data.session?.user;
      if (!user) return setView({ s: "auth", masked: peek.maskedEmail });
      // Signed in: the DATABASE compares the verified email on the account with the invitation.
      const p = await previewInvite(t);
      if (
        p.state === "expired" ||
        p.state === "used" ||
        p.state === "revoked" ||
        p.state === "invalid"
      ) {
        forgetInvite();
        return setView({ s: "dead", reason: p.state });
      }
      setView({
        s: "review",
        p: p as Extract<PreviewResult, { state: "ok" | "wrong_email" | "unverified" }>,
        userEmail: user.email ?? "",
      });
    } catch {
      setView({ s: "dead", reason: "invalid" });
    }
  }

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(t);
    if (!isSupabaseConfigured || !isInviteToken(t))
      return setView({ s: "dead", reason: "invalid" });
    void load(t);
  }, []);

  async function auth(e: FormEvent) {
    e.preventDefault();
    if (mode === "signup" && name.trim().length < 2) return setErr("Enter your full name");
    if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      return setErr("Enter the email address this invitation was sent to");
    if (pw.length < 8) return setErr("Password must be at least 8 characters");
    setErr("");
    setBusy(true);
    const em = email.trim().toLowerCase();
    const r =
      mode === "signup"
        ? await signUpWithEmail(
            { name: name.trim(), email: em, password: pw },
            { redirectPath: `/accept-invite?token=${token}` },
          )
        : await signInWithEmail(em, pw);
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setPw("");
    if (r.needsConfirm) return setView({ s: "check", email: em });
    void load(token);
  }

  async function accept() {
    setBusy(true);
    setErr("");
    try {
      const r = await acceptInvite(token);
      if (r.state === "ok" || r.state === "already_member") {
        const { data } = await getSupabase().auth.getSession();
        if (data.session) setActiveOrg(data.session.user.id, r.orgId);
        forgetInvite();
        clearAuthCache();
        const ui = useUi.getState();
        ui.finishOnboarding(true);
        useWs.getState().reset(true);
        useWs.getState().updateOrg({ name: r.orgName });
        return void nav({ to: "/buyer/dashboard" });
      }
      setBusy(false);
      if (r.state === "wrong_email" || r.state === "unverified") return void load(token);
      forgetInvite();
      setView({ s: "dead", reason: r.state });
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  async function switchAccount() {
    await signOutUser();
    void load(token);
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

        {view.s === "dead" ? (
          <div className="py-4 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold">{DEAD_COPY[view.reason][0]}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{DEAD_COPY[view.reason][1]}</p>
            <Button asChild className="mt-6" variant="outline">
              <Link to="/buyer/signin">Go to sign in</Link>
            </Button>
          </div>
        ) : null}

        {view.s === "check" ? (
          <div className="py-4 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <MailCheck className="size-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold">Confirm your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a confirmation link to {view.email}. Open it, then come back to this
              invitation to finish joining.
            </p>
          </div>
        ) : null}

        {view.s === "auth" ? (
          <form onSubmit={auth} noValidate>
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <MailCheck className="size-6" />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              You've been invited to join a team
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signup" ? "Create your account" : "Sign in"} with the email this invitation
              was sent to ({view.masked}).
            </p>
            <div className="mt-6 space-y-4">
              {mode === "signup" ? (
                <div>
                  <Label htmlFor="in">Full name</Label>
                  <Input
                    id="in"
                    className="mt-1.5"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              ) : null}
              <div>
                <Label htmlFor="ie">Email</Label>
                <Input
                  id="ie"
                  type="email"
                  className="mt-1.5"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div>
                <Label htmlFor="ip">{mode === "signup" ? "Create a password" : "Password"}</Label>
                <Input
                  id="ip"
                  type="password"
                  className="mt-1.5"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
              </div>
              {err ? (
                <p role="alert" className="text-sm text-destructive">
                  {err}
                </p>
              ) : null}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {mode === "signup" ? "Create account" : "Sign in"}
                {busy ? null : <ArrowRight />}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setErr("");
                  setMode(mode === "signup" ? "signin" : "signup");
                }}
              >
                {mode === "signup"
                  ? "Already have an account? Sign in"
                  : "New to Vendora? Create an account"}
              </button>
            </div>
          </form>
        ) : null}

        {view.s === "review" && view.p.state === "ok" ? (
          <div>
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <MailCheck className="size-6" />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Join {view.p.orgName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {view.p.inviterName} invited you as{" "}
              <b className="text-foreground">{ROLE_LABEL[view.p.role]}</b>.
            </p>
            <p className="mt-4 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              Signed in as {view.userEmail}
            </p>
            {err ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {err}
              </p>
            ) : null}
            <Button size="lg" className="mt-5 w-full" disabled={busy} onClick={() => void accept()}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Accept
              {busy ? null : <ArrowRight />}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Your role is set by the invitation and can't be changed here.
            </p>
          </div>
        ) : null}

        {view.s === "review" && view.p.state === "wrong_email" ? (
          <div className="py-2 text-center">
            <h1 className="text-xl font-semibold">This invitation is for a different email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It was sent to {view.p.maskedEmail}, but you're signed in as {view.userEmail}. Sign in
              with the invited email to continue.
            </p>
            <Button className="mt-6" variant="outline" onClick={() => void switchAccount()}>
              Use a different account
            </Button>
          </div>
        ) : null}

        {view.s === "review" && view.p.state === "unverified" ? (
          <div className="py-2 text-center">
            <h1 className="text-xl font-semibold">Confirm your email first</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We can only match this invitation to an email address you have confirmed. Open the
              confirmation email we sent {view.userEmail}, then reload this page.
            </p>
            <Button className="mt-6" variant="outline" onClick={() => void switchAccount()}>
              Use a different account
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
