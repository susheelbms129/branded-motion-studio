import { AlertCircle, RefreshCw } from "lucide-react";

import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import {
  Hero,
  NextSteps,
  ProductsPanel,
  QuoteInbox,
  StorefrontPreviewCard,
  TrustLadder,
} from "@/features/supplier/dashboard-panels";
import { useSupplierDashboard } from "@/features/supplier/use-supplier-dashboard";

export function SupplierDashboardPage() {
  return (
    <SupplierShell>
      <DashboardContent />
    </SupplierShell>
  );
}

function DashboardContent() {
  // Everything comes from the database for the signed-in supplier's own company. Nothing is kept in the browser.
  const { summary, status: shell } = useSupplier();
  const name = summary?.name || "Your business";
  const { data, strength, status, reload } = useSupplierDashboard(
    summary?.id ?? null,
    name,
    summary?.state ?? "",
  );
  const loading = shell === "loading" || status === "loading";

  if (!loading && (status === "error" || !data || !strength)) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <AlertCircle className="mx-auto size-8 text-amber" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">We couldn't load your dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Please check your connection and try again.
        </p>
        <button
          onClick={reload}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-gradient-cta px-4 py-2 text-sm font-semibold text-white"
        >
          <RefreshCw className="size-4" aria-hidden /> Try again
        </button>
      </div>
    );
  }

  const level = data?.strength.trustLevel ?? 0;
  return (
    <div className="space-y-6">
      <Hero name={name} strength={strength} loading={loading} />
      {data && strength ? (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <NextSteps strength={strength} />
            <ProductsPanel products={data.products} />
          </div>
          <div className="space-y-6 lg:col-span-2">
            <StorefrontPreviewCard p={data.preview} level={level} />
            <TrustLadder
              level={level}
              inReview={data.strength.proofsInReview}
              needsFix={data.strength.proofsNeedingFix}
            />
            <QuoteInbox level={level} />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5" aria-busy>
          <div className="h-72 animate-pulse rounded-2xl bg-muted lg:col-span-3" />
          <div className="h-72 animate-pulse rounded-2xl bg-muted lg:col-span-2" />
        </div>
      )}
    </div>
  );
}
