import { createFileRoute } from "@tanstack/react-router";

import { SupplierDirectoryPage } from "@/features/directory/SupplierDirectoryPage";

export const Route = createFileRoute("/buyer/dashboard/find-suppliers/")({
  head: () => ({ meta: [{ title: "Find suppliers — Vendora" }] }),
  component: SupplierDirectoryPage,
});
