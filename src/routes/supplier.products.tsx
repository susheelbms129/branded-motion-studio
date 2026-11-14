import { createFileRoute, redirect } from "@tanstack/react-router";

import { SupplierProductsPage } from "@/features/supplier/SupplierProductsPage";
import { hasSupplierWorkspace, requireSupplier } from "@/lib/auth";

export const Route = createFileRoute("/supplier/products")({
  ssr: false,
  beforeLoad: async () => {
    const r = await requireSupplier();
    if (r === "signin") throw redirect({ to: "/supplier/signin" });
    if (r === "buyer") throw redirect({ to: "/buyer/dashboard" });
    if (!(await hasSupplierWorkspace())) throw redirect({ to: "/supplier/onboarding" });
  },
  head: () => ({ meta: [{ title: "Products — Vendora" }] }),
  component: SupplierProductsPage,
});
