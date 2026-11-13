import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app/AppShell";
import { requireWorkspace, signedInAccountType } from "@/lib/auth";

// The signed-in app is client-only: the session lives in the browser and demo data is date-relative.
export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireWorkspace();
    if (r === "signin") throw redirect({ to: "/signin" });
    if (r === "onboarding") {
      throw redirect({ to: (await signedInAccountType()) === "supplier" ? "/supplier/onboarding" : "/onboarding" });
    }
  },
  head: () => ({ meta: [{ title: "Vendora — Procurement workspace" }] }),
  component: AppShell,
});
