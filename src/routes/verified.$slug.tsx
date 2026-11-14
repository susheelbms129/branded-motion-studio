import { createFileRoute } from "@tanstack/react-router";

import { PublicPassportPage } from "@/features/public/PublicPassportPage";
import { getPublicPassport, type PublicPassport } from "@/lib/passport-api";

interface Loaded {
  data: PublicPassport | null;
  failed: boolean;
}

/**
 * A supplier's shareable Trust Passport. Public on purpose: anyone with the link can open it without signing in.
 * It loads on the server too, so WhatsApp and Google previews show the real company name and level.
 */
export const Route = createFileRoute("/verified/$slug")({
  loader: async ({ params }): Promise<Loaded> => {
    try {
      return { data: await getPublicPassport(params.slug), failed: false };
    } catch {
      return { data: null, failed: true };
    }
  },
  head: ({ loaderData }) => {
    const d = (loaderData as Loaded | undefined)?.data;
    if (!d) {
      return { meta: [{ title: "Trust Passport — Vendora" }, { name: "robots", content: "noindex" }] };
    }
    const title = `${d.name} on Vendora: ${d.passport.level > 0 ? d.passport.level_name : "not verified today"}`;
    const description =
      d.passport.level > 0
        ? `See what Vendora verified about ${d.name}, how it was checked and until when. Read live, never an old screenshot.`
        : `${d.name} has no valid verified proof today.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: PassportRoute,
});

function PassportRoute() {
  const loaded = Route.useLoaderData() as Loaded;
  return <PublicPassportPage data={loaded.data} failed={loaded.failed} />;
}
