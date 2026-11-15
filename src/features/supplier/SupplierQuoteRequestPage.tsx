import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  Check,
  Eye,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Field, fieldClass } from "@/components/onboarding/fields";
import { SupplierShell, useSupplier } from "@/components/supplier/SupplierShell";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getFairRankRules, type FairRankRules } from "@/lib/fair-rank-api";
import { formatDate, formatDateTime, formatMoney, type CurrencyCode } from "@/lib/format";
import {
  addDays,
  deadline,
  liveTotals,
  placeLine,
  sourceLabel,
  startForm,
  toDefaults,
  toInput,
  validateQuote,
  ymd,
  type FormStart,
  type QuoteForm,
} from "@/lib/quote-form";
import {
  MAX_DECLINE_REASON,
  MAX_QUOTE_NOTE,
  declineQuoteRequest,
  getQuoteRequest,
  quoteError,
  saveQuoteDefaults,
  submitQuotation,
  type QuoteRequestDetail,
} from "@/lib/quote-requests-api";
import { speedMessage, speedStatus } from "@/lib/quote-speed";
import { LEVEL_NAMES } from "@/lib/rfqs-api";
import { QUOTES_CHANGED } from "@/lib/supplier-nav";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card shadow-card";
const ctaBtn =
  "btn-shine inline-flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";
const ghostBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-60";
const DEADLINE_TINT = {
  none: "tint-slate",
  ok: "tint-emerald",
  soon: "tint-amber",
  late: "tint-red",
} as const;

type FieldProps = Parameters<typeof Field>[0];
/** Field takes an optional error string; this lets a possibly-undefined error be passed straight through. */
function Fld({ error, ...rest }: Omit<FieldProps, "error"> & { error?: string | undefined }) {
  return <Field {...rest} {...(error ? { error } : {})} />;
}

export function SupplierQuoteRequestPage({ rfqId }: { rfqId: string }) {
  return (
    <SupplierShell>
      <DetailContent rfqId={rfqId} />
    </SupplierShell>
  );
}

const asCurrency = (c: string) =>
  (["INR", "USD", "EUR", "AED"].includes(c) ? c : "INR") as CurrencyCode;

function DetailContent({ rfqId }: { rfqId: string }) {
  const { summary, status: shell } = useSupplier();
  const orgId = summary?.id ?? null;
  const [d, setD] = useState<QuoteRequestDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setD(await getQuoteRequest(orgId, rfqId));
      setStatus("ready");
    } catch (e) {
      setError(quoteError(e));
      setStatus("error");
    }
  }, [orgId, rfqId]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = (
    <Link
      to="/supplier/quote-requests"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden /> All quote requests
    </Link>
  );

  if (shell === "error" || status === "error") {
    return (
      <div className="space-y-4">
        {back}
        <div className={cn(card, "p-8 text-center")}>
          <AlertCircle className="mx-auto size-8 text-amber" aria-hidden />
          <h1 className="mt-3 text-xl font-semibold">We couldn't open this request</h1>
          <p className="mt-1 text-sm text-muted-foreground">{error || "Please try again."}</p>
          <button
            onClick={() => {
              setStatus("loading");
              void load();
            }}
            className={cn(ctaBtn, "mt-5")}
          >
            <RefreshCw className="size-4" aria-hidden /> Try again
          </button>
        </div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="space-y-4" aria-busy>
        {back}
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {back}
      <Body
        key={`${d.rfq.id}:${d.quote?.revision ?? 0}:${d.invite.state}`}
        d={d}
        orgId={orgId!}
        onChanged={load}
      />
    </div>
  );
}

function Body({
  d,
  orgId,
  onChanged,
}: {
  d: QuoteRequestDetail;
  orgId: string;
  onChanged: () => Promise<void>;
}) {
  const cur = asCurrency(d.rfq.currency);
  const money = (n: number) => formatMoney(n, { currency: cur, decimals: 2 });
  const dl = deadline(d.rfq.due_date);
  const place = placeLine(d.buyer.city, d.buyer.state);
  const quoted = d.invite.state === "quoted" || d.quote !== null;
  const [revising, setRevising] = useState(false);
  const [declining, setDeclining] = useState(false);
  // The Fair Rank speed bands, only to show how fast the supplier is replying. If they can't load, the page works without.
  const [rules, setRules] = useState<FairRankRules | null>(null);
  useEffect(() => {
    let live = true;
    getFairRankRules()
      .then((r) => live && setRules(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Editable when the RFQ is open and the person may answer, and (if already quoted) they chose to revise.
  const canEdit = d.rfq.open && d.can_respond && (!quoted || revising);

  return (
    <>
      <header className="relative overflow-hidden rounded-3xl bg-gradient-navy p-6 text-white shadow-card sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-80 glow-violet opacity-50"
          aria-hidden
        />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
            {d.rfq.number}
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{d.rfq.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
            <span className="font-medium">{d.buyer.name}</span>
            {place ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4" aria-hidden /> {place}
              </span>
            ) : null}
            {d.rfq.category ? <span>{d.rfq.category}</span> : null}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold",
                DEADLINE_TINT[dl.tone],
              )}
            >
              <CalendarClock className="size-3.5" aria-hidden /> {dl.label}
              {d.rfq.due_date ? ` · ${formatDate(d.rfq.due_date)}` : ""}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-medium">
              <Users className="size-3.5" aria-hidden /> {d.rfq.invited}{" "}
              {d.rfq.invited === 1 ? "supplier" : "suppliers"} invited
            </span>
            {d.invite.level_at_send !== null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-medium">
                <ShieldCheck className="size-3.5" aria-hidden /> Invited as{" "}
                {LEVEL_NAMES[d.invite.level_at_send] ?? "verified"}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {d.rfq.notes ? (
        <section className={cn(card, "p-5")}>
          <h2 className="text-sm font-semibold">Note from the buyer</h2>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">{d.rfq.notes}</p>
        </section>
      ) : null}

      {!d.rfq.open && !quoted ? (
        <Banner tone="slate" title="This request is closed">
          The deadline has passed or the buyer has closed it, so it can't be quoted any more.
        </Banner>
      ) : null}
      {d.rfq.open && !d.can_respond ? (
        <Banner tone="slate" title="You can look, but not answer">
          Only the owner or a procurement manager of your company can send or decline quotes.
        </Banner>
      ) : null}
      {d.invite.state === "declined" ? (
        <Banner tone="slate" title="You declined this request">
          {d.invite.decline_reason ? `Your reason: ${d.invite.decline_reason}. ` : ""}
          {d.rfq.open && d.can_respond
            ? "Changed your mind? You can still send a quote below."
            : ""}
        </Banner>
      ) : null}

      {quoted && d.quote && !revising ? (
        <SentQuote
          d={d}
          rules={rules}
          money={money}
          canRevise={d.rfq.open && d.can_respond}
          onRevise={() => setRevising(true)}
        />
      ) : null}

      {!quoted || revising ? (
        <QuoteEditor
          d={d}
          rules={rules}
          orgId={orgId}
          cur={cur}
          editable={canEdit}
          onSent={async () => {
            setRevising(false);
            await onChanged();
          }}
          onDecline={() => setDeclining(true)}
        />
      ) : null}

      {quoted && revising ? (
        <button
          onClick={() => setRevising(false)}
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel revision
        </button>
      ) : null}

      <DeclineDialog
        open={declining}
        onClose={() => setDeclining(false)}
        orgId={orgId}
        rfqId={d.rfq.id}
        buyer={d.buyer.name}
        onDone={onChanged}
      />
    </>
  );
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: "slate" | "green";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn("rounded-2xl p-4 text-sm", tone === "green" ? "tint-green" : "tint-slate")}
      role="status"
    >
      <p className="font-semibold">{title}</p>
      {children ? <p className="mt-0.5 opacity-90">{children}</p> : null}
    </div>
  );
}

function SentQuote({
  d,
  rules,
  money,
  canRevise,
  onRevise,
}: {
  d: QuoteRequestDetail;
  rules: FairRankRules | null;
  money: (n: number) => string;
  canRevise: boolean;
  onRevise: () => void;
}) {
  const q = d.quote!;
  const a = q.amounts;
  const price = new Map(q.lines.map((l) => [l.item_id, l.unit_price]));
  const speed = rules && d.invite.responded_at ? speedStatus(d.invite.sent_at, d.invite.responded_at, new Date(), rules) : null;
  return (
    <section className={cn(card, "p-6")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Check className="size-5 text-emerald" aria-hidden /> Your quote is with the buyer
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sent {formatDateTime(q.received_at)}
            {q.revision > 1 ? ` · revision ${q.revision}` : ""}. Valid until{" "}
            {formatDate(q.valid_until)}.
          </p>
        </div>
        {canRevise ? (
          <button onClick={onRevise} className={ghostBtn}>
            Revise quote
          </button>
        ) : null}
      </div>
      {speed ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg tint-emerald px-3 py-1.5 text-xs font-semibold">
          <Zap className="size-3.5" aria-hidden /> {speedMessage(speed)}
        </p>
      ) : null}
      <ul className="mt-4 divide-y divide-border text-sm">
        {d.items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="min-w-0 font-medium">{it.description}</span>
            <span className="text-muted-foreground">
              {it.qty} {it.unit} × {money(price.get(it.id) ?? 0)}
            </span>
          </li>
        ))}
      </ul>
      {a ? (
        <dl className="mt-4 grid gap-1.5 text-sm sm:max-w-sm">
          <Row k="Subtotal" v={money(a.subtotal)} />
          <Row k={`GST (${q.gst_rate}%)`} v={money(a.gst)} />
          <Row k="Freight" v={money(a.shipping)} />
          <Row k="Other charges" v={money(a.other_charges)} />
          <Row k="Landed total" v={money(a.total)} strong />
        </dl>
      ) : null}
      <p className="mt-4 text-sm text-muted-foreground">
        Delivery in {q.delivery_days} {q.delivery_days === 1 ? "day" : "days"} · Payment within{" "}
        {q.payment_terms_days} days
      </p>
      {q.notes ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">Note: {q.notes}</p>
      ) : null}
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6",
        strong && "border-t border-border pt-2 text-base font-semibold",
      )}
    >
      <dt className={strong ? "" : "text-muted-foreground"}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function QuoteEditor({
  d,
  rules,
  orgId,
  cur,
  editable,
  onSent,
  onDecline,
}: {
  d: QuoteRequestDetail;
  rules: FairRankRules | null;
  orgId: string;
  cur: CurrencyCode;
  editable: boolean;
  onSent: () => Promise<void>;
  onDecline: () => void;
}) {
  const start: FormStart = useMemo(() => startForm(d), [d]);
  const [f, setF] = useState<QuoteForm>(start.form);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const money = (n: number) => formatMoney(n, { currency: cur, decimals: 2 });
  const today = useMemo(() => new Date(), []);

  const errors = useMemo(() => validateQuote(f, d.items, today), [f, d.items, today]);
  const totals = useMemo(() => liveTotals(f, d.items), [f, d.items]);
  const shown = (k: string) => (touched ? errors[k] : undefined);
  const set = (patch: Partial<QuoteForm>) => setF((x) => ({ ...x, ...patch }));
  const setPrice = (id: string, v: string) =>
    setF((x) => ({ ...x, prices: { ...x.prices, [id]: v } }));
  const revising = d.quote !== null;
  const filledFromList = d.items.filter(
    (i) => start.prefilled.includes(i.id) && f.prices[i.id] === String(i.suggestion?.price),
  ).length;

  const speed = rules && !revising && editable ? speedStatus(d.invite.sent_at, null, today, rules) : null;
  const termKeys = ["gstRate", "shipping", "otherCharges", "deliveryDays", "paymentTermsDays", "validUntil", "notes"];
  const termsKey = JSON.stringify([f.gstRate, f.shipping, f.otherCharges, f.deliveryDays, f.paymentTermsDays, f.validUntil, f.notes.trim()]);

  async function saveTerms() {
    setTouched(true);
    setFormError("");
    if (termKeys.some((k) => errors[k])) {
      setFormError("Please fix the highlighted terms first.");
      return;
    }
    setBusy(true);
    try {
      await saveQuoteDefaults(orgId, toDefaults(f, today));
      setSavedKey(termsKey);
      toast.success("Saved. Every new quote will start from these terms.");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : quoteError(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setTouched(true);
    setFormError("");
    if (Object.keys(errors).length > 0) {
      setFormError("Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      await submitQuotation(orgId, d.rfq.id, toInput(f, d.items));
      window.dispatchEvent(new Event(QUOTES_CHANGED));
      toast.success(
        revising
          ? "Quote updated. The buyer has been notified."
          : "Quote sent. The buyer has been notified.",
      );
      await onSent();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : quoteError(e));
    } finally {
      setBusy(false);
    }
  }

  const minDate = ymd(today);
  const maxDate = ymd(addDays(today, 365));
  const dis = !editable || busy;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        {editable && !revising ? (
          <section
            aria-label="Quote in 60 seconds"
            className={cn(card, "p-5 sm:p-6", start.oneTap && "border-emerald-500/40 bg-emerald-500/5")}
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Zap className="size-4" aria-hidden /> Quote in 60 seconds
            </p>
            {start.oneTap && Object.keys(errors).length === 0 ? (
              <>
                <h2 className="mt-1 text-xl font-semibold">Ready in one tap</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every item is priced from your own product list and earlier quotes{start.usedDefaults ? ", and your usual terms are applied" : ""}. Landed total{" "}
                  <span className="font-semibold text-foreground">{money(totals.total)}</span> with GST. Check it, then send.
                </p>
                <button type="button" onClick={() => void send()} disabled={dis} className={cn(ctaBtn, "mt-4 w-full sm:w-auto")}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Zap className="size-4" aria-hidden />}
                  Send quote · {money(totals.total)}
                </button>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {filledFromList > 0
                  ? `${filledFromList} of ${d.items.length} ${d.items.length === 1 ? "item is" : "items are"} already priced for you. Check them, add the rest and send.`
                  : "Price each item and send. Every quote you send teaches Vendora your prices, so the next one is already filled in."}
              </p>
            )}
            {speed ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 text-xs font-medium">
                <Sparkles className="size-3.5" aria-hidden /> {speedMessage(speed)}
              </p>
            ) : null}
          </section>
        ) : null}
        <section className={cn(card, "p-5 sm:p-6")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {editable ? "Price each item" : "What the buyer wants"}
            </h2>
            {editable && filledFromList > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full tint-violet px-2.5 py-1 text-xs font-semibold">
                <Sparkles className="size-3.5" aria-hidden /> {filledFromList} of {d.items.length}{" "}
                priced from your own data
              </span>
            ) : null}
          </div>
          <ul className="mt-4 divide-y divide-border">
            {d.items.map((it) => {
              const err = shown(`price:${it.id}`);
              const fromList =
                start.prefilled.includes(it.id) && f.prices[it.id] === String(it.suggestion?.price);
              const mismatch = start.unitMismatch.includes(it.id);
              const p = Number(f.prices[it.id]?.replace(/,/g, ""));
              const line = Number.isFinite(p) && p > 0 ? p * it.qty : null;
              return (
                <li key={it.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div className="min-w-0">
                    <p className="font-medium">{it.description}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {it.qty} {it.unit}
                    </p>
                    {fromList ? (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet">
                        <Sparkles className="size-3.5" aria-hidden />{" "}
                        {it.suggestion ? sourceLabel(it.suggestion, today) : ""}
                        {it.suggestion?.availability === "Temporarily unavailable"
                          ? " (marked unavailable)"
                          : ""}
                      </p>
                    ) : null}
                    {start.possible.includes(it.id) && it.suggestion && !(f.prices[it.id] ?? "").trim() ? (
                      <button
                        type="button"
                        disabled={dis}
                        onClick={() => setPrice(it.id, String(it.suggestion!.price))}
                        className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1 text-left text-xs font-medium hover:bg-muted"
                      >
                        <Sparkles className="size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0">
                          Use {money(it.suggestion.price)}? Looks like “{it.suggestion.name}”{" "}
                          ({it.suggestion.source === "past_quote" ? sourceLabel(it.suggestion, today).toLowerCase() : "from your product list"}). Check the size first.
                        </span>
                      </button>
                    ) : null}
                    {mismatch && it.suggestion ? (
                      <p className="mt-1 text-xs text-amber">
                        Your list price for “{it.suggestion.name}” is per {it.suggestion.unit}, but
                        the buyer needs {it.unit}. Enter the price per {it.unit}.
                      </p>
                    ) : null}
                    {it.suggestion?.moq && it.suggestion.moq > it.qty ? (
                      <p className="mt-1 text-xs text-amber">
                        Your minimum order for this product is {it.suggestion.moq}; the buyer wants{" "}
                        {it.qty}.
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:w-44">
                    <label className="sr-only" htmlFor={`price-${it.id}`}>
                      Price per {it.unit} for {it.description}
                    </label>
                    <input
                      id={`price-${it.id}`}
                      inputMode="decimal"
                      disabled={dis}
                      value={f.prices[it.id] ?? ""}
                      onChange={(e) => setPrice(it.id, e.target.value)}
                      placeholder={`Price per ${it.unit || "unit"}`}
                      aria-invalid={err ? true : undefined}
                      className={cn(fieldClass, "tabular-nums", err && "border-destructive")}
                    />
                    {err ? (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {err}
                      </p>
                    ) : line !== null ? (
                      <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
                        = {money(line)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={cn(card, "p-5 sm:p-6")}>
          <h2 className="text-lg font-semibold">Terms</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Fld label="GST (%)" required error={shown("gstRate")}>
              <input
                inputMode="decimal"
                disabled={dis}
                value={f.gstRate}
                onChange={(e) => set({ gstRate: e.target.value })}
                className={fieldClass}
              />
            </Fld>
            <Fld
              label="Freight / delivery charge"
              required
              error={shown("shipping")}
              hint="Enter 0 if delivery is included."
            >
              <input
                inputMode="decimal"
                disabled={dis}
                value={f.shipping}
                onChange={(e) => set({ shipping: e.target.value })}
                className={fieldClass}
              />
            </Fld>
            <Fld
              label="Other charges"
              required
              error={shown("otherCharges")}
              hint="Packing, loading, insurance. 0 if none."
            >
              <input
                inputMode="decimal"
                disabled={dis}
                value={f.otherCharges}
                onChange={(e) => set({ otherCharges: e.target.value })}
                className={fieldClass}
              />
            </Fld>
            <Fld
              label="Delivery time (days)"
              required
              error={shown("deliveryDays")}
              hint="From the order being confirmed."
            >
              <input
                inputMode="numeric"
                disabled={dis}
                value={f.deliveryDays}
                onChange={(e) => set({ deliveryDays: e.target.value })}
                className={fieldClass}
              />
            </Fld>
            <Fld
              label="Payment terms (days)"
              required
              error={shown("paymentTermsDays")}
              hint="Days the buyer has to pay after delivery."
            >
              <input
                inputMode="numeric"
                disabled={dis}
                value={f.paymentTermsDays}
                onChange={(e) => set({ paymentTermsDays: e.target.value })}
                className={fieldClass}
              />
            </Fld>
            <Fld label="Quote valid until" required error={shown("validUntil")}>
              <input
                type="date"
                min={minDate}
                max={maxDate}
                disabled={dis}
                value={f.validUntil}
                onChange={(e) => set({ validUntil: e.target.value })}
                className={fieldClass}
              />
            </Fld>
          </div>
          <div className="mt-4">
            <Fld
              label="Note to the buyer"
              error={shown("notes")}
              hint={`${f.notes.trim().length}/${MAX_QUOTE_NOTE}`}
            >
              <textarea
                rows={3}
                disabled={dis}
                value={f.notes}
                onChange={(e) => set({ notes: e.target.value })}
                className={fieldClass}
                placeholder="Brand, grade, packaging, anything the buyer should know."
              />
            </Fld>
          </div>
          {!revising && (d.defaults || d.last_terms) ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {d.defaults
                ? "Your saved usual terms are applied. Change anything that differs."
                : "Terms started from your last quote. Change anything that differs."}
            </p>
          ) : null}
          {editable && d.can_respond ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void saveTerms()}
                disabled={busy || savedKey === termsKey}
                className={ghostBtn}
              >
                {savedKey === termsKey ? <Check className="size-4" aria-hidden /> : <Zap className="size-4" aria-hidden />}
                {savedKey === termsKey ? "Saved as your usual terms" : "Save these as my usual terms"}
              </button>
              <p className="mt-1 text-xs text-muted-foreground">
                Next time, GST, freight, delivery, payment terms, validity and your note start filled in.
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <aside className="space-y-6 lg:col-span-2">
        <section className={cn(card, "p-5 sm:p-6 lg:sticky lg:top-24")}>
          <h2 className="text-lg font-semibold">What the buyer will compare</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Buyers rank quotes on the true landed cost: price, GST and freight together.
          </p>
          <dl className="mt-4 grid gap-1.5 text-sm">
            <Row k="Subtotal" v={money(totals.subtotal)} />
            <Row k={`GST (${parseFloat(f.gstRate) || 0}%)`} v={money(totals.gst)} />
            <Row k="Freight" v={money(totals.shipping)} />
            <Row k="Other charges" v={money(totals.otherCharges)} />
            <Row k="Landed total" v={money(totals.total)} strong />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {totals.priced} of {d.items.length} items priced
          </p>
          {formError ? (
            <p role="alert" className="mt-3 rounded-md tint-red px-3 py-2 text-sm">
              {formError}
            </p>
          ) : null}
          {editable ? (
            <div className="mt-4 grid gap-2">
              <button onClick={() => void send()} disabled={busy} className={ctaBtn}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {busy ? "Sending" : revising ? "Send revised quote" : "Send quote"}
              </button>
              {!revising ? (
                <button onClick={onDecline} disabled={busy} className={ghostBtn}>
                  Decline this request
                </button>
              ) : null}
            </div>
          ) : null}
          <ul className="mt-5 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald" aria-hidden /> Free to
              answer. No lead fees, ever.
            </li>
            <li className="flex gap-2">
              <Eye className="mt-0.5 size-4 shrink-0 text-blue" aria-hidden /> Other suppliers can't
              see your price, and you can't see theirs.
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

function DeclineDialog({
  open,
  onClose,
  orgId,
  rfqId,
  buyer,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  rfqId: string;
  buyer: string;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tooLong = reason.trim().length > MAX_DECLINE_REASON;

  async function confirm() {
    if (tooLong) return;
    setBusy(true);
    setError("");
    try {
      await declineQuoteRequest(orgId, rfqId, reason);
      window.dispatchEvent(new Event(QUOTES_CHANGED));
      toast.success("Declined. The buyer has been told.");
      onClose();
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : quoteError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Decline this request?</AlertDialogTitle>
          <AlertDialogDescription>
            {buyer} will be told you can't quote. A short reason helps them invite the right
            suppliers next time. You can still send a quote later if the request is open.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Fld
          label="Reason"
          hint={`${reason.trim().length}/${MAX_DECLINE_REASON}`}
          {...(tooLong ? { error: `Up to ${MAX_DECLINE_REASON} characters` } : {})}
        >
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={fieldClass}
            placeholder="For example: we don't stock this grade."
          />
        </Fld>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep request</AlertDialogCancel>
          <button onClick={() => void confirm()} disabled={busy || tooLong} className={ctaBtn}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Decline
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
