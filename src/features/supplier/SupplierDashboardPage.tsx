import { Link, useNavigate } from "@tanstack/react-router";
import { Boxes, Check, FileText, LayoutDashboard, LogOut, Package, Receipt, ShieldCheck, Users } from "lucide-react";

import { signOutUser } from "@/lib/auth";

import { loadDraft } from "./draft";

const NAV = [
  { label: "Dashboard", icon: LayoutDashboard, on: true },
  { label: "Product catalogue", icon: Boxes, on: false },
  { label: "Quote requests", icon: FileText, on: false },
  { label: "Quotations", icon: Receipt, on: false },
  { label: "Purchase orders", icon: Package, on: false },
  { label: "Buyers", icon: Users, on: false },
] as const;

export function SupplierDashboardPage() {
  const nav = useNavigate();
  const draft = loadDraft();
  const name = draft?.name || "Your business";
  const steps = [
    { t: "Business profile", d: "Name, address and contact details", done: !!draft },
    { t: "Add your products", d: "List what you sell, with price and availability", done: false },
    { t: "Verify your business", d: "Submit your registration so buyers can trust you", done: !!draft?.registrationNo },
    { t: "Invite your team", d: "Add colleagues to this supplier workspace", done: false },
  ];
  const stats = [
    ["Open quote requests", "0"],
    ["Quotations sent", "0"],
    ["Active orders", "0"],
    ["Connected buyers", "0"],
  ];

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col bg-navy p-4 text-navy-foreground md:flex">
        <img src="/brand/vendora-logo.png" alt="Vendora" className="mb-6 h-16 w-auto self-start" />
        <p className="mb-2 px-3 text-xs font-semibold text-navy-muted">Supplier workspace</p>
        <nav className="flex-1 space-y-1" aria-label="Supplier">
          {NAV.map(({ label, icon: Icon, on }) => (
            <span key={label} aria-current={on ? "page" : undefined} className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium ${on ? "bg-white/10 text-white" : "text-navy-muted"}`}>
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {label}
              </span>
              {on ? null : <span className="text-[11px]">Soon</span>}
            </span>
          ))}
        </nav>
        <button type="button" onClick={() => void signOutUser().then(() => nav({ to: "/signin" }))} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-navy-muted transition hover:bg-white/10 hover:text-white">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>

      <main className="flex-1 p-6 sm:p-10">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold">Welcome, {name}</h1>
              <p className="mt-1 text-muted-foreground">Here is what to do to start receiving orders.</p>
            </div>
            <span className="tint-amber flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" /> Not yet verified
            </span>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <p className="text-sm text-muted-foreground">{k}</p>
                <p className="mt-1 text-3xl font-semibold tabular">{v}</p>
              </div>
            ))}
          </div>

          <section className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-card">
            <h2 className="text-xl font-semibold">Set up your supplier workspace</h2>
            <ul className="mt-4 divide-y divide-border">
              {steps.map((s) => (
                <li key={s.t} className="flex items-center gap-4 py-3.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-gradient-emerald text-white" : "bg-muted text-muted-foreground"}`}>{s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : null}</span>
                  <span>
                    <span className="block font-medium">{s.t}</span>
                    <span className="block text-sm text-muted-foreground">{s.d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <p className="mt-6 text-sm text-muted-foreground">
            Buyer account instead? <Link to="/app" className="font-semibold text-primary hover:underline">Open the buyer workspace</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
