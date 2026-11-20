import { createFileRoute } from "@tanstack/react-router";

import { CompanyProfilePage } from "@/features/supplier/CompanyProfilePage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/profile")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Company profile — Vendora" }] }),
  component: CompanyProfilePage,
});
