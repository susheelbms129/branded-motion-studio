import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Building2, LayoutDashboard, LogOut, Menu, Package, ShieldCheck, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ACCENT } from "@/lib/accents";
import { signOutUser } from "@/lib/auth";
import { initials } from "@/lib/format";
import { loadSupplierSummary, type SupplierSummary, type VerificationStatus } from "@/lib/onboarding-api";
import { getSupabase } from "@/lib/supabase";
import { SUPPLIER_NAV, type SupplierNavKey } from "@/lib/supplier-nav";
import { cn } from "@/lib/utils";
import type { Accent } from "@/types/domain";

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  not_submitted: "Not yet verified",
  submitted: "Verification submitted",
  in_review: "Verification in review",
  verified: "Verified",
  rejected: "Verification needs changes",
};

// ───────── what the pages inside the shell can read ─────────
// Everything here comes from the database for the signed-in supplier. Nothing is kept in the browser between visits,
// so one supplier's name or status can never show up for the next person who signs in.

interface SupplierContextValue {
  status: "loading" | "ready" | "error";
  summary: SupplierSummary | null;
  account: { name: string; email: string } | null;
  reload: () => void;
}

const SupplierContext = createContext<SupplierContextValue | null>(null);

export function useSupplier(): SupplierContextValue {
  const v = useContext(SupplierContext);
  if (!v) throw new Error("useSupplier must be used inside SupplierShell");
  return v;
}

const NAV_LOOK: Record<SupplierNavKey, { icon: LucideIcon; accent: Accent }> = {
  dashboard: { icon: LayoutDashboard, accent: "blue" },
  passport: { icon: ShieldCheck, accent: "emerald" },
  products: { icon: Package, accent: "pink" },
  profile: { icon: Building2, accent: "cyan" },
};

function NavList({ onNavigate, needsAction }: { onNavigate?: () => void; needsAction: boolean }) {
  const loc = useLocation();
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-5" aria-label="Supplier menu">
      <div className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-navy-muted/80">Your business</div>
      <ul className="space-y-0.5">
        {SUPPLIER_NAV.map((item) => {
          const look = NAV_LOOK[item.key];
          const active = item.to !== null && loc.pathname.startsWith(item.to);
          const inner = (
            <>
              {active ? <span className={cn("absolute left-0 h-7 w-1.5 rounded-r-full", ACCENT[look.accent].dot)} /> : null}
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl transition",
                  active ? ACCENT[look.accent].chip : "bg-navy-foreground/5",
                  active && "text-on-brand shadow-glow",
                )}
              >
                <look.icon className="size-[19px]" aria-hidden />
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.to === null ? (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-navy-muted">Soon</span>
              ) : item.key === "passport" && needsAction && !active ? (
                <span className="rounded-full bg-gradient-cta px-2 py-0.5 text-[11px] font-semibold text-on-brand shadow-glow">Do this</span>
              ) : null}
            </>
          );
          const base = "group relative flex items-center gap-3.5 rounded-lg px-3 py-2 text-sm font-medium transition";
          return (
            <li key={item.key}>
              {item.to === null ? (
                <span aria-disabled="true" className={cn(base, "cursor-default text-sidebar-foreground/60")}>
                  {inner}
                </span>
              ) : (
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    base,
                    "text-sidebar-foreground",
                    active
                      ? "bg-gradient-to-r from-primary/30 via-violet/15 to-transparent text-sidebar-accent-foreground ring-1 ring-white/15"
                      : "hover:bg-navy-foreground/5 hover:text-navy-foreground",
                  )}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The card at the bottom of the sidebar: where this supplier stands with buyers, and the one next step. */
function PassportCard({ status, onNavigate }: { status: VerificationStatus | null; onNavigate?: () => void }) {
  if (!status) return null;
  const copy: Record<VerificationStatus, { title: string; body: string; cta: string | null }> = {
    not_submitted: { title: "Get your Trust Passport", body: "Verified suppliers rank higher when buyers search. It takes a few minutes.", cta: "Start" },
    submitted: { title: "We're on it", body: "Your proofs are waiting for review. We'll update your passport as each one is checked.", cta: "View" },
    in_review: { title: "Review in progress", body: "A reviewer is checking your proofs right now.", cta: "View" },
    verified: { title: "Passport active", body: "Buyers see your verified badge and the date each proof was checked.", cta: "View" },
    rejected: { title: "A proof needs a fix", body: "One of your proofs couldn't be accepted. Fix it to appear as verified.", cta: "Fix now" },
  };
  const c = copy[status];
  return (
    <div className="shrink-0 border-t border-sidebar-border p-4">
      <div className="glass-dark rounded-xl p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <ShieldCheck className={cn("size-4", status === "verified" ? "text-emerald" : "text-magenta")} aria-hidden />
          {c.title}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-navy-muted">{c.body}</p>
        {c.cta ? (
          <Link
            to="/supplier/verification"
            onClick={onNavigate}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-white transition hover:gap-2.5"
          >
            {c.cta} <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function BrandLogo() {
  return <img src="/brand/vendora-logo.png" alt="Vendora — Smarter Buying. Greater Business." className="h-14 w-auto" />;
}

/**
 * The supplier workspace frame: its own menu, header and account menu. Buyer pages are not reachable from here, and the
 * route guards (requireSupplier) keep buyers out of every page that uses it.
 */
export function SupplierShell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const [mobile, setMobile] = useState(false);
  const [state, setState] = useState<Omit<SupplierContextValue, "reload">>({ status: "loading", summary: null, account: null });

  const load = useCallback(async () => {
    try {
      const [{ data }, summary] = await Promise.all([getSupabase().auth.getSession(), loadSupplierSummary()]);
      const u = data.session?.user;
      const meta = u?.user_metadata as { name?: string } | undefined;
      const email = u?.email ?? "";
      const account = u ? { name: meta?.name?.trim() || email.split("@")[0] || "You", email } : null;
      setState({ status: summary ? "ready" : "error", summary, account });
    } catch {
      setState((s) => ({ ...s, status: "error" }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The supplier pages are designed on a light page with a dark menu. A dark theme left over from a buyer
  // session in the same browser must not leak in here, so it is switched off while this frame is open.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (hadDark) root.classList.add("dark");
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const status = state.summary?.verification ?? null;
  const needsAction = status === "not_submitted" || status === "rejected";
  const name = state.account?.name ?? "";

  return (
    <SupplierContext.Provider value={{ ...state, reload: () => void load() }}>
      <div className="relative flex min-h-dvh bg-background text-foreground">
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
          <div className="glow-violet animate-orb absolute -left-40 top-0 size-[34rem] opacity-20" />
          <div className="glow-blue animate-orb-slow absolute -right-40 top-24 size-[32rem] opacity-20" />
        </div>

        <aside className="sticky top-0 z-20 hidden h-dvh w-72 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-gradient-sidebar lg:flex">
          <div className="flex h-20 shrink-0 items-center border-b border-sidebar-border px-5">
            <Link to="/supplier/dashboard" aria-label="Vendora supplier home">
              <BrandLogo />
            </Link>
          </div>
          <NavList needsAction={needsAction} />
          <PassportCard status={status} />
        </aside>

        <Sheet open={mobile} onOpenChange={setMobile}>
          <SheetContent side="left" className="flex w-80 flex-col border-0 bg-gradient-sidebar p-0 [&>button]:text-navy-foreground">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-20 items-center border-b border-sidebar-border px-5">
              <BrandLogo />
            </div>
            <NavList needsAction={needsAction} onNavigate={() => setMobile(false)} />
            <PassportCard status={status} onNavigate={() => setMobile(false)} />
          </SheetContent>
        </Sheet>

        <div className="relative z-10 flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-20 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-8">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu">
              <Menu />
            </Button>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight">{state.summary?.name || "Supplier workspace"}</div>
              <div className="text-[13px] text-muted-foreground">Supplier workspace</div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {status ? (
                <Link
                  to="/supplier/verification"
                  className={cn(
                    "hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition hover:opacity-80 sm:flex",
                    status === "verified" ? "tint-emerald" : "tint-amber",
                  )}
                >
                  <ShieldCheck className="size-4" aria-hidden /> {VERIFICATION_LABEL[status]}
                </Link>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Account"
                    className="grid size-11 place-items-center rounded-full bg-gradient-cta text-sm font-semibold text-on-brand ring-2 ring-primary/40 transition hover:ring-primary"
                  >
                    {name ? initials(name) : "·"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {state.account?.email ? <DropdownMenuLabel>{state.account.email}</DropdownMenuLabel> : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void signOutUser().then(() => nav({ to: "/supplier/signin" }))}>
                    <LogOut className="size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">{children}</main>
        </div>
      </div>
    </SupplierContext.Provider>
  );
}
