import { createFileRoute } from "@tanstack/react-router";

import { LoginPage } from "@/features/auth/AuthPages";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login — Vendora" }] }),
  component: LoginPage,
});
