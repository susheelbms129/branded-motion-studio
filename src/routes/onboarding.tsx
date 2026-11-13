import { createFileRoute, redirect } from "@tanstack/react-router";

import { OnboardingPage } from "@/features/auth/AuthPages";
import { requireWorkspace } from "@/lib/auth";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireWorkspace();
    if (r === "signin") throw redirect({ to: "/signin" });
    if (r === "ok") throw redirect({ to: "/app" });
  },
  head: () => ({ meta: [{ title: "Onboarding — Vendora" }] }),
  component: OnboardingPage,
});
