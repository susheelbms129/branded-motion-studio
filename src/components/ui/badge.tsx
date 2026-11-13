import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "tint-blue",
        secondary: "tint-slate",
        destructive: "tint-red",
        outline: "border text-foreground",
        blue: "tint-blue",
        cyan: "tint-cyan",
        violet: "tint-violet",
        magenta: "tint-magenta",
        emerald: "tint-emerald",
        amber: "tint-amber",
        coral: "tint-coral",
        pink: "tint-pink",
        indigo: "tint-indigo",
        slate: "tint-slate",
        red: "tint-red",
        green: "tint-green",
        gradient: "bg-gradient-primary text-on-brand",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
