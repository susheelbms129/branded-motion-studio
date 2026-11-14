import { Check, Copy, ExternalLink, Loader2, MessageCircle, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  badgeHtml,
  badgePath,
  getPassportSharing,
  passportError,
  passportPath,
  passportUrl,
  quoteFooter,
  setPassportSharing,
  whatsappUrl,
  type PassportSharing,
} from "@/lib/passport-api";
import { cn } from "@/lib/utils";

const card = "rounded-2xl border border-border bg-card p-6 shadow-card";
const ctaBtn =
  "btn-shine flex items-center justify-center gap-1.5 rounded-md bg-gradient-cta px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100";
const outlineBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-white px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/60 disabled:opacity-60";

/** Lets the supplier's owner publish a shareable Trust Passport link and badge. Off until they switch it on. */
export function SharePassportPanel({ orgId, name, level }: { orgId: string; name: string; level: number }) {
  const [s, setS] = useState<PassportSharing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const load = useCallback(async () => {
    try {
      setS(await getPassportSharing(orgId));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : passportError(e));
    }
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load, level]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError("");
    try {
      await setPassportSharing(orgId, on);
      toast.success(on ? "Your Trust Passport is now public." : "Your Trust Passport page is now private.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : passportError(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it by hand.");
    }
  };

  const copyButton = (k: string, text: string, label: string) => (
    <button type="button" className={outlineBtn} onClick={() => void copy(k, text)}>
      {copied === k ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === k ? "Copied" : label}
    </button>
  );

  return (
    <section className={cn(card, "mt-8")} aria-label="Share your Trust Passport">
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Share2 className="h-4 w-4" /> Share your Trust Passport
      </p>
      <h3 className="mt-1 text-xl font-semibold">Show buyers you are verified, anywhere</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Get a public page and a badge for your website, quotations and WhatsApp. It is read live, so it only ever shows what is valid
        today. It shows the same facts buyers see here. Your contact details, bank and documents are never shown. Sharing is free.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!s && !error ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : null}

      {s && !s.enabled ? (
        <div className="mt-4">
          {s.level < 1 ? (
            <p className="text-sm text-muted-foreground">Get your business registration verified first. Then you can switch sharing on.</p>
          ) : s.can_change ? (
            <button type="button" className={cn(ctaBtn, "w-full sm:w-auto")} disabled={busy} onClick={() => void toggle(true)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Turn on my public Trust Passport
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">Only the owner of your company can switch sharing on.</p>
          )}
        </div>
      ) : null}

      {s && s.enabled ? (
        <div className="mt-4 space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your link</p>
            <p className="mt-1 break-all rounded-lg bg-muted px-3 py-2 text-sm">{passportUrl(origin, s.slug)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {copyButton("link", passportUrl(origin, s.slug), "Copy link")}
              <a className={outlineBtn} href={whatsappUrl(origin, s.slug, name)} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" /> Share on WhatsApp
              </a>
              <a className={outlineBtn} href={passportPath(s.slug)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Open page
              </a>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line for your quotations and emails</p>
            <p className="mt-1 break-all rounded-lg bg-muted px-3 py-2 text-sm">{quoteFooter(origin, s.slug)}</p>
            <div className="mt-2">{copyButton("footer", quoteFooter(origin, s.slug), "Copy line")}</div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your badge</p>
            <img src={badgePath(s.slug)} alt="Vendora Trust Passport badge" height={32} className="mt-2 h-8 w-auto" />
            <p className="mt-2 text-xs text-muted-foreground">Paste this on your website or in your email signature. It updates by itself.</p>
            <p className="mt-1 break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">{badgeHtml(origin, s.slug)}</p>
            <div className="mt-2">{copyButton("html", badgeHtml(origin, s.slug), "Copy badge code")}</div>
          </div>
          {s.can_change ? (
            <button type="button" className="text-sm font-medium text-muted-foreground underline" disabled={busy} onClick={() => void toggle(false)}>
              {busy ? "Saving…" : "Turn off public page"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
