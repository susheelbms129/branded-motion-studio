import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

/** Fires once when the element scrolls into view. */
export function useInView<T extends Element>(threshold = 0.15) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

export function Reveal({
  children,
  delay = 0,
  className = "",
  scale = false,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  scale?: boolean;
  as?: ElementType;
}) {
  const [ref, seen] = useInView<HTMLElement>();
  const style: CSSProperties = { transitionDelay: `${delay}s` };
  return (
    <Tag ref={ref} style={style} className={`${scale ? "reveal-scale" : "reveal"} ${seen ? "in" : ""} ${className}`}>
      {children}
    </Tag>
  );
}

/** Counts up to `to` the first time it is visible. */
export function CountUp({ to, duration = 1600, prefix = "", suffix = "", className = "" }: { to: number; duration?: number; prefix?: string; suffix?: string; className?: string }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!seen) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setVal(Math.round(to * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration]);
  return (
    <span ref={ref} className={className}>
      {prefix}
      {val}
      {suffix}
    </span>
  );
}

/** Card that follows the cursor with a soft light. */
export function Spot({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`spot ${className}`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}

/** Splits a headline into words that rise in one after another. */
export function Words({ text, className = "", start = 0.1, step = 0.07 }: { text: string; className?: string; start?: number; step?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.12em] align-top">
          <span className={`word ${className}`} style={{ animationDelay: `${start + i * step}s` }}>
            {w}&nbsp;
          </span>
        </span>
      ))}
    </>
  );
}

export function useScrollY() {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setY(window.scrollY));
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return y;
}

export function SectionHead({ eyebrow, title, body, dark = true, center = true }: { eyebrow: string; title: ReactNode; body?: string; dark?: boolean; center?: boolean }) {
  return (
    <Reveal className={`${center ? "mx-auto text-center" : ""} max-w-3xl`}>
      <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${dark ? "border-white/15 bg-white/5 text-cyan" : "border-violet/20 bg-violet/5 text-violet"}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {eyebrow}
      </span>
      <h2 className={`mt-6 text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-6xl ${dark ? "text-white" : "text-foreground"}`}>{title}</h2>
      {body ? <p className={`mt-5 text-lg leading-relaxed sm:text-xl ${dark ? "text-navy-muted" : "text-muted-foreground"}`}>{body}</p> : null}
    </Reveal>
  );
}
