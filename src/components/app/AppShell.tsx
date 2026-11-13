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
    <img src="/brand/vendora-mark.png" alt="Vendora" className="h-7 w-auto" />
  ) : (
    <img
      src="/brand/vendora-logo.png"
      alt="Vendora — Smarter Buying. Greater Business."
      className="h-12 w-auto"
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
      className="flex min-h-0 flex-1 flex-col justify-evenly overflow-hidden px-3 py-[1.2vh]"
      aria-label="Main"
    >
      {GROUPS.map((g) => (
        <div key={g.label}>
          {!collapsed ? (
            <div className="mb-[0.5vh] px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-navy-muted/70 [@media(max-height:690px)]:hidden">
              {g.label}
            </div>
          ) : null}
          <ul className="space-y-px">
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
                      "group relative flex items-center gap-3 rounded-xl px-2.5 py-[clamp(0.25rem,0.8vh,0.5rem)] text-sm text-sidebar-foreground transition",
                      active
                        ? "bg-gradient-to-r from-primary/25 via-violet/10 to-transparent text-sidebar-accent-foreground ring-1 ring-white/10"
                        : "hover:bg-navy-foreground/5 hover:text-navy-foreground",
                      collapsed && "justify-center",
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="nav-active"
                        className={cn(
                          "absolute left-0 h-5 w-1 rounded-r-full",
                          ACCENT[m.accent].dot,
                        )}
                      />
                    ) : null}
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-lg transition",
                        active ? ACCENT[m.accent].chip : "bg-navy-foreground/5",
                        active && "text-on-brand shadow-glow",
                      )}
                    >
                      <m.icon className="size-4" />
                    </span>
                    {!collapsed ? <span className="flex-1 truncate">{m.label}</span> : null}
                    {!collapsed && n > 0 ? (
                      <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular text-primary-foreground">
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
  // Same compact scale as the landing page, applied only while the app is open.
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.fontSize;
    el.style.fontSize = "14px";
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
        <div className="glow-violet animate-orb absolute -left-40 top-0 size-[38rem] opacity-30 dark:opacity-60" />
        <div className="glow-blue animate-orb-slow absolute -right-40 top-24 size-[36rem] opacity-25 dark:opacity-55" />
        <div className="glow-magenta animate-orb absolute bottom-[-12rem] left-1/3 size-[30rem] opacity-10 dark:opacity-35" />
      </div>
      <aside
        className={cn(
          "sticky top-0 z-20 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-gradient-sidebar transition-[width] duration-300 lg:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-[4.5rem] shrink-0 items-center border-b border-sidebar-border px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <AppLink to="" aria-label="Vendora home">
            <BrandLogo collapsed={collapsed} />
          </AppLink>
        </div>
        <NavList collapsed={collapsed} />
        <div className="shrink-0 border-t border-sidebar-border p-2.5">
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
          className="flex w-72 flex-col border-0 bg-gradient-sidebar p-0 [&>button]:text-navy-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-[4.5rem] items-center border-b border-sidebar-border px-4">
            <BrandLogo collapsed={false} />
          </div>
          <NavList collapsed={false} onNavigate={() => setMobile(false)} />
        </SheetContent>
      </Sheet>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[4.5rem] items-center gap-3 border-b border-white/10 bg-background/70 px-4 backdrop-blur-xl sm:px-6">
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
            <div className="truncate text-sm font-semibold">{org?.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {org?.plan} plan · {demo ? "Demo workspace" : "Your workspace"}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs backdrop-blur sm:flex">
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
                <Button variant="outline" size="sm" className="hidden sm:inline-flex">
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
            <Button asChild size="sm" className="hidden sm:inline-flex">
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
                  <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-coral" />
                ) : null}
              </AppLink>
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Account">
                  <Person name={user?.name ?? actor?.name ?? "You"} accent="violet" size={34} />
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
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
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
