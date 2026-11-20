import { createFileRoute } from "@tanstack/react-router";

import { siteOrigin } from "@/server/site.server";

/** Same rules as before, plus the sitemap address (which has to be absolute, so it is built from the site's own address). */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const origin = siteOrigin(request);
        const lines = [
          ...["Googlebot", "Bingbot", "Twitterbot", "facebookexternalhit", "*"].flatMap((a) => [`User-agent: ${a}`, "Allow: /", ""]),
          ...(origin ? [`Sitemap: ${origin}/sitemap.xml`, ""] : []),
        ];
        return new Response(lines.join("\n"), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
