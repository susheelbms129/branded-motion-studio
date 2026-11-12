import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

export type CurrencyCode = "INR" | "USD" | "EUR" | "AED";

const LOCALE_FOR: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "en-IE",
  AED: "en-AE",
};

let activeCurrency: CurrencyCode = "INR";
export function setActiveCurrency(code: CurrencyCode) {
  activeCurrency = code;
}
export function getActiveCurrency(): CurrencyCode {
  return activeCurrency;
}

/** ₹1,25,000 — Indian digit grouping for INR. */
export function formatMoney(
  value: number,
  opts: { currency?: CurrencyCode; decimals?: number; compact?: boolean } = {},
): string {
  const currency = opts.currency ?? activeCurrency;
  const locale = LOCALE_FOR[currency];
  if (opts.compact) return formatMoneyCompact(value, currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: opts.decimals ?? 0,
    minimumFractionDigits: opts.decimals ?? 0,
  }).format(value);
}

/** ₹12.4L / ₹1.2Cr for INR, $12.4K for others. */
export function formatMoneyCompact(value: number, currency: CurrencyCode = activeCurrency): string {
  const symbol = new Intl.NumberFormat(LOCALE_FOR[currency], { style: "currency", currency })
    .formatToParts(0)
    .find((p) => p.type === "currency")?.value ?? "";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (currency === "INR") {
    if (abs >= 1e7) return `${sign}${symbol}${trim(abs / 1e7)}Cr`;
    if (abs >= 1e5) return `${sign}${symbol}${trim(abs / 1e5)}L`;
    if (abs >= 1e3) return `${sign}${symbol}${trim(abs / 1e3)}K`;
    return `${sign}${symbol}${Math.round(abs)}`;
  }
  if (abs >= 1e6) return `${sign}${symbol}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${symbol}${trim(abs / 1e3)}K`;
  return `${sign}${symbol}${Math.round(abs)}`;
}

function trim(n: number) {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, "");
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

function toDate(d: string | Date): Date {
  return typeof d === "string" ? parseISO(d) : d;
}

/** 12 Nov 2026 */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = toDate(d);
  return isValid(date) ? format(date, "dd MMM yyyy") : "—";
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = toDate(d);
  return isValid(date) ? format(date, "dd MMM yyyy, h:mm a") : "—";
}

export function formatRelative(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = toDate(d);
  return isValid(date) ? `${formatDistanceToNowStrict(date)} ago` : "—";
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
