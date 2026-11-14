import { createFileRoute } from "@tanstack/react-router";

import { badgeSvg, type BadgeLevel } from "@/lib/passport-badge";
import { getPublicPassport } from "@/lib/passport-api";

/**
 * The embeddable badge: <img src="https://<site>/api/public/badge/<company-slug>">. Always today's level, read live, so
 * an old copy of the link cannot show a "Verified" that no longer holds. Only fixed words are drawn, never database text.
 */
const svg = (level: BadgeLevel, status: number, cache: string) =>
  new Response(badgeSvg(level), {
    status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
    },
  });

export const Route = createFileRoute("/api/public/badge/$slug")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { slug: string } }) => {
        try {
          const p = await getPublicPassport(params.slug);
          if (!p) return svg(null, 404, "public, max-age=300");
          const level = Math.min(3, Math.max(0, Number(p.passport.level))) as BadgeLevel;
          return svg(level, 200, "public, max-age=900, s-maxage=900");
        } catch {
          return svg(null, 503, "no-store");
        }
      },
    },
  },
});
