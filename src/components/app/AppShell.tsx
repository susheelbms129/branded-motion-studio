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
import { VendoraLogo } from "@/components/vendora/Logo";
import { ACCENT } from "@/lib/accents";
import { setActiveCurrency } from "@/lib/format";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { appPath, AppLink } from "@/lib/nav";
import { ROLES, ROLE_LABEL } from "@/lib/permissions";
import { useUi } from "@/lib/ui-store";
import { useActor, useWs } from "@/lib/ws-store";
import { cn } from "@/lib/utils";

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
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {GROUPS.map((g) => (
        <div key={g.label}>
          {!collapsed ? (
            <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-navy-muted/70">
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
                      "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground transition",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
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
                        "grid size-7 shrink-0 place-items-center rounded-lg",
                        active ? ACCENT[m.accent].chip : "bg-navy-foreground/5",
                        active && "text-on-brand",
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
    signOut,
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
  useEffect(() => {
    if (org) setActiveCurrency(org.currency);
  }, [org]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col bg-gradient-sidebar transition-[width] duration-300 lg:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-sidebar-border px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <AppLink to="" aria-label="Vendora home">
            <VendoraLogo variant={collapsed ? "mark" : "full"} height={30} />
          </AppLink>
        </div>
        <NavList collapsed={collapsed} />
        <div className="border-t border-sidebar-border p-3">
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
          className="w-72 border-0 bg-gradient-sidebar p-0 [&>button]:text-navy-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-16 items-center border-b border-sidebar-border px-4">
            <VendoraLogo height={30} />
          </div>
          <NavList collapsed={false} onNavigate={() => setMobile(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-lg sm:px-6">
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
            <label className="hidden items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs sm:flex">
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
                    signOut();
                    void nav({ to: "/login" });
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
