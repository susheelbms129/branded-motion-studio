import { Link } from "@tanstack/react-router";
import { ArrowRight, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { HeroAssistant, HeroDashboard, HeroPhone } from "./HeroVisual";
import { Words, useScrollY } from "./motion";

export function Hero() {
  const y = useScrollY();
  const [mouse, setMouse] = useState({ x: 50, y: 30 });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const tilt = Math.max(0, 18 - y / 22);
  const lift = Math.min(60, y / 8);

  return (
    <section
      id="top"
      className="relative isolate overflow-hidden bg-navy pb-24 pt-[210px] sm:pt-[270px]"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setMouse({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
      }}
    >
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid-dark mask-radial absolute inset-0 opacity-70" />
        <div className="glow-violet animate-orb absolute -left-40 top-10 h-[620px] w-[620px] opacity-80" />
        <div className="glow-blue animate-orb-slow absolute -right-32 top-40 h-[560px] w-[560px] opacity-70" />
        <div className="glow-magenta animate-orb absolute left-1/3 top-[420px] h-[460px] w-[460px] opacity-50" />
        <div className="absolute inset-0 transition-[background] duration-300" style={{ background: `radial-gradient(600px circle at ${mouse.x}% ${mouse.y}%, oklch(0.65 0.22 285 / 16%), transparent 60%)` }} />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-navy to-transparent" />
      </div>

      <div className="mx-auto max-w-[1400px] px-5 text-center sm:px-8">
        <div className={`inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/90 backdrop-blur transition duration-700 sm:text-sm ${mounted ? "opacity-100" : "opacity-0"}`}>
          <Sparkles className="h-4 w-4 text-magenta" />
          <span className="text-gradient-brand-dark animate-gradient-pan">AI-native</span> procurement for growing Indian businesses
        </div>

        <h1 className="mx-auto mt-7 max-w-[1250px] text-[2.9rem] font-semibold leading-[1.04] text-white sm:text-7xl lg:text-[6.4rem]">
          <Words text="Every" className="grad-every" />
          <Words text="rupee" className="grad-rupee" start={0.2} />
          <Words text="you spend," start={0.35} />
          <br className="hidden sm:block" />
          <Words text="finally accounted for." start={0.6} />
        </h1>

        <p className={`mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-navy-muted transition duration-1000 delay-700 sm:text-2xl sm:leading-relaxed ${mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}>
          Stop losing track of business spending. Bring suppliers, purchase requests, approvals and orders together with Vendora. Make smarter purchasing decisions, reduce unnecessary costs and stay in control of every rupee.
        </p>

        <div className={`mt-10 flex flex-col items-center justify-center gap-4 transition duration-1000 delay-[900ms] sm:flex-row ${mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}>
          <Link to="/get-started" className="btn-shine group inline-flex items-center gap-3 rounded-full bg-gradient-cta px-9 py-5 text-lg font-semibold text-white shadow-glow transition hover:scale-105">
            Get started
            <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1.5" />
          </Link>
          <a href="#lab" className="group inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/5 px-8 py-5 text-lg font-semibold text-white backdrop-blur transition hover:bg-white/10">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition group-hover:scale-110">
              <Play className="h-3.5 w-3.5 fill-white" />
            </span>
            Try the Landed-Cost Lab
          </a>
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-navy-muted">
          <ShieldCheck className="h-4 w-4 text-emerald" /> Made for ₹, GST and the way Indian teams actually approve purchases.
        </p>
      </div>

      {/* product stage */}
      <div className="relative mx-auto mt-16 max-w-[1280px] px-4 sm:mt-24 sm:px-8" style={{ perspective: "1800px" }}>
        <div className="pointer-events-none absolute inset-x-10 -top-10 h-40 rounded-full bg-gradient-cta opacity-40 blur-3xl" />
        <div className="relative" style={{ transform: `rotateX(${tilt}deg) translateY(${-lift}px)`, transformOrigin: "50% 100%", transition: "transform 120ms linear" }}>
          <div className="pop-in">
            <HeroDashboard />
          </div>

          <div className="animate-float absolute -bottom-10 -left-2 z-10 hidden sm:block lg:-left-10" style={{ transform: `translateY(${y * -0.04}px)` }}>
            <HeroAssistant />
          </div>
          <div className="animate-float-slow absolute -bottom-12 -right-2 z-10 hidden md:block lg:-right-10" style={{ transform: `translateY(${y * -0.07}px)` }}>
            <HeroPhone />
          </div>

          <div className="animate-float-slow absolute -top-6 right-[12%] z-10 hidden rounded-2xl border border-white/20 bg-white px-4 py-3 shadow-lift lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald">Saved on this order</p>
            <p className="text-2xl font-semibold tabular text-foreground">₹27,370</p>
          </div>
          <div className="animate-float absolute -top-4 left-[10%] z-10 hidden items-center gap-3 rounded-2xl border border-white/20 bg-white px-4 py-3 shadow-lift lg:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-ai text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">Price creep spotted</p>
              <p className="text-xs text-muted-foreground">Hot-rolled coil +12.7%</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
