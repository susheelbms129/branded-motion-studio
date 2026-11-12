import { useState } from "react";

import lockup from "@/assets/brand/vendora-lockup.png.asset.json";
import mark from "@/assets/brand/vendora-mark.png.asset.json";
import wordmark from "@/assets/brand/vendora-wordmark.png.asset.json";
import { cn } from "@/lib/utils";

type Variant = "full" | "mark" | "wordmark" | "lockup";

/** Brand artwork is used as supplied. If hosted assets can't load (outside Lovable) it falls back to the favicon symbol + text. */
export function VendoraLogo({
  variant = "full",
  className,
  height = 32,
}: {
  variant?: Variant;
  className?: string;
  height?: number;
}) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const fail = (k: string) => setFailed((f) => ({ ...f, [k]: true }));
  const Mark = () =>
    failed["mark"] ? (
      <img
        src="/favicon.png"
        alt="Vendora"
        style={{ height, width: height }}
        className="rounded-lg object-cover"
      />
    ) : (
      <img
        src={mark.url}
        alt="Vendora"
        onError={() => fail("mark")}
        style={{ height }}
        className="logo-blend w-auto object-contain"
      />
    );
  const Word = () =>
    failed["word"] ? (
      <span
        className="font-semibold tracking-tight text-navy-foreground"
        style={{ fontSize: height * 0.62 }}
      >
        Vendora
      </span>
    ) : (
      <img
        src={wordmark.url}
        alt="Vendora"
        onError={() => fail("word")}
        style={{ height: height * 0.72 }}
        className="logo-blend w-auto object-contain"
      />
    );
  if (variant === "mark")
    return (
      <span className={cn("inline-flex", className)}>
        <Mark />
      </span>
    );
  if (variant === "wordmark")
    return (
      <span className={cn("inline-flex", className)}>
        <Word />
      </span>
    );
  if (variant === "lockup" && !failed["lockup"])
    return (
      <img
        src={lockup.url}
        alt="Vendora — Smarter Buying. Greater Business."
        onError={() => fail("lockup")}
        style={{ height: height * 2.6 }}
        className={cn("logo-blend w-auto object-contain", className)}
      />
    );
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark />
      <Word />
    </span>
  );
}
