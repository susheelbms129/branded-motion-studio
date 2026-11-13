import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Bell, ChevronsLeft, LogOut, Menu, Moon, Plus, Sun } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { Person } from "@/components/vendora/kit";
import { ACCENT } from "@/lib/accents";
import { setActiveCurrency } from "@/lib/format";
import { startMailEvents } from "@/lib/mail-events";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { appPath, AppLink } from "@/lib/nav";
import { ROLES, ROLE_LABEL } from "@/lib/permissions";
import { signOutUser } from "@/lib/auth";
import { useUi } from "@/lib/ui-store";
import { useActor, useWs } from "@/lib/ws-store";
import { cn } from "@/lib/utils";

/** Exact landing-page lockup in the sidebar; just the V mark when the sidebar is collapsed. */
function BrandLogo({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <img src="/brand/vendora-mark.png" alt="Vendora" className="h-9 w-auto" />
  ) : (
    <img
      src="/brand/vendora-logo.png"
      alt="Vendora — Smarter Buying. Greater Business."
      className="h-14 w-auto"
    />
  );
}

const GROUPS: { label: string; keys: ModuleKey[] }[] = [
  { label: "Workspace", keys: ["dashboard", "requests", "rfqs", "purchaseOrders"] },
  { label: "Sourcing", keys: ["suppliers", "materials"] },
  { label: "Intelligence", keys: ["analytics", "insights"] },
  { label: "Admin", keys: ["notifications", "team", "settings"] },
];

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const loc = useLocation();
  const notifications = useWs((s) => s.notifications);
  const pending = useWs((s) => s.requests.filter((r) => r.status === "pending_approval").length);
  const insights = useWs((s) => s.insights)().filter((i) => i.status === "open").length;
  const unread = notifications.filter((n) => !n.read).length;
  const badge: Partial<Record<ModuleKey, number>> = {
    requests: pending,
    insights,
    notifications: unread,
  };
  return (
    <nav
      className="flex min-h-0 flex-1 flex-col justify-evenly gap-1 overflow-y-auto px-4 py-[1.2vh] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Main"
    >
      {GROUPS.map((g) => (
        <div key={g.label}>
          {!collapsed ? (
            <div className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-navy-muted/80 [@media(max-height:640px)]:hidden">
              {g.label}
            </div>
          ) : null}
          <ul className="space-y-0.5">
            {g.keys.map((k) => {
              const m = MODULES[k];
              const to = appPath(m.path);
              const active =
                m.path === ""
                  ? loc.pathname === "/app" || loc.pathname === "/app/"
                  : loc.pathname.startsWith(to);
              const n = badge[k] ?? 0;
              return (
                <li key={k}>
                  <Link
                    to={to as never}
                    onClick={onNavigate}
                    title={collapsed ? m.label : undefined}
                    className={cn(
                      "group relative flex items-center gap-3.5 rounded-lg px-3 py-[clamp(0.3rem,0.9vh,0.55rem)] text-sm font-medium text-sidebar-foreground transition",
                      active
                        ? "bg-gradient-to-r from-primary/30 via-violet/15 to-transparent text-sidebar-accent-foreground ring-1 ring-white/15"
                        : "hover:bg-navy-foreground/5 hover:text-navy-foreground",
                      collapsed && "justify-center",
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="nav-active"
                        className={cn(
                          "absolute left-0 h-7 w-1.5 rounded-r-full",
                          ACCENT[m.accent].dot,
                        )}
                      />
                    ) : null}
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-xl transition",
                        active ? ACCENT[m.accent].chip : "bg-navy-foreground/5",
                        active && "text-on-brand shadow-glow",
                      )}
                    >
                      <m.icon className="size-[19px]" />
                    </span>
                    {!collapsed ? <span className="flex-1 truncate">{m.label}</span> : null}
                    {!collapsed && n > 0 ? (
                      <span className="rounded-full bg-gradient-cta px-2 py-0.5 text-xs font-semibold tabular text-on-brand shadow-glow">
                        {n}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell() {
  const {
    sidebarCollapsed: collapsed,
    toggleSidebar,
    theme,
    toggleTheme,
    demo,
    setDemo,
    role,
    setRole,
    user,
  } = useUi();
  const org = useWs((s) => s.organizations[0]);
  const reset = useWs((s) => s.reset);
  const members = useWs((s) => s.members);
  const unread = useWs((s) => s.notifications.filter((n) => !n.read).length);
  const actorId = useActor();
  const actor = members.find((m) => m.id === actorId);
  const nav = useNavigate();
  const loc = useLocation();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  // Comfortable, premium type scale (slightly under the landing page's 16px base), applied only while the app is open.
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.fontSize;
    el.style.fontSize = "14.5px";
    return () => {
      el.style.fontSize = prev;
    };
  }, []);
  useEffect(() => {
    if (org) setActiveCurrency(org.currency);
  }, [org]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  // Email notifications for workspace events (invites, approvals, POs, ...). Never blocks the UI.
  useEffect(() => startMailEvents(), []);

  return (
    <div className="relative flex min-h-screen bg-background text-foreground">
      {/* Brand backdrop: grid + glowing orbs, like the landing hero */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="bg-grid-dark mask-radial absolute inset-0 opacity-0 dark:opacity-60" />
        <div className="glow-violet animate-orb absolute -left-40 top-0 size-[38rem] opacity-40 dark:opacity-60" />
        <div className="glow-blue animate-orb-slow absolute -right-40 top-24 size-[36rem] opacity-35 dark:opacity-55" />
        <div className="glow-magenta animate-orb absolute bottom-[-12rem] left-1/3 size-[30rem] opacity-10 dark:opacity-35" />
      </div>
      <aside
        className={cn(
          "sticky top-0 z-20 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-gradient-sidebar transition-[width] duration-300 lg:flex",
          collapsed ? "w-[88px]" : "w-72",
        )}
      >
        <div
          className={cn(
            "flex h-20 shrink-0 items-center border-b border-sidebar-border px-5",
            collapsed && "justify-center px-0",
          )}
        >
          <AppLink to="" aria-label="Vendora home">
            <BrandLogo collapsed={collapsed} />
          </AppLink>
        </div>
        <NavList collapsed={collapsed} />
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <Button
            variant="ghost-dark"
            size="sm"
            className="w-full justify-center"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
          >
            <ChevronsLeft className={cn("transition", collapsed && "rotate-180")} />
            {collapsed ? null : "Collapse"}
          </Button>
        </div>
      </aside>

      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent
          side="left"
          className="flex w-80 flex-col border-0 bg-gradient-sidebar p-0 [&>button]:text-navy-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-20 items-center border-b border-sidebar-border px-5">
            <BrandLogo collapsed={false} />
          </div>
          <NavList collapsed={false} onNavigate={() => setMobile(false)} />
        </SheetContent>
      </Sheet>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-20 items-center gap-3 border-b border-white/10 bg-background/70 px-4 shadow-[0_1px_0_0_oklch(0.563_0.24_263.8/12%)] backdrop-blur-xl sm:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobile(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold tracking-tight">{org?.name}</div>
            <div className="text-[13px] capitalize text-muted-foreground">
              {org?.plan} plan · {demo ? "Demo workspace" : "Your workspace"}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <label className="hidden items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm backdrop-blur light:border-border light:bg-card/70 sm:flex">
              <span className="text-muted-foreground">Demo data</span>
              <Switch
                checked={demo}
                onCheckedChange={(v) => {
                  setDemo(v);
                  reset(v);
                  toast_reset();
                }}
                aria-label="Toggle demo data"
              />
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="hidden sm:inline-flex">
                  {ROLE_LABEL[role]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>View as role</DropdownMenuLabel>
                {ROLES.map((r) => (
                  <DropdownMenuItem
                    key={r}
                    onSelect={() => setRole(r)}
                    className={cn(r === role && "font-semibold")}
                  >
                    {ROLE_LABEL[r]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild className="hidden sm:inline-flex">
              <AppLink to="requests/new">
                <Plus />
                New request
              </AppLink>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              asChild
              aria-label="Notifications"
              className="relative"
            >
              <AppLink to="notifications">
                <Bell />
                {unread ? (
                  <span className="absolute right-2 top-2 size-2.5 rounded-full bg-coral ring-2 ring-background" />
                ) : null}
              </AppLink>
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Account" className="rounded-full ring-2 ring-primary/40 transition hover:ring-primary">
                  <Person name={user?.name ?? actor?.name ?? "You"} accent="violet" size={44} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user?.email ?? actor?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void nav({ to: "/app/settings" as never })}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void signOutUser().then(() => nav({ to: "/signin" }));
                  }}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 py-6 sm:px-4 lg:px-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={loc.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}

import { toast } from "sonner";
function toast_reset() {
  toast.success("Workspace reloaded");
}
