import { createFileRoute } from "@tanstack/react-router";

import { SupplierFairRankPage } from "@/features/supplier/SupplierFairRankPage";
import { supplierPageGuard } from "@/lib/route-guards";

export const Route = createFileRoute("/supplier/fair-rank")({
  ssr: false,
  beforeLoad: supplierPageGuard,
  head: () => ({ meta: [{ title: "Fair Rank — Vendora" }] }),
  component: SupplierFairRankPage,
});
