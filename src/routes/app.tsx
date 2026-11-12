import { createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app/AppShell";
import { useUi } from "@/lib/ui-store";

// The signed-in app is client-only: demo data is date-relative and UI state lives in localStorage.
export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: () => {
    const s = useUi.getState();
    if (!s.user) throw redirect({ to: "/login" });
    if (!s.onboarded) throw redirect({ to: "/onboarding" });
  },
  head: () => ({ meta: [{ title: "Vendora — Procurement workspace" }] }),
  component: AppShell,
});
