import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader, Panel } from "@/components/vendora/kit";
import { formatRelative } from "@/lib/format";
import { MAIL_CATEGORIES, useMailLog, useMailPrefs, type MailCategory } from "@/lib/mail";
import { appPath } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useWs } from "@/lib/ws-store";

export function NotificationsPage() {
  const ws = useWs();
  const nav = useNavigate();
  const { prefs, set } = useMailPrefs();
  const log = useMailLog();
  return (
    <>
      <PageHeader
        title="Notifications"
        accent="coral"
        crumbs={[{ label: "Notifications" }]}
        description="Approvals, quotes, deliveries and team updates."
        actions={
          <Button
            variant="outline"
            onClick={() => ws.markRead()}
            disabled={!ws.notifications.some((n) => !n.read)}
          >
            <CheckCheck />
            Mark all read
          </Button>
        }
      />
      {ws.notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          accent="coral"
          title="You're all caught up"
          body="Notifications appear here when something needs your attention."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-card">
          {ws.notifications.map((n) => (
            <li key={n.id}>
              <button
                className={cn(
                  "flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-accent/50",
                  !n.read && "bg-primary/5",
                )}
                onClick={() => {
                  ws.markRead(n.id);
                  if (n.link) void nav({ to: appPath(n.link.to) as never });
                }}
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.read ? "bg-transparent" : "bg-primary",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="text-sm text-muted-foreground">{n.body}</div>
                  <div className="mt-1 text-xs text-subtle-foreground">
                    {formatRelative(n.at)}
                    {n.link ? ` · ${n.link.label}` : ""}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Email notifications"
          description="Invitations and account-security emails are always sent."
        >
          <ul className="divide-y">
            {(Object.keys(MAIL_CATEGORIES) as MailCategory[]).map((k) => (
              <li key={k} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{MAIL_CATEGORIES[k].label}</div>
                  <div className="text-xs text-muted-foreground">{MAIL_CATEGORIES[k].hint}</div>
                </div>
                <Switch checked={prefs[k]} onCheckedChange={(v) => set(k, v)} aria-label={MAIL_CATEGORIES[k].label} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Recent email activity" description="Last 40 sends from this browser">
          {log.entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No emails sent yet.</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto">
              {log.entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      e.status === "sent" ? "bg-emerald" : "bg-destructive",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {e.kind.replace(/_/g, " ")} → {e.to}
                    </div>
                    {e.error ? <div className="truncate text-xs text-destructive">{e.error}</div> : null}
                  </div>
                  <span className="text-xs text-subtle-foreground">{formatRelative(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
