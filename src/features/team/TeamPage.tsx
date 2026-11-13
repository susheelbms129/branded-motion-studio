import { Mail, Megaphone, Send, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Can, PageHeader, Panel, Person, StatusBadge, useCan } from "@/components/vendora/kit";
import { formatRelative } from "@/lib/format";
import { deliverAnnouncement, deliverInvite, resolveRecipients } from "@/lib/mail";
import {
  PERMISSION_LABEL,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
} from "@/lib/permissions";
import { nameOf } from "@/lib/selectors";
import { useActor, useWs } from "@/lib/ws-store";
import type { Role } from "@/types/domain";

export function TeamPage() {
  const ws = useWs();
  const actor = useActor();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [annOpen, setAnnOpen] = useState(false);
  const [annSubject, setAnnSubject] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annBusy, setAnnBusy] = useState(false);
  const perms = Object.keys(PERMISSION_LABEL) as Permission[];
  const valid = /^\S+@\S+\.\S+$/.test(email);
  return (
    <>
      <PageHeader
        title="Team & Permissions"
        accent="cyan"
        crumbs={[{ label: "Team & Permissions" }]}
        description="Invite colleagues and control exactly what each role can do."
        actions={
          <Can permission="team.manage">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAnnOpen(true)}>
                <Megaphone />
                Announcement
              </Button>
              <Button onClick={() => setOpen(true)}>
                <UserPlus />
                Invite member
              </Button>
            </div>
          </Can>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title={`Members (${ws.members.length})`}
          className="xl:col-span-2"
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {ws.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Person name={m.name} accent={m.accent} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.email} · {m.department}
                  </div>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  Active {formatRelative(m.lastActiveAt)}
                </span>
                <StatusBadge kind="member" value={m.status} />
                {can("team.manage") && m.id !== actor ? (
                  <>
                    <Select
                      value={m.role}
                      onValueChange={(v) => {
                        ws.setMemberRole(m.id, v as Role);
                        toast.success("Role updated");
                      }}
                    >
                      <SelectTrigger className="h-8 w-48 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        ws.setMemberStatus(m.id, m.status === "suspended" ? "active" : "suspended")
                      }
                    >
                      {m.status === "suspended" ? "Reactivate" : "Suspend"}
                    </Button>
                  </>
                ) : (
                  <span className="tint-slate rounded-full px-2.5 py-1 text-xs">
                    {ROLE_LABEL[m.role]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Pending invitations">
          {ws.invitations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : (
            <ul className="space-y-3">
              {ws.invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 text-sm">
                  <Mail className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {ROLE_LABEL[i.role]} · invited by {nameOf(ws.members, i.invitedById)} ·{" "}
                      {i.status === "expired" ? "expired" : formatRelative(i.sentAt)}
                    </div>
                  </div>
                  <Can permission="team.manage">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deliverInvite(i, Date.now())}
                    >
                      Resend
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => ws.revokeInvite(i.id)}>
                      Revoke
                    </Button>
                  </Can>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel
        title="Role permissions"
        description="What each role can do in Vendora"
        className="mt-4"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y bg-muted/40 text-xs text-muted-foreground">
                <th className="px-5 py-2.5 text-left font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5" />
                    Permission
                  </span>
                </th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-2.5 text-center font-medium">
                    {ROLE_LABEL[r].split(" / ")[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map((p) => (
                <tr key={p} className="border-b last:border-0">
                  <td className="px-5 py-2.5">{PERMISSION_LABEL[p]}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-2.5 text-center">
                      {ROLE_PERMISSIONS[r].includes(p) ? (
                        <span className="text-success">●</span>
                      ) : (
                        <span className="text-border">○</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              They'll get an email with a secure link that expires in 7 days.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="em">Work email</Label>
            <Input
              id="em"
              type="email"
              className="mt-1.5"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.in"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!valid}
              onClick={() => {
                // The email itself is sent by the mail listener; it reports success or failure.
                ws.inviteMember(email, role, { actorId: actor });
                setEmail("");
                setOpen(false);
              }}
            >
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={annOpen} onOpenChange={setAnnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send an announcement</DialogTitle>
            <DialogDescription>
              Emails every active team member individually. It is sent from Vendora's verified
              address with your name, and replies go to you.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="as">Subject</Label>
            <Input
              id="as"
              className="mt-1.5"
              maxLength={120}
              value={annSubject}
              onChange={(e) => setAnnSubject(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ab">Message</Label>
            <Textarea
              id="ab"
              className="mt-1.5 min-h-32"
              maxLength={3000}
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={annBusy || annSubject.trim().length < 3 || annBody.trim().length < 5}
              onClick={async () => {
                const targets = resolveRecipients(
                  ws.members.filter((m) => m.status === "active").map((m) => m.id),
                );
                if (targets.length === 0) {
                  toast.error("No deliverable email addresses. Sign in with your real email first.");
                  return;
                }
                setAnnBusy(true);
                const r = await deliverAnnouncement(targets, annSubject.trim(), annBody.trim());
                setAnnBusy(false);
                if (r.sent > 0 && r.failed === 0) {
                  toast.success(`Announcement sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}`);
                  setAnnSubject("");
                  setAnnBody("");
                  setAnnOpen(false);
                } else toast.error(r.error ?? "Announcement could not be sent");
              }}
            >
              <Send />
              {annBusy ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
