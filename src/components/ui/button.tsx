import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium cursor-pointer select-none transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "btn-shine bg-gradient-cta text-on-brand shadow-glow hover:-translate-y-px hover:brightness-110",
        hero: "rounded-full bg-gradient-cta animate-gradient-pan text-on-brand shadow-glow hover:brightness-110 hover:-translate-y-0.5",
        glass:
          "rounded-full glass-dark text-navy-foreground hover:bg-navy-foreground/10 hover:-translate-y-0.5",
        destructive: "bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90",
        outline:
          "border border-input bg-card/60 text-foreground shadow-soft backdrop-blur hover:bg-accent hover:text-accent-foreground dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        soft: "tint-blue hover:brightness-95",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        "ghost-dark": "text-navy-muted hover:bg-navy-foreground/10 hover:text-navy-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-11 px-6 text-[15px]",
        xl: "h-12 px-7 text-base",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
