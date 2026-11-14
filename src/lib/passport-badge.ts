/**
 * The small badge a supplier can put on a website, quotation or WhatsApp status. Pure text in, SVG text out, so it can be
 * served by the badge route and checked by a test. It never contains a company name or any text from the database:
 * only the fixed words below, so nothing can be injected into the image.
 *
 * level: 0 = not verified today, 1..3 = the Trust Passport level today, null = the page is not available.
 */
export type BadgeLevel = 0 | 1 | 2 | 3 | null;

const RIGHT_TEXT: Record<string, string> = {
  "1": "Registered",
  "2": "Verified",
  "3": "Verified + Certificates",
  "0": "Not verified today",
  none: "Not available",
};
const RIGHT_FILL: Record<string, string> = {
  "1": "#0f9d6b",
  "2": "#0b8a5c",
  "3": "#07704a",
  "0": "#c27803",
  none: "#6b7280",
};

const LEFT_TEXT = "Vendora Trust Passport";
const CHAR_W = 6.4;
const PAD = 12;
const ICON = 24;

export function badgeAlt(level: BadgeLevel): string {
  return `${LEFT_TEXT}: ${RIGHT_TEXT[level === null ? "none" : String(level)]}`;
}

export function badgeSvg(level: BadgeLevel): string {
  const key = level === null ? "none" : String(level);
  const right = RIGHT_TEXT[key]!;
  const fill = RIGHT_FILL[key]!;
  const leftW = Math.round(ICON + PAD + LEFT_TEXT.length * CHAR_W);
  const rightW = Math.round(PAD * 2 + right.length * CHAR_W);
  const w = leftW + rightW;
  const label = `${LEFT_TEXT}: ${right}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="32" viewBox="0 0 ${w} 32" role="img" aria-label="${label}">` +
    `<title>${label}</title>` +
    `<clipPath id="r"><rect width="${w}" height="32" rx="6"/></clipPath>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${leftW}" height="32" fill="#14213d"/>` +
    `<rect x="${leftW}" width="${rightW}" height="32" fill="${fill}"/>` +
    `</g>` +
    `<path d="M16 7l7 2.6v5.2c0 4.1-2.9 7.6-7 9-4.1-1.4-7-4.9-7-9V9.6L16 7z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" transform="translate(-4 -0.5)"/>` +
    `<path d="M12.2 15.6l2.1 2.1 4-4.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(-4 -0.5)"/>` +
    `<g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" font-weight="600" text-anchor="middle">` +
    `<text x="${ICON + PAD / 2 + (leftW - ICON - PAD / 2) / 2}" y="20.5">${LEFT_TEXT}</text>` +
    `<text x="${leftW + rightW / 2}" y="20.5">${right}</text>` +
    `</g></svg>`
  );
}
