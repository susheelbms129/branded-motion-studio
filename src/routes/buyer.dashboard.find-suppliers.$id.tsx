import { createFileRoute } from "@tanstack/react-router";

import { SupplierProfilePage } from "@/features/directory/SupplierProfilePage";

export const Route = createFileRoute("/buyer/dashboard/find-suppliers/$id")({
  head: () => ({ meta: [{ title: "Supplier profile — Vendora" }] }),
  component: SupplierProfilePage,
});
