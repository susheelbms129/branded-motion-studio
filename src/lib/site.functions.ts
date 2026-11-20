import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { siteOriginFrom } from "@/server/site.server";

/** The site's public address, read on the server so a page can build absolute links (preview images, canonical address). */
export const getSiteOrigin = createServerFn({ method: "GET" }).handler(
  async (): Promise<string> => siteOriginFrom((n) => getRequestHeader(n)),
);
