import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app/AppShell";
import { requireWorkspace, signedInAccountType } from "@/lib/auth";

// The signed-in app is client-only: the session lives in the browser and demo data is date-relative.
// This is the BUYER workspace. Supplier accounts are always sent to their own area.
export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireWorkspace();
    if (r === "signin") throw redirect({ to: "/signin" });
    if ((await signedInAccountType()) === "supplier") throw redirect({ to: "/supplier/dashboard" });
    if (r === "onboarding") throw redirect({ to: "/onboarding" });
  },
  head: () => ({ meta: [{ title: "Vendora — Procurement workspace" }] }),
  component: AppShell,
});
