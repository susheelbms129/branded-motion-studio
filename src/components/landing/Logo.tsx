import { useState } from "react";

import { BRAND } from "./content";

/** The Vendora logo exactly as supplied (transparent background, no recolouring). */
export function Logo({ className = "h-12" }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-2xl font-semibold tracking-tight text-white">Vendora</span>;
  return <img src={BRAND.lockup} alt="Vendora — Smarter Buying. Greater Business." className={`w-auto ${className}`} onError={() => setFailed(true)} />;
}
