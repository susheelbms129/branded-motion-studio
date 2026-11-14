import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app/AppShell";
import { buyerAppGuard } from "@/lib/route-guards";

// The signed-in app is client-only: the session lives in the browser and demo data is date-relative.
// This is the BUYER workspace. Supplier accounts are always sent to their own area.
export const Route = createFileRoute("/buyer/dashboard")({
  ssr: false,
  beforeLoad: buyerAppGuard,
  head: () => ({ meta: [{ title: "Vendora — Procurement workspace" }] }),
  component: AppShell,
});
