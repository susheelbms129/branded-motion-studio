import { createFileRoute } from "@tanstack/react-router";

import { getPublicStorefrontImage, isUuid, parseImage } from "@/lib/storefront-api";

/**
 * The photos of a PUBLIC storefront, each at its own address so Google and WhatsApp can fetch them:
 *   /api/public/storefront-image/<slug>/logo        the company logo
 *   /api/public/storefront-image/<slug>/<product id>  the first photo of one product
 * The database only returns a photo while the storefront is published and the company is verified today.
 */
const reply = (status: number, cache: string, body?: Uint8Array, type?: string) =>
  new Response(body ? (body as BodyInit) : null, {
    status,
    headers: {
      ...(type ? { "content-type": type } : {}),
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "cross-origin-resource-policy": "cross-origin",
    },
  });

export const Route = createFileRoute("/api/public/storefront-image/$slug/$kind")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { slug: string; kind: string } }) => {
        const { slug, kind } = params;
        if (kind !== "logo" && !isUuid(kind)) return reply(404, "public, max-age=300");
        try {
          const url = await getPublicStorefrontImage(slug, kind === "logo" ? "logo" : "product", kind === "logo" ? null : kind);
          const img = url ? parseImage(url) : null;
          if (!img) return reply(404, "public, max-age=300");
          return reply(200, "public, max-age=3600, s-maxage=3600", img.bytes, img.type);
        } catch {
          return reply(503, "no-store");
        }
      },
    },
  },
});
