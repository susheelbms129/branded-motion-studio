import { createFileRoute } from "@tanstack/react-router";

import { AccountTypePicker } from "@/components/landing/AccountTypePicker";

export const Route = createFileRoute("/get-started")({
  head: () => ({ meta: [{ title: "Join Vendora" }] }),
  component: AccountTypePicker,
});
