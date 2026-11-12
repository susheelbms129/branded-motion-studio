import { createFileRoute } from "@tanstack/react-router";

import { SignupPage } from "@/features/auth/AuthPages";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Signup — Vendora" }] }),
  component: SignupPage,
});
