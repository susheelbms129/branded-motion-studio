import { addDays, formatISO } from "date-fns";
import { create } from "zustand";

import { computeInsights } from "@/lib/insights";
import { createSeed, type SeedData } from "@/mocks/seed";
import { useUi } from "@/lib/ui-store";
import type {
  ApprovalStep,
  Insight,
  InsightStatus,
  LineItem,
  Material,
  Member,
  PoStatus,
  Priority,
  PurchaseOrder,
  PurchaseRequest,
  Quotation,
  Rfq,
  Role,
  Supplier,
  TimelineEvent,
} from "@/types/domain";

const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;
const now = () => formatISO(new Date());
const pad = (n: number) => String(n).padStart(4, "0");
const year = () => new Date().getFullYear();

function build(demo: boolean): SeedData {
  const seed = createSeed();
  if (demo) return seed;
  const owner: Member = {
    ...(seed.members[0] as Member),
    name: "You",
    email: "you@yourcompany.in",
    lastActiveAt: now(),
  };
  return {
    ...seed,
    organizations: [
      {
        id: "org-live",
        slug: "my-workspace",
        name: "My Workspace",
        plan: "Starter",
        industry: "—",
        city: "—",
        gstin: "",
        currency: "INR",
      },
    ],
    members: [owner],
    suppliers: [],
    materials: [],
    requests: [],
    rfqs: [],
    quotations: [],
    purchaseOrders: [],
    notifications: [],
    activity: [],
    invitations: [],
    approvalRules: seed.approvalRules.slice(0, 2),
  };
}

interface Ctx {
  actorId: string;
}
export interface NewRequest {
  title: string;
  categoryId: string;
  department: string;
  priority: Priority;
  neededBy: string;
  justification: string;
  items: Omit<LineItem, "id">[];
  submit: boolean;
}

interface Ws extends SeedData {
  insightStatus: Record<string, InsightStatus>;
  reset: (demo: boolean) => void;
  insights: () => Insight[];
  createRequest: (r: NewRequest, c: Ctx) => PurchaseRequest;
  submitRequest: (id: string, c: Ctx) => void;
  decideRequest: (id: string, d: "approved" | "rejected", comment: string, c: Ctx) => void;
  createRfq: (requestId: string, supplierIds: string[], dueDate: string, c: Ctx) => Rfq | null;
  addQuotation: (q: Omit<Quotation, "id" | "receivedAt">) => void;
  awardRfq: (rfqId: string, quotationId: string, c: Ctx) => PurchaseOrder | null;
  advancePo: (id: string, status: PoStatus, c: Ctx) => void;
  upsertSupplier: (s: Partial<Supplier> & { name: string }) => void;
  setSupplierStatus: (id: string, status: Supplier["status"]) => void;
  upsertMaterial: (m: Partial<Material> & { name: string; categoryId: string }) => void;
  deleteMaterial: (id: string) => void;
  inviteMember: (email: string, role: Role, c: Ctx) => void;
  setMemberRole: (id: string, role: Role) => void;
  setMemberStatus: (id: string, status: Member["status"]) => void;
  revokeInvite: (id: string) => void;
  toggleRule: (id: string) => void;
  updateOrg: (patch: Partial<SeedData["organizations"][number]>) => void;
  markRead: (id?: string) => void;
  setInsightStatus: (id: string, s: InsightStatus) => void;
}

const ev = (type: TimelineEvent["type"], text: string, actorId: string): TimelineEvent => ({
  id: uid("ev"),
  at: now(),
  actorId,
  type,
  text,
});
const total = (items: { qty: number; unitPrice: number }[]) =>
  items.reduce((s, i) => s + i.qty * i.unitPrice, 0);

export const useWs = create<Ws>()((set, get) => ({
  ...build(useUi.getState().demo),
  insightStatus: {},
  reset: (demo) => set({ ...build(demo), insightStatus: {} }),
  insights: () => {
    const s = get();
    return computeInsights({
      pos: s.purchaseOrders,
      requests: s.requests,
      suppliers: s.suppliers,
      materials: s.materials,
    }).map((i) => ({ ...i, status: s.insightStatus[i.id] ?? "open" }));
  },

  createRequest: (r, { actorId }) => {
    const s = get();
    const id = uid("pr");
    const items: LineItem[] = r.items.map((i, j) => ({ ...i, id: `${id}-${j}` }));
    const approvers = total(items) > 200000 ? ["m4", "m3"] : ["m4"];
    const approvals: ApprovalStep[] = r.submit
      ? approvers.map((a, l) => ({
          id: `${id}-ap${l}`,
          approverId: s.members.some((m) => m.id === a) ? a : actorId,
          level: l + 1,
          status: l === 0 ? "pending" : "waiting",
          at: null,
          comment: null,
        }))
      : [];
    const timeline = [
      ev("created", "Request created", actorId),
      ...(r.submit ? [ev("submitted", "Submitted for approval", actorId)] : []),
    ];
    const req: PurchaseRequest = {
      id,
      number: `PR-${year()}-${pad(140 + s.requests.length)}`,
      title: r.title,
      requesterId: actorId,
      department: r.department,
      categoryId: r.categoryId,
      status: r.submit ? "pending_approval" : "draft",
      priority: r.priority,
      neededBy: new Date(r.neededBy).toISOString(),
      createdAt: now(),
      justification: r.justification,
      items,
      approvals,
      timeline,
      rfqId: null,
    };
    set({
      requests: [req, ...s.requests],
      activity: [
        {
          id: uid("a"),
          actorId,
          verb: r.submit ? "submitted" : "drafted",
          target: req.number,
          targetKind: "purchase_request",
          targetId: id,
          at: now(),
        },
        ...s.activity,
      ],
    });
    return req;
  },
  submitRequest: (id, { actorId }) =>
    set((s) => ({
      requests: s.requests.map((r) => {
        if (r.id !== id) return r;
        const approvers = total(r.items) > 200000 ? ["m4", "m3"] : ["m4"];
        return {
          ...r,
          status: "pending_approval",
          timeline: [...r.timeline, ev("submitted", "Submitted for approval", actorId)],
          approvals: approvers.map((a, l) => ({
            id: `${id}-ap${l}`,
            approverId: s.members.some((m) => m.id === a) ? a : actorId,
            level: l + 1,
            status: l === 0 ? "pending" : "waiting",
            at: null,
            comment: null,
          })),
        };
      }),
    })),
  decideRequest: (id, d, comment, { actorId }) =>
    set((s) => ({
      requests: s.requests.map((r) => {
        if (r.id !== id) return r;
        const idx = r.approvals.findIndex((a) => a.status === "pending");
        if (idx < 0) return r;
        const approvals = r.approvals.map((a, i) =>
          i === idx
            ? { ...a, status: d, at: now(), comment: comment || null }
            : i === idx + 1 && d === "approved"
              ? { ...a, status: "pending" as const }
              : a,
        );
        const status =
          d === "rejected"
            ? "rejected"
            : approvals.every((a) => a.status === "approved")
              ? "approved"
              : "pending_approval";
        return {
          ...r,
          approvals,
          status,
          timeline: [
            ...r.timeline,
            ev(
              d === "approved" ? "approved" : "rejected",
              `${d === "approved" ? "Approved" : "Rejected"} at level ${idx + 1}${comment ? ` — “${comment}”` : ""}`,
              actorId,
            ),
          ],
        };
      }),
    })),

  createRfq: (requestId, supplierIds, dueDate, { actorId }) => {
    const s = get();
    const r = s.requests.find((x) => x.id === requestId);
    if (!r) return null;
    const id = uid("rfq");
    const rfq: Rfq = {
      id,
      number: `RFQ-${year()}-${pad(60 + s.rfqs.length)}`,
      title: r.title,
      requestId,
      categoryId: r.categoryId,
      status: "sent",
      createdAt: now(),
      dueDate: new Date(dueDate).toISOString(),
      ownerId: actorId,
      items: r.items.map((i) => ({ ...i, id: `${id}-${i.id}` })),
      invites: supplierIds.map((sid) => ({
        supplierId: sid,
        status: "sent",
        sentAt: now(),
        respondedAt: null,
      })),
      awardedQuotationId: null,
      notes: "Please quote ex-works with GST shown separately, plus lead time and payment terms.",
    };
    set({
      rfqs: [rfq, ...s.rfqs],
      requests: s.requests.map((x) =>
        x.id === requestId
          ? {
              ...x,
              status: "converted_to_rfq",
              rfqId: id,
              timeline: [...x.timeline, ev("converted", `Converted to ${rfq.number}`, actorId)],
            }
          : x,
      ),
    });
    return rfq;
  },
  addQuotation: (q) =>
    set((s) => ({
      quotations: [...s.quotations, { ...q, id: uid("q"), receivedAt: now() }],
      rfqs: s.rfqs.map((r) =>
        r.id !== q.rfqId
          ? r
          : {
              ...r,
              status: r.status === "sent" ? "evaluating" : r.status,
              invites: r.invites.some((i) => i.supplierId === q.supplierId)
                ? r.invites.map((i) =>
                    i.supplierId === q.supplierId
                      ? { ...i, status: "quoted", respondedAt: now() }
                      : i,
                  )
                : [
                    ...r.invites,
                    {
                      supplierId: q.supplierId,
                      status: "quoted",
                      sentAt: now(),
                      respondedAt: now(),
                    },
                  ],
            },
      ),
    })),
  awardRfq: (rfqId, quotationId, { actorId }) => {
    const s = get();
    const rfq = s.rfqs.find((r) => r.id === rfqId),
      q = s.quotations.find((x) => x.id === quotationId);
    const sup = s.suppliers.find((x) => x.id === q?.supplierId);
    if (!rfq || !q || !sup) return null;
    const lines = q.lines.map((l, i) => {
      const m = s.materials.find((x) => x.id === l.materialId);
      return {
        id: `${rfqId}-pol${i}`,
        materialId: l.materialId,
        description: m?.name ?? "Item",
        qty: l.qty,
        unit: m?.unit ?? "pcs",
        unitPrice: l.unitPrice,
        gstRate: q.gstRate,
      };
    });
    const po: PurchaseOrder = {
      id: uid("po"),
      number: `PO-${year()}-${pad(1000 + s.purchaseOrders.length + 1).slice(1)}`,
      supplierId: sup.id,
      rfqId,
      quotationId,
      requestId: rfq.requestId,
      categoryId: rfq.categoryId,
      status: "issued",
      createdAt: now(),
      issuedAt: now(),
      expectedAt: addDays(new Date(), q.deliveryDays).toISOString(),
      deliveredAt: null,
      createdById: actorId,
      lines,
      shipping: q.shipping,
      otherCharges: q.otherCharges,
      paymentTermsDays: q.paymentTermsDays,
      deliveryAddress: "Plot 42, MIDC Bhosari, Pune 411026",
      notes: `Awarded from ${rfq.number}`,
      history: [
        ev("created", "Purchase order created from awarded RFQ", actorId),
        ev("issued", `Issued to ${sup.name}`, actorId),
      ],
    };
    set({
      purchaseOrders: [po, ...s.purchaseOrders],
      rfqs: s.rfqs.map((r) =>
        r.id === rfqId ? { ...r, status: "awarded", awardedQuotationId: quotationId } : r,
      ),
      requests: s.requests.map((r) => (r.id === rfq.requestId ? { ...r, status: "completed" } : r)),
    });
    return po;
  },
  advancePo: (id, status, { actorId }) =>
    set((s) => ({
      purchaseOrders: s.purchaseOrders.map((p) => {
        if (p.id !== id) return p;
        const label: Record<string, [TimelineEvent["type"], string]> = {
          issued: ["issued", "Issued to supplier"],
          acknowledged: ["acknowledged", "Supplier acknowledged the order"],
          partially_received: ["received", "Partial delivery received"],
          received: ["received", "Goods received"],
          closed: ["closed", "Invoice matched and PO closed"],
          cancelled: ["closed", "Purchase order cancelled"],
        };
        const [t, text] = label[status] ?? ["updated", status];
        return {
          ...p,
          status,
          issuedAt: status === "issued" ? now() : p.issuedAt,
          deliveredAt: status === "received" ? now() : p.deliveredAt,
          history: [...p.history, ev(t, text, actorId)],
        };
      }),
    })),

  upsertSupplier: (sup) =>
    set((s) => {
      if (sup.id)
        return { suppliers: s.suppliers.map((x) => (x.id === sup.id ? { ...x, ...sup } : x)) };
      const id = uid("s");
      const n: Supplier = {
        id,
        city: "",
        state: "",
        gstin: "",
        categoryIds: [],
        paymentTermsDays: 30,
        since: now(),
        status: "active",
        email: "",
        phone: "",
        website: "",
        contacts: [],
        ...sup,
      };
      return { suppliers: [n, ...s.suppliers] };
    }),
  setSupplierStatus: (id, status) =>
    set((s) => ({ suppliers: s.suppliers.map((x) => (x.id === id ? { ...x, status } : x)) })),
  upsertMaterial: (m) =>
    set((s) => {
      if (m.id) return { materials: s.materials.map((x) => (x.id === m.id ? { ...x, ...m } : x)) };
      const n: Material = {
        id: uid("mt"),
        sku: `SKU-${Math.floor(Math.random() * 9000 + 1000)}`,
        unit: "pcs",
        gstRate: 18,
        hsn: "",
        preferredSupplierId: null,
        description: "",
        ...m,
      };
      return { materials: [n, ...s.materials] };
    }),
  deleteMaterial: (id) => set((s) => ({ materials: s.materials.filter((x) => x.id !== id) })),

  inviteMember: (email, role, { actorId }) =>
    set((s) => ({
      invitations: [
        { id: uid("inv"), email, role, invitedById: actorId, sentAt: now(), status: "pending" },
        ...s.invitations,
      ],
    })),
  setMemberRole: (id, role) =>
    set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, role } : m)) })),
  setMemberStatus: (id, status) =>
    set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, status } : m)) })),
  revokeInvite: (id) => set((s) => ({ invitations: s.invitations.filter((i) => i.id !== id) })),
  toggleRule: (id) =>
    set((s) => ({
      approvalRules: s.approvalRules.map((r) => (r.id === id ? { ...r, active: !r.active } : r)),
    })),
  updateOrg: (patch) =>
    set((s) => ({
      organizations: s.organizations.map((o, i) => (i === 0 ? { ...o, ...patch } : o)),
    })),
  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (!id || n.id === id ? { ...n, read: true } : n)),
    })),
  setInsightStatus: (id, st) => set((s) => ({ insightStatus: { ...s.insightStatus, [id]: st } })),
}));

/** The member acting right now = first active member with the selected role. */
export function useActor(): string {
  const role = useUi((s) => s.role);
  const members = useWs((s) => s.members);
  return (members.find((m) => m.role === role && m.status === "active") ?? members[0])?.id ?? "m1";
}
