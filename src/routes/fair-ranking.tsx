import { createFileRoute } from "@tanstack/react-router";

import { FairRankingPage } from "@/features/public/FairRankingPage";
import { getFairRankRules, type FairRankRules } from "@/lib/fair-rank-api";

/**
 * How Vendora ranks suppliers. Public on purpose: a promise that nobody can read is not a promise. The formula is read from
 * the database function the ranking itself runs, so this page can never drift from the truth.
 */
export const Route = createFileRoute("/fair-ranking")({
  loader: async (): Promise<{ rules: FairRankRules | null }> => {
    try {
      return { rules: await getFairRankRules() };
    } catch {
      return { rules: null };
    }
  },
  head: () => ({
    meta: [
      { title: "How ranking works — Vendora" },
      {
        name: "description",
        content: "Suppliers on Vendora earn their position from trust, response speed and delivery record. It can't be bought, and leads are never sold.",
      },
      { property: "og:title", content: "How ranking works — Vendora" },
    ],
  }),
  component: FairRankingRoute,
});

function FairRankingRoute() {
  const { rules } = Route.useLoaderData() as { rules: FairRankRules | null };
  return <FairRankingPage rules={rules} />;
}
