import { createFileRoute, notFound } from "@tanstack/react-router";

import { PublicStorefrontPage } from "@/features/public/PublicStorefrontPage";
import { getSiteOrigin } from "@/lib/site.functions";
import {
  getPublicStorefront,
  jsonLdText,
  logoPath,
  storefrontDescription,
  storefrontJsonLd,
  storefrontUrl,
  type PublicStorefront,
} from "@/lib/storefront-api";

interface Loaded {
  data: PublicStorefront;
  origin: string;
}

/**
 * A supplier's public storefront: https://<site>/s/<company-slug>. Anyone can open it without signing in, and Google can find it
 * (it is in /sitemap.xml and carries structured data). It loads on the server, so Google and WhatsApp see the real page.
 * A storefront that is not published, or whose company is not verified today, answers 404, exactly like one that does not exist.
 */
export const Route = createFileRoute("/s/$slug")({
  loader: async ({ params }): Promise<Loaded> => {
    // A failed lookup throws (error page, not a 404), so a short outage can never make Google drop a good page.
    const data = await getPublicStorefront(params.slug);
    if (!data) throw notFound();
    const origin = await getSiteOrigin().catch(() => "");
    return { data, origin: origin || (typeof window !== "undefined" ? window.location.origin : "") };
  },
  head: ({ loaderData }) => {
    const l = loaderData as Loaded | undefined;
    if (!l) return { meta: [{ title: "Storefront — Vendora" }, { name: "robots", content: "noindex" }] };
    const { data: d, origin } = l;
    const place = [d.city, d.state].filter(Boolean).join(", ");
    const title = `${d.name}${place ? `, ${place}` : ""} | Verified supplier on Vendora`;
    const description = storefrontDescription(d);
    const url = origin ? storefrontUrl(origin, d.slug) : "";
    const image = origin && d.has_logo ? `${origin}${logoPath(d.slug)}` : "";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        ...(url ? [{ property: "og:url", content: url }] : []),
        ...(image ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
      ],
      links: url ? [{ rel: "canonical", href: url }] : [],
      scripts: origin ? [{ type: "application/ld+json", children: jsonLdText(storefrontJsonLd(d, origin)) }] : [],
    };
  },
  component: StorefrontRoute,
});

function StorefrontRoute() {
  const { data, origin } = Route.useLoaderData() as Loaded;
  return <PublicStorefrontPage data={data} origin={origin} />;
}
