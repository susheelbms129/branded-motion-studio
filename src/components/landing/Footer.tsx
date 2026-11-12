import { ArrowUp } from "lucide-react";

import { FOOTER_COLS } from "./content";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-navy pt-24">
      <div className="mx-auto grid max-w-[1400px] gap-14 px-5 sm:px-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Logo className="h-20" />
          <p className="mt-6 max-w-md text-xl leading-relaxed text-navy-muted">Procurement that remembers everything, explains itself, and never loses a purchase order again.</p>
          <a href="#demo" className="btn-shine mt-8 inline-flex rounded-full bg-gradient-cta px-7 py-3.5 text-lg font-semibold text-white shadow-glow transition hover:scale-105">
            Book a Demo
          </a>
        </div>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-7">
          {FOOTER_COLS.map((c) => (
            <div key={c.title}>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan">{c.title}</p>
              <ul className="mt-5 space-y-3.5">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="text-lg text-white/80 transition hover:translate-x-1 hover:text-white">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <p aria-hidden className="animate-gradient-pan text-gradient-brand-dark pointer-events-none mt-20 select-none text-center text-[22vw] font-semibold leading-[0.8] tracking-tighter opacity-30">
        Vendora
      </p>

      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-4 px-5 py-7 text-sm text-navy-muted sm:flex-row sm:px-8">
          <p>© 2026 Vendora. Built for businesses that count every rupee.</p>
          <a href="#top" className="group inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-white transition hover:bg-white/10">
            Back to top <ArrowUp className="h-4 w-4 transition group-hover:-translate-y-0.5" />
          </a>
        </div>
      </div>
    </footer>
  );
}
