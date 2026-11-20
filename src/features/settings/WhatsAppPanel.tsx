import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Panel } from "@/components/vendora/kit";
import { formatRelative } from "@/lib/format";
import {
  confirmMessage,
  confirmWhatsAppVerification,
  getWhatsAppSettings,
  hourLabel,
  normalizePhone,
  quietLabel,
  recentLabel,
  sendWhatsAppTest,
  setWhatsAppPrefs,
  startWhatsAppVerification,
  stopWhatsApp,
  WHATSAPP_KEY,
  type WaSettings,
} from "@/lib/whatsapp";
import { whatsappLive } from "@/lib/whatsapp.functions";
import { cn } from "@/lib/utils";

const COPY = {
  buyer: {
    pitch:
      "Get a WhatsApp when quotes arrive, with the lowest price and how it compares to the average of your quotes. Order updates too.",
    rfq: "Quotes on your RFQs",
    rfqHint: "One message per RFQ, even if several quotes come in together.",
  },
  supplier: {
    pitch: "Be the first to know when a buyer asks you for a quote, and when an order arrives. Quick quotes win.",
    rfq: "New quote requests",
    rfqHint: "When a buyer invites you to quote.",
  },
} as const;

const TONE = { good: "text-emerald-700", wait: "text-amber-700", bad: "text-destructive", muted: "text-muted-foreground" } as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** The person's own WhatsApp alert settings. Their number is checked with a code sent to it before anything is ever sent. */
export function WhatsAppPanel({ side }: { side: "buyer" | "supplier" }) {
  const qc = useQueryClient();
  const copy = COPY[side];
  const live = useQuery({ queryKey: [WHATSAPP_KEY, "live"], queryFn: () => whatsappLive(), staleTime: 5 * 60_000 });
  const settings = useQuery({ queryKey: [WHATSAPP_KEY, "settings"], queryFn: getWhatsAppSettings, enabled: live.data?.live === true });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const put = (s: WaSettings) => qc.setQueryData([WHATSAPP_KEY, "settings"], s);
  const refresh = () => qc.invalidateQueries({ queryKey: [WHATSAPP_KEY, "settings"] });
  const fail = (e: unknown) => setNote({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });

  const start = useMutation({
    mutationFn: (p: string) => startWhatsAppVerification(p),
    onSuccess: (r) => {
      setNote(r.status === "verified" ? { tone: "ok", text: "This number is already connected." } : { tone: "ok", text: `We sent a 6 digit code to ${r.phone} on WhatsApp.` });
      setEditing(false);
      setCode("");
      void refresh();
    },
    onError: fail,
  });
  const confirm = useMutation({
    mutationFn: (c: string) => confirmWhatsAppVerification(c),
    onSuccess: (r) => {
      if (r.ok) {
        setNote({ tone: "ok", text: "WhatsApp is connected." });
        setCode("");
      } else setNote({ tone: "error", text: confirmMessage(r) });
      void refresh();
    },
    onError: fail,
  });
  const prefs = useMutation({
    mutationFn: setWhatsAppPrefs,
    onSuccess: (s) => {
      setNote(null);
      put(s);
    },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: sendWhatsAppTest,
    onSuccess: () => {
      setNote({ tone: "ok", text: "A test message is on its way. It can take a minute." });
      void refresh();
    },
    onError: fail,
  });
  const stop = useMutation({
    mutationFn: stopWhatsApp,
    onSuccess: () => {
      setNote({ tone: "ok", text: "WhatsApp alerts are off and your number is removed." });
      setPhone("");
      setCode("");
      void refresh();
    },
    onError: fail,
  });

  const header = (
    <span className="inline-flex items-center gap-2">
      <MessageCircle className="size-4 text-emerald-600" aria-hidden /> WhatsApp alerts
    </span>
  );

  if (live.isLoading) return null;
  if (!live.data?.live) {
    return (
      <Panel title="WhatsApp alerts" description="Coming soon.">
        <p className="text-sm text-muted-foreground">
          Quote and order alerts on WhatsApp are on their way. Until then, your email alerts keep working.
        </p>
      </Panel>
    );
  }

  const s = settings.data;
  const busy = start.isPending || confirm.isPending || prefs.isPending || test.isPending || stop.isPending;
  const askNumber = !s || s.status === "none" || editing;

  return (
    <Panel title="WhatsApp alerts" description="Free for you. Only you, on your own number." action={header}>
      {settings.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : settings.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {settings.error instanceof Error ? settings.error.message : "We couldn't load your WhatsApp settings."}
        </p>
      ) : askNumber ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = normalizePhone(phone);
            if (!n) return setNote({ tone: "error", text: "That doesn't look like a mobile number. Use your WhatsApp number, for example 98765 43210." });
            setNote(null);
            start.mutate(n);
          }}
        >
          <p className="text-sm text-muted-foreground">{copy.pitch}</p>
          <label className="block text-sm font-medium" htmlFor="wa-phone">Your WhatsApp number</label>
          <div className="flex flex-wrap gap-2">
            <Input id="wa-phone" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-60" />
            <Button type="submit" disabled={busy || phone.trim().length < 8}>Send me a code</Button>
            {editing ? (
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            We send a code to this number first, so nobody can sign up someone else. Indian numbers need no +91. Reply STOP in WhatsApp any time to pause.
          </p>
        </form>
      ) : s.status === "pending" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setNote(null);
            confirm.mutate(code);
          }}
        >
          <p className="text-sm">
            {s.code_pending ? `Enter the 6 digit code we sent to ${s.phone} on WhatsApp.` : `The code for ${s.phone} has expired. Send a new one.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="6 digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} className="max-w-40 tracking-widest" />
            <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6 || !s.code_pending}>Confirm</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(true)}>Use another number</Button>
          </div>
          <p className="text-xs text-muted-foreground">It can take a minute to arrive. You can ask for a new code up to 3 times an hour.</p>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Connected: {s.phone}</span>
            {s.paused ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Paused</span> : null}
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => setEditing(true)}>Change number</button>
          </div>

          <ul className="divide-y">
            <Row label={copy.rfq} hint={copy.rfqHint} checked={!!s.want_rfq} disabled={busy} onChange={(v) => prefs.mutate({ want_rfq: v })} />
            <Row label="Orders" hint="When an order is issued, confirmed or declined." checked={!!s.want_po} disabled={busy} onChange={(v) => prefs.mutate({ want_po: v })} />
            <Row label="Pause everything" hint="Stops all WhatsApp alerts until you switch it off. Replying STOP in WhatsApp does the same." checked={!!s.paused} disabled={busy} onChange={(v) => prefs.mutate({ paused: v })} />
          </ul>

          <div>
            <div className="text-sm font-medium">Quiet hours</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <label className="sr-only" htmlFor="wa-qs">Quiet hours start</label>
              <select id="wa-qs" className="rounded-md border bg-background px-2 py-1.5" value={s.quiet_start ?? 21} disabled={busy} onChange={(e) => prefs.mutate({ quiet_start: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              <span>to</span>
              <label className="sr-only" htmlFor="wa-qe">Quiet hours end</label>
              <select id="wa-qe" className="rounded-md border bg-background px-2 py-1.5" value={s.quiet_end ?? 8} disabled={busy} onChange={(e) => prefs.mutate({ quiet_end: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {quietLabel(s.quiet_start ?? 21, s.quiet_end ?? 8)}. Alerts that arrive then wait and come in the morning.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !!s.paused} onClick={() => test.mutate()}>Send me a test</Button>
            <Button variant="outline" disabled={busy} onClick={() => stop.mutate()}>Turn off WhatsApp</Button>
          </div>

          <div>
            <div className="text-sm font-medium">Recent messages</div>
            {s.recent.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nothing sent yet.</p>
            ) : (
              <ul className="mt-1 divide-y">
                {s.recent.map((r, i) => {
                  const l = recentLabel(r);
                  return (
                    <li key={`${r.created_at}${i}`} className="flex items-center gap-3 py-2 text-sm">
                      <div className="min-w-0 flex-1 truncate">{r.title}{r.merged > 1 ? ` (+${r.merged - 1} more)` : ""}</div>
                      <span className={cn("text-xs", TONE[l.tone])}>{l.text}</span>
                      <span className="text-xs text-subtle-foreground">{formatRelative(r.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      {note ? (
        <p role={note.tone === "error" ? "alert" : "status"} className={cn("mt-3 text-sm", note.tone === "error" ? "text-destructive" : "text-emerald-700")}>
          {note.text}
        </p>
      ) : null}
    </Panel>
  );
}

function Row({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <li className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </li>
  );
}
