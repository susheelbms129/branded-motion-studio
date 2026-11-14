import { Link } from "@tanstack/react-router";
import { Check, ShieldCheck } from "lucide-react";

import { SupplierShell, useSupplier, VERIFICATION_LABEL } from "@/components/supplier/SupplierShell";
import type { VerificationStatus } from "@/lib/onboarding-api";

export function SupplierDashboardPage() {
  return (
    <SupplierShell>
      <DashboardContent />
    </SupplierShell>
  );
}

function DashboardContent() {
  // The business name, products and verification status come from the database, not from the browser.
  // If they can't be read, the page still works with safe defaults.
  const { summary } = useSupplier();
  const name = summary?.name || "Your business";
  const status: VerificationStatus = summary?.verification ?? "not_submitted";
  const steps = [
    // This page is only reachable after the supplier has launched their business, so the profile is done.
    { t: "Business profile", d: "Name, address and contact details", done: true },
    { t: "Add your products", d: "List what you sell, with price and availability", done: (summary?.products ?? 0) > 0 },
    { t: "Verify your business", d: "Submit your registration so buyers can trust you", done: status === "submitted" || status === "in_review" || status === "verified" },
    { t: "Invite your team", d: "Add colleagues to this supplier workspace", done: false },
  ];
  const stats = [
    ["Open quote requests", "0"],
    ["Quotations sent", "0"],
    ["Active orders", "0"],
    ["Connected buyers", "0"],
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Welcome, {name}</h1>
          <p className="mt-1 text-muted-foreground">Here is what to do to start receiving orders.</p>
        </div>
        <Link to="/supplier/verification" className={`${status === "verified" ? "tint-emerald" : "tint-amber"} flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition hover:opacity-80`}>
          <ShieldCheck className="h-4 w-4" /> {VERIFICATION_LABEL[status]}
        </Link>
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
              {s.t === "Verify your business" ? (
                <Link to="/supplier/verification" className="ml-auto rounded-md bg-gradient-cta px-3.5 py-2 text-sm font-semibold text-white">
                  {s.done ? "View Trust Passport" : "Start"}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
