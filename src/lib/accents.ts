import type { Accent } from "@/types/domain";

/** Static class lookups so Tailwind can see every class literal. */
export const ACCENT: Record<
  Accent,
  { chip: string; tint: string; glow: string; text: string; dot: string; ring: string; color: string; badge: Accent | "violet" }
> = {
  blue: { chip: "bg-gradient-blue", tint: "tint-blue", glow: "glow-blue", text: "text-blue", dot: "bg-blue", ring: "ring-blue/30", color: "var(--brand-blue)", badge: "blue" },
  cyan: { chip: "bg-gradient-cyan", tint: "tint-cyan", glow: "glow-cyan", text: "text-cyan", dot: "bg-cyan", ring: "ring-cyan/30", color: "var(--brand-cyan)", badge: "cyan" },
  violet: { chip: "bg-gradient-purple", tint: "tint-violet", glow: "glow-violet", text: "text-violet", dot: "bg-violet", ring: "ring-violet/30", color: "var(--brand-violet)", badge: "violet" },
  magenta: { chip: "bg-gradient-violet", tint: "tint-magenta", glow: "glow-magenta", text: "text-magenta", dot: "bg-magenta", ring: "ring-magenta/30", color: "var(--brand-magenta)", badge: "magenta" },
  emerald: { chip: "bg-gradient-emerald", tint: "tint-emerald", glow: "glow-emerald", text: "text-emerald", dot: "bg-emerald", ring: "ring-emerald/30", color: "var(--brand-emerald)", badge: "emerald" },
  amber: { chip: "bg-gradient-amber", tint: "tint-amber", glow: "glow-amber", text: "text-amber", dot: "bg-amber", ring: "ring-amber/30", color: "var(--brand-amber)", badge: "amber" },
  coral: { chip: "bg-gradient-amber", tint: "tint-coral", glow: "glow-pink", text: "text-coral", dot: "bg-coral", ring: "ring-coral/30", color: "var(--brand-coral)", badge: "coral" },
  pink: { chip: "bg-gradient-pink", tint: "tint-pink", glow: "glow-pink", text: "text-pink", dot: "bg-pink", ring: "ring-pink/30", color: "var(--brand-pink)", badge: "pink" },
  indigo: { chip: "bg-gradient-indigo", tint: "tint-indigo", glow: "glow-indigo", text: "text-indigo", dot: "bg-indigo", ring: "ring-indigo/30", color: "var(--brand-indigo)", badge: "indigo" },
  ai: { chip: "bg-gradient-ai", tint: "tint-violet", glow: "glow-magenta", text: "text-violet", dot: "bg-magenta", ring: "ring-violet/30", color: "var(--brand-violet)", badge: "violet" },
};

/** Brand chart palette as CSS variable references (works in SVG fill/stroke). */
export const CHART_COLORS = [
  "var(--brand-blue)",
  "var(--brand-violet)",
  "var(--brand-cyan)",
  "var(--brand-emerald)",
  "var(--brand-amber)",
  "var(--brand-magenta)",
  "var(--brand-coral)",
  "var(--brand-indigo)",
];
