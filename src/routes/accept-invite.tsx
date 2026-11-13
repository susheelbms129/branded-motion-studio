import { createFileRoute } from "@tanstack/react-router";

import { AcceptInvitePage } from "@/features/auth/AcceptInvitePage";

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "Accept invitation — Vendora" }, { name: "robots", content: "noindex" }] }),
  component: AcceptInvitePage,
});
