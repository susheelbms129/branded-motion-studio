import { ScorecardSection } from "@/features/scorecard/ScorecardView";
import { Loader2, Scale, Sprout, Trophy, Truck, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHero } from "@/components/supplier/PageHero";
import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import {
  FAIR_PROMISES,
  getMyFairRank,
  hoursText,
  rankTier,
  rankTips,
  type MyFairRank,
} from "@/lib/fair-rank-api";
import { Link } from "@tanstack/react-router";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";

export function SupplierFairRankPage() {
  return (
    <SupplierShell>
      <Inner />
    </SupplierShell>
  );
}

function Inner() {
  const { status, summary } = useSupplier();
  const orgId = summary?.id ?? "";
  const [r, setR] = useState<MyFairRank | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!orgId) {
      setError("We couldn't find your supplier workspace.");
      setLoading(false);
      return;
    }
    let live = true;
    (async () => {
      try {
        const d = await getMyFairRank(orgId);
        if (live) setR(d);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Something went wrong. Please refresh.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [status, orgId]);

  return (
    <div className="space-y-6">
      <PageHero label="Fair Rank" icon={Scale} title="Your Fair Rank" glow="glow-violet">
        Buyers see suppliers in Fair Rank order. You earn your place from trust, response speed and delivery record. You can never
        pay for it, and you never pay to reach a buyer.
      </PageHero>

      {loading ? (
        <p className="mt-10 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : error ? (
        <p role="alert" className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </p>
      ) : r ? (
        <Body r={r} />
      ) : null}
      {orgId && !loading && !error ? <div className="mt-6"><ScorecardSection orgId={orgId} variant="self" /></div> : null}
    </div>
  );
}

function Meter({ label, icon: Icon, points, max, note }: { label: string; icon: typeof Zap; points: number; max: number; note: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (points / max) * 100)) : 0;
  return (
    <div className="rounded-xl bg-muted/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4" aria-hidden /> {label}
        </p>
        <p className="tabular text-sm font-semibold">
          {points.toFixed(1)} <span className="font-normal text-muted-foreground">of {max}</span>
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(points)}
      >
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Body({ r }: { r: MyFairRank }) {
  const tier = rankTier(r.score);
  const tips = rankTips(r);
  const rp = r.response;
  const dl = r.delivery;
  return (
    <>
      <section className={`${card} mt-8`}>
        {r.ranked && r.score !== null ? (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Trophy className="size-4" aria-hidden /> Your score today
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular text-5xl font-semibold">{r.score.toFixed(0)}</span>
              <span className="text-lg text-muted-foreground">out of {r.rules.max}</span>
              {tier ? <span className="rounded-full tint-emerald px-3 py-1 text-sm font-semibold">{tier}</span> : null}
            </p>
            {r.ahead_of_pct !== null && r.verified_suppliers > 1 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                You are at or ahead of {r.ahead_of_pct}% of the other {r.verified_suppliers - 1} verified suppliers. Nobody is named.
              </p>
            ) : null}
            {r.is_new ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <Sprout className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  You are new, so your response and delivery start on the neutral middle. That is a fair start, not a penalty. Real RFQs
                  and orders move you up.
                </span>
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm">
            <span className="font-semibold">You are not ranked yet.</span> Suppliers without a valid proof are listed after every
            verified supplier. Get your registration verified and you join the ranking straight away.{" "}
            <Link to="/supplier/verification" className="font-semibold text-primary underline-offset-2 hover:underline">
              Open your Trust Passport
            </Link>
          </p>
        )}
      </section>

      {r.ranked ? (
        <section className="mt-5 grid gap-3">
          <Meter
            label="Trust"
            icon={Scale}
            points={r.trust.points}
            max={r.trust.max}
            note={`Level ${r.level} of 3 today. Expired proofs count for nothing, so renew before they lapse.`}
          />
          <Meter
            label="Response"
            icon={Zap}
            points={rp.points}
            max={rp.max}
            note={
              rp.rfqs_counted === 0
                ? "No RFQs closed in the last 180 days yet."
                : `${rp.answered} of ${rp.rfqs_counted} RFQs answered${rp.quoted > 0 ? `, typical quote in ${hoursText(rp.median_hours)}` : ""}.`
            }
          />
          <Meter
            label="Delivery"
            icon={Truck}
            points={dl.points}
            max={dl.max}
            note={
              dl.orders_counted === 0
                ? "No orders finished in the last 180 days yet. Buyers record deliveries."
                : `${dl.on_time} of ${dl.orders_counted} orders on time.`
            }
          />
        </section>
      ) : null}

      {tips.length > 0 ? (
        <section className={`${card} mt-5`}>
          <h2 className="text-lg font-semibold">What would raise your rank</h2>
          <p className="mt-1 text-sm text-muted-foreground">Everything here is in your hands. None of it costs money.</p>
          <ul className="mt-4 space-y-3">
            {tips.map((t, i) => (
              <li key={t.id} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full tint-emerald text-xs font-semibold">{i + 1}</span>
                <div>
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="text-sm text-muted-foreground">{t.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`${card} mt-5`}>
        <h2 className="text-lg font-semibold">Our promise to you</h2>
        <ul className="mt-3 space-y-2">
          {FAIR_PROMISES.map((p) => (
            <li key={p.title} className="text-sm">
              <span className="font-semibold">{p.title}.</span> <span className="text-muted-foreground">{p.body}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm">
          <Link to="/fair-ranking" className="font-semibold text-primary underline-offset-2 hover:underline">
            See the exact formula
          </Link>
        </p>
      </section>
    </>
  );
}
