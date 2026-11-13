import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Megaphone, Plus, Send, ShieldCheck, UserPlus, X } from "lucide-react";
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
import { deliverAnnouncement, resolveRecipients } from "@/lib/mail";
import {
  PERMISSION_LABEL,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
} from "@/lib/permissions";
import { nameOf } from "@/lib/selectors";
import {
  inviteMembers,
  listInvitations,
  listMembers,
  revokeInvitation,
  setMemberRole,
  setMemberStatus,
  teamError,
} from "@/lib/team-api";
import { useUi } from "@/lib/ui-store";
import { useActor, useWs } from "@/lib/ws-store";
import type { Accent, Role } from "@/types/domain";

const ACCENTS: Accent[] = ["blue", "cyan", "violet", "magenta", "emerald", "amber", "coral", "pink", "indigo"];
const accentFor = (key: string): Accent => ACCENTS[[...key].reduce((n, c) => n + c.charCodeAt(0), 0) % ACCENTS.length]!;
const EMAIL = /^\S+@\S+\.\S+$/;
// An invitation can never grant Owner (the database refuses it). Promote someone after they have joined.
const INVITE_ROLES: Role[] = ROLES.filter((r) => r !== "owner");

/** One row of the members list, whether it came from the database or from the demo workspace. */
interface Row {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "suspended";
  department: string;
  activity: string;
  accent: Accent;
  isMe: boolean;
}
interface Pending {
  id: string;
  email: string;
  role: Role;
  by: string;
  when: string;
}

export function TeamPage() {
  const ws = useWs();
  const actor = useActor();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [invRows, setInvRows] = useState<{ email: string; role: Role }[]>([{ email: "", role: "employee" }]);
  const [sending, setSending] = useState(false);
  const [annOpen, setAnnOpen] = useState(false);
  const [annSubject, setAnnSubject] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annBusy, setAnnBusy] = useState(false);
  const perms = Object.keys(PERMISSION_LABEL) as Permission[];
  const mails = invRows.map((r) => r.email.trim().toLowerCase());
  const valid = mails.every((m) => EMAIL.test(m)) && new Set(mails).size === mails.length;

  // Signed in to a real company -> everything comes from the database. Otherwise it's the demo workspace.
  const orgId = useUi((s) => s.orgId);
  const myEmail = useUi((s) => s.user?.email?.toLowerCase() ?? "");
  const real = !!orgId;
  const qc = useQueryClient();
  const membersQ = useQuery({ queryKey: ["team", "members", orgId], queryFn: () => listMembers(orgId!), enabled: real });
  const invitesQ = useQuery({ queryKey: ["team", "invites", orgId], queryFn: () => listInvitations(orgId!), enabled: real && can("team.manage") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["team"] });

  const rows: Row[] = real
    ? (membersQ.data ?? []).map((m) => ({
        id: m.userId, name: m.name, email: m.email, role: m.role, status: m.status, department: m.department,
        activity: m.lastSignInAt ? `Active ${formatRelative(m.lastSignInAt)}` : `Joined ${formatRelative(m.joinedAt)}`,
        accent: accentFor(m.userId), isMe: m.email.toLowerCase() === myEmail,
      }))
    : ws.members.map((m) => ({
        id: m.id, name: m.name, email: m.email, role: m.role, status: m.status, department: m.department,
        activity: `Active ${formatRelative(m.lastActiveAt)}`, accent: m.accent, isMe: m.id === actor,
      }));
  const pending: Pending[] = real
    ? (invitesQ.data ?? []).map((i) => ({ id: i.id, email: i.email, role: i.role, by: i.invitedBy, when: i.expired ? "expired" : formatRelative(i.createdAt) }))
    : ws.invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, by: nameOf(ws.members, i.invitedById), when: i.status === "expired" ? "expired" : formatRelative(i.sentAt) }));

  const changeRole = (m: Row, r: Role) => {
    if (!real) { ws.setMemberRole(m.id, r); return void toast.success("Role updated"); }
    setMemberRole(orgId, m.id, r).then(() => toast.success("Role updated")).catch((e) => toast.error(teamError(e))).finally(refresh);
  };
  const toggleAccess = (m: Row) => {
    const next = m.status === "suspended" ? "active" : "suspended";
    if (!real) return ws.setMemberStatus(m.id, next);
    setMemberStatus(orgId, m.id, next).then(() => toast.success(next === "active" ? "Access restored" : "Access suspended")).catch((e) => toast.error(teamError(e))).finally(refresh);
  };
  const revoke = (i: Pending) => {
    if (!real) return ws.revokeInvite(i.id);
    revokeInvitation(i.id).then(() => toast.success("Invitation cancelled")).catch((e) => toast.error(teamError(e))).finally(refresh);
  };
  const send = async (list: { email: string; role: Role }[]) => {
    if (!real) {
      list.forEach((r) => ws.inviteMember(r.email.trim(), r.role, { actorId: actor }));
      toast.info("Demo workspace: invitations are shown here but no email is sent.");
      return true;
    }
    setSending(true);
    const r = await inviteMembers(orgId, list.map((x) => ({ email: x.email.trim().toLowerCase(), role: x.role })));
    setSending(false);
    void refresh();
    if (r.error && r.results.length === 0) { toast.error(r.error); return false; }
    const good = r.results.filter((x) => x.ok).length;
    if (good) toast.success(`${good} invitation${good === 1 ? "" : "s"} sent`);
    r.results.filter((x) => !x.ok).forEach((x) => toast.error(`${x.email}: ${x.error ?? "failed"}`));
    return r.results.every((x) => x.ok);
  };
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
          title={`Members (${rows.length})`}
          className="xl:col-span-2"
          bodyClassName="p-0"
        >
          <ul className="divide-y">
            {rows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Person name={m.name} accent={m.accent} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.email}{m.department ? ` · ${m.department}` : ""}
                  </div>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {m.activity}
                </span>
                <StatusBadge kind="member" value={m.status} />
                {can("team.manage") && !m.isMe ? (
                  <>
                    <Select
                      value={m.role}
                      onValueChange={(v) => changeRole(m, v as Role)}
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
                      onClick={() => toggleAccess(m)}
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
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : (
            <ul className="space-y-3">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-3 text-sm">
                  <Mail className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {ROLE_LABEL[i.role]} · invited by {i.by} · {i.when}
                    </div>
                  </div>
                  <Can permission="team.manage">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={sending}
                      onClick={() => void send([{ email: i.email, role: i.role }])}
                    >
                      Resend
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => revoke(i)}>
                      Cancel
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
              They'll get an email with a secure link that expires in 7 days. To add another owner, invite them first and change their role once they've joined.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {invRows.map((r, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  {idx === 0 ? <Label htmlFor="em0">Work email</Label> : null}
                  <Input
                    id={`em${idx}`}
                    type="email"
                    className="mt-1.5"
                    value={r.email}
                    onChange={(e) => setInvRows(invRows.map((x, j) => (j === idx ? { ...x, email: e.target.value } : x)))}
                    placeholder="name@company.in"
                  />
                </div>
                <div className="w-44 shrink-0">
                  {idx === 0 ? <Label>Role</Label> : null}
                  <Select value={r.role} onValueChange={(v) => setInvRows(invRows.map((x, j) => (j === idx ? { ...x, role: v as Role } : x)))}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INVITE_ROLES.map((x) => (
                        <SelectItem key={x} value={x}>
                          {ROLE_LABEL[x]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {invRows.length > 1 ? (
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => setInvRows(invRows.filter((_, j) => j !== idx))}>
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}
            {invRows.length < 10 ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setInvRows([...invRows, { email: "", role: "employee" }])}>
                <Plus />
                Add another person
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Each person gets their own link, tied to their email and the role you pick. They can't change it.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!valid || sending}
              onClick={async () => {
                if (await send(invRows)) {
                  setInvRows([{ email: "", role: "employee" }]);
                  setOpen(false);
                }
              }}
            >
              {sending ? "Sending…" : invRows.length > 1 ? "Send invitations" : "Send invitation"}
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
                const targets = real
                  ? rows.filter((m) => m.status === "active").map((m) => ({ email: m.email, name: m.name.split(" ")[0] ?? m.name }))
                  : resolveRecipients(ws.members.filter((m) => m.status === "active").map((m) => m.id));
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
