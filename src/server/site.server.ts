/**
 * Server-only. The public address of this site, used for canonical links, preview images and the sitemap.
 * APP_URL wins when it is set; otherwise it is read from the request headers, and only accepted when it looks like a plain
 * host name, so a forged Host header can never put a strange address into a page Google reads.
 */
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/i;

type Header = (name: string) => string | null | undefined;

export function siteOriginFrom(header: Header, fallbackHost = "", fallbackProto = "https"): string {
  const fixed = (process.env["APP_URL"] ?? "").trim().replace(/\/$/, "");
  if (/^https?:\/\/[^\s]+$/i.test(fixed)) return fixed;
  const host = (header("x-forwarded-host") ?? header("host") ?? fallbackHost).split(",")[0]!.trim();
  if (!HOST.test(host)) return "";
  const proto = (header("x-forwarded-proto") ?? fallbackProto).split(",")[0]!.trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/** For API routes, where the whole Request is at hand. */
export function siteOrigin(request: Request): string {
  try {
    const u = new URL(request.url);
    return siteOriginFrom((n) => request.headers.get(n), u.host, u.protocol.replace(":", ""));
  } catch {
    return siteOriginFrom(() => null);
  }
}
