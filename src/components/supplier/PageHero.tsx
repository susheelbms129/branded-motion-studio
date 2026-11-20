import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The one header every supplier page shares: dark gradient card, small label, big title, one line of help,
 * and room on the right for a key number or button. Keeps all supplier pages looking like one product.
 */
export function PageHero({
  label,
  icon: Icon,
  title,
  children,
  aside,
  glow = "glow-violet",
  className,
}: {
  label: string;
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  glow?: "glow-violet" | "glow-blue" | "glow-pink" | "glow-emerald" | "glow-cyan" | "glow-magenta";
  className?: string;
}) {
  return (
    <section className={cn("relative overflow-hidden rounded-3xl bg-gradient-navy p-6 text-white shadow-card sm:p-8", className)}>
      <div className={cn("pointer-events-none absolute -right-24 -top-24 size-80 opacity-40", glow)} aria-hidden />
      <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 glow-blue opacity-20" aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0 basis-72 flex-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-navy-muted">
            {Icon ? <Icon className="size-4" aria-hidden /> : null} {label}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-3xl">{title}</h1>
          {children ? <p className="mt-2 max-w-2xl text-sm text-navy-muted sm:text-base">{children}</p> : null}
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-6">{aside}</div> : null}
      </div>
    </section>
  );
}
