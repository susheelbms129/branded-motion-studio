import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MENUS } from "./content";
import { Logo } from "./Logo";
import { useScrollY } from "./motion";

export function SiteHeader() {
  const y = useScrollY();
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [progress, setProgress] = useState(0);
  const wrap = useRef<HTMLElement>(null);
  const scrolled = y > 24;

  useEffect(() => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    setProgress(max > 0 ? Math.min(1, y / max) : 0);
  }, [y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        setMobile(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobile ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobile]);

  const go = () => {
    setOpen(null);
    setMobile(false);
  };

  return (
    <>
      <header ref={wrap} className="fixed inset-x-0 top-0 z-50">
        <a href="#lab" className="group flex items-center justify-center gap-3 bg-gradient-to-r from-violet/30 via-blue/30 to-magenta/30 px-4 py-3.5 text-center text-base font-medium sm:text-lg text-white backdrop-blur">
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider">New</span>
          <span className="truncate">The cheapest unit price is rarely the cheapest order. See the real landed cost</span>
          <ArrowRight className="hidden h-5 w-5 shrink-0 transition group-hover:translate-x-1 sm:block" />
        </a>

        <div className={`transition-all duration-500 ${scrolled ? "border-b border-white/10 bg-navy/95 backdrop-blur-xl" : "bg-transparent"}`}>
          <div className={`mx-auto flex max-w-[1600px] items-center justify-between px-5 transition-all duration-500 sm:px-8 ${scrolled ? "h-[104px]" : "h-[132px]"}`}>
            <a href="#top" aria-label="Vendora home" className="shrink-0">
              <Logo className={scrolled ? "h-[80px]" : "h-[104px]"} />
            </a>

            <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
              {MENUS.map((m) => (
                <div key={m.label} className="relative" onMouseEnter={() => setOpen(m.label)} onMouseLeave={() => setOpen(null)}>
                  <button
                    type="button"
                    aria-expanded={open === m.label}
                    onClick={() => setOpen(open === m.label ? null : m.label)}
                    className={`flex items-center gap-2 rounded-full px-6 py-3.5 text-[20px] font-semibold transition ${open === m.label ? "bg-white/10 text-white" : "text-white/85 hover:text-white"}`}
                  >
                    {m.label}
                    <ChevronDown className={`h-5 w-5 transition ${open === m.label ? "rotate-180" : ""}`} />
                  </button>
                  {open === m.label ? (
                    <div className="menu-in absolute left-1/2 top-full w-[800px] -translate-x-1/2 pt-3">
                      <div className="overflow-hidden rounded-3xl border border-white/15 bg-navy-2 p-4 shadow-[0_30px_80px_-10px_oklch(0_0_0/70%)]">
                        <p className="px-4 pb-3 pt-2 text-lg text-navy-muted">{m.blurb}</p>
                        <div className="grid grid-cols-2 gap-1">
                          {m.items.map((it) => (
                            <a key={it.title} href={it.href} onClick={go} className="group flex items-start gap-4 rounded-2xl p-4 transition hover:bg-white/10">
                              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-primary text-white transition group-hover:scale-110 group-hover:rotate-3">
                                <it.icon className="h-6 w-6" />
                              </span>
                              <span>
                                <span className="block text-xl font-semibold text-white">{it.title}</span>
                                <span className="block text-base leading-snug text-navy-muted">{it.desc}</span>
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
              <a href="#plans" className="rounded-full px-6 py-3.5 text-[20px] font-semibold text-white/85 transition hover:text-white">
                Plans
              </a>
            </nav>

            <div className="hidden items-center gap-3 lg:flex">
              <Link to="/get-started" className="btn-shine inline-flex items-center gap-3 rounded-full bg-gradient-cta px-10 py-[18px] text-[20px] font-semibold text-white shadow-glow transition hover:scale-105">
                Get started
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>

            <button type="button" aria-label={mobile ? "Close menu" : "Open menu"} onClick={() => setMobile((v) => !v)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white lg:hidden">
              {mobile ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
          <div className="h-[2px] origin-left bg-gradient-cta" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </header>

      {mobile ? (
        <div className="menu-in fixed inset-0 z-40 overflow-y-auto bg-navy px-6 pb-10 pt-40 lg:hidden">
          {MENUS.map((m) => (
            <div key={m.label} className="mb-8">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-cyan">{m.label}</p>
              <div className="space-y-1">
                {m.items.map((it) => (
                  <a key={it.title} href={it.href} onClick={go} className="flex items-center gap-3 rounded-2xl p-3 text-lg font-medium text-white active:bg-white/10">
                    <it.icon className="h-5 w-5 text-violet" />
                    {it.title}
                  </a>
                ))}
              </div>
            </div>
          ))}
          <a href="#plans" onClick={go} className="mb-8 block text-lg font-semibold text-white">
            Plans
          </a>
          <Link to="/get-started" onClick={go} className="block rounded-full bg-gradient-cta py-3.5 text-center font-semibold text-white">
            Get started
          </Link>
        </div>
      ) : null}
    </>
  );
}
