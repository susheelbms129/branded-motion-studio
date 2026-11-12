import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/vendora/kit";
import { formatRelative } from "@/lib/format";
import { appPath } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useWs } from "@/lib/ws-store";

export function NotificationsPage() {
  const ws = useWs();
  const nav = useNavigate();
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
    </>
  );
}
