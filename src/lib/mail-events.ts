import { ROLE_LABEL } from "@/lib/permissions";
import { notify, resolveRecipients } from "@/lib/mail";
import { useWs } from "@/lib/ws-store";

/**
 * Turns workspace changes into emails by watching the store. Nothing in the store, pages or tests
 * had to change, and an email problem can never affect the action that caused it.
 * Only changes that actually exist in the app are covered (invoices aren't a feature yet).
 */

type S = ReturnType<typeof useWs.getState>;

const SAFE = /^[A-Za-z0-9_-]+$/;
const link = (base: string, id: string) => (SAFE.test(id) ? `${base}/${id}` : base);
const pendingApprover = (r: S["requests"][number]) => r.approvals.find((a) => a.status === "pending")?.approverId;

function diff(next: S, prev: S) {
  // A workspace reset (demo <-> empty) replaces everything: never email for that.
  if (next.organizations[0]?.id !== prev.organizations[0]?.id) return;
  const nameOf = (id?: string) => next.members.find((m) => m.id === id)?.name;
  const stamp = Math.floor(Date.now() / 60_000);

  // Invitations are NOT emailed from here any more: real invitations are created and emailed
  // through the database + server (see team-api.ts). Demo invitations never send email.

  // Team: role changed / access suspended
  for (const m of next.members) {
    const p = prev.members.find((x) => x.id === m.id);
    if (!p) continue;
    const to = resolveRecipients([m.id]);
    if (p.role !== m.role) {
      for (const r of to) void notify("role_changed", "team", r, { title: ROLE_LABEL[m.role], path: "/buyer/dashboard", key: `role:${m.id}:${m.role}:${stamp}` });
    }
    if (p.status !== m.status && m.status === "suspended") {
      for (const r of to) void notify("member_suspended", "team", r, { title: m.name, path: "/buyer/dashboard", key: `susp:${m.id}:${stamp}` });
    }
  }

  // Purchase requests
  for (const r of next.requests) {
    const p = prev.requests.find((x) => x.id === r.id);
    const path = link("/buyer/dashboard/requests", r.id);
    const title = `${r.number} · ${r.title}`;
    const submitted = r.status === "pending_approval" && (!p || p.status !== "pending_approval");
    const approver = pendingApprover(r);
    const assignedChanged = !!approver && (!p || pendingApprover(p) !== approver) && r.status === "pending_approval";
    const approverTo = resolveRecipients(approver ? [approver] : []);
    const requesterTo = resolveRecipients([r.requesterId]);

    if (assignedChanged) {
      for (const to of approverTo) {
        void notify("request_assigned", "requests", to, { title, path, actorName: nameOf(r.requesterId), detail: `${r.priority} priority`, key: `assign:${r.id}:${approver}:${r.approvals.filter((a) => a.status === "approved").length}` });
      }
    }
    if (submitted) {
      const approverEmails = new Set(approverTo.map((a) => a.email));
      for (const to of requesterTo) {
        if (approverEmails.has(to.email)) continue; // demo: one email is enough
        void notify("request_submitted", "requests", to, { title, path, status: "pending approval", key: `submit:${r.id}` });
      }
    }
    if (p && p.status !== r.status && (r.status === "approved" || r.status === "rejected")) {
      for (const to of requesterTo) void notify("request_decided", "approvals", to, { title, path, status: r.status, key: `decide:${r.id}:${r.status}` });
    }
  }

  // Purchase orders (created + status changes)
  const poRecipients = resolveRecipients(next.members.filter((m) => m.role === "owner" || m.role === "procurement_manager").map((m) => m.id));
  for (const po of next.purchaseOrders) {
    const p = prev.purchaseOrders.find((x) => x.id === po.id);
    const path = link("/buyer/dashboard/purchase-orders", po.id);
    const supplier = next.suppliers.find((s) => s.id === po.supplierId)?.name ?? "supplier";
    if (!p) {
      for (const to of poRecipients) void notify("po_issued", "orders", to, { title: `${po.number} · ${supplier}`, path, status: po.status, key: `po:${po.id}:new` });
    } else if (p.status !== po.status) {
      for (const to of poRecipients) void notify("po_status", "orders", to, { title: `${po.number} · ${supplier}`, path, status: po.status, key: `po:${po.id}:${po.status}` });
    }
  }

  // New suppliers
  for (const s of next.suppliers) {
    if (prev.suppliers.some((x) => x.id === s.id)) continue;
    for (const to of poRecipients) void notify("supplier_added", "suppliers", to, { title: s.name, path: link("/buyer/dashboard/suppliers", s.id), detail: [s.city, s.state].filter(Boolean).join(", ") || undefined, key: `sup:${s.id}` });
  }
}

/** Start listening. Returns the unsubscribe function (use it as a React effect cleanup). */
export function startMailEvents(): () => void {
  return useWs.subscribe((next, prev) => {
    try {
      diff(next, prev);
    } catch (e) {
      console.error("[mail-events]", e);
    }
  });
}
