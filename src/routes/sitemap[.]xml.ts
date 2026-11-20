import { createFileRoute } from "@tanstack/react-router";

import { listPublicStorefronts, sitemapXml, type SitemapEntry } from "@/lib/storefront-api";
import { siteOrigin } from "@/server/site.server";

/**
 * The sitemap Google reads: the home page and every storefront that is public TODAY. A storefront whose proof expired, or that the
 * owner switched off, is simply not listed any more, so an old "Verified" listing cannot be kept alive.
 */
const PAGE = 1000;
const MAX_PAGES = 40;

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const origin = siteOrigin(request);
        if (!origin) return new Response("Site address is not configured. Set APP_URL.", { status: 503, headers: { "cache-control": "no-store" } });
        try {
          const all: SitemapEntry[] = [];
          for (let i = 0; i < MAX_PAGES; i++) {
            const rows = await listPublicStorefronts(PAGE, i * PAGE);
            all.push(...rows);
            if (rows.length < PAGE) break;
          }
          return new Response(sitemapXml(origin, all), {
            headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900, s-maxage=900" },
          });
        } catch {
          return new Response("Sitemap is temporarily unavailable.", { status: 503, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
