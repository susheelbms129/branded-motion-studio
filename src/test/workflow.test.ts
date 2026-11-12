import { describe, expect, it } from "vitest";

import { computeInsights } from "@/lib/insights";
import { useWs } from "@/lib/ws-store";

const c = { actorId: "m1" };

describe("procurement workflow", () => {
  it("runs request → approval → RFQ → quote → award → PO", () => {
    const ws = useWs.getState();
    const m = ws.materials[0]!;
    const req = ws.createRequest(
      {
        title: "Test steel",
        categoryId: m.categoryId,
        department: "Production",
        priority: "high",
        neededBy: "2026-12-01",
        justification: "Needed for line 3",
        items: [{ materialId: m.id, description: m.name, unit: m.unit, qty: 100, unitPrice: 10 }],
        submit: true,
      },
      c,
    );
    expect(useWs.getState().requests[0]?.status).toBe("pending_approval");
    useWs.getState().decideRequest(req.id, "approved", "ok", c);
    expect(useWs.getState().requests.find((r) => r.id === req.id)?.status).toBe("approved");
    const supplier = useWs.getState().suppliers[0]!;
    const rfq = useWs.getState().createRfq(req.id, [supplier.id], "2026-11-30", c)!;
    useWs.getState().addQuotation({
      rfqId: rfq.id,
      supplierId: supplier.id,
      lines: [{ materialId: m.id, qty: 100, unitPrice: 12 }],
      gstRate: 18,
      shipping: 500,
      otherCharges: 0,
      deliveryDays: 5,
      paymentTermsDays: 30,
      validUntil: "2026-12-30",
      notes: "",
    });
    const q = useWs.getState().quotations.find((x) => x.rfqId === rfq.id)!;
    const po = useWs.getState().awardRfq(rfq.id, q.id, c)!;
    expect(po.status).toBe("issued");
    expect(useWs.getState().rfqs.find((r) => r.id === rfq.id)?.status).toBe("awarded");
    useWs.getState().advancePo(po.id, "received", c);
    expect(useWs.getState().purchaseOrders.find((p) => p.id === po.id)?.deliveredAt).not.toBeNull();
  });

  it("rejects at level 1 and starts empty in non-demo mode", () => {
    useWs.getState().reset(true);
    const s = useWs.getState();
    const m = s.materials[0]!;
    const r = s.createRequest(
      {
        title: "Reject me",
        categoryId: m.categoryId,
        department: "Ops",
        priority: "low",
        neededBy: "2026-12-01",
        justification: "Testing rejection flow",
        items: [{ materialId: m.id, description: m.name, unit: m.unit, qty: 1, unitPrice: 1 }],
        submit: true,
      },
      c,
    );
    useWs.getState().decideRequest(r.id, "rejected", "no", c);
    expect(useWs.getState().requests.find((x) => x.id === r.id)?.status).toBe("rejected");
    useWs.getState().reset(false);
    expect(useWs.getState().purchaseOrders).toHaveLength(0);
    expect(useWs.getState().insights()).toHaveLength(0);
    useWs.getState().reset(true);
  });

  it("derives insights from records with evidence", () => {
    useWs.getState().reset(true);
    const s = useWs.getState();
    const list = computeInsights({
      pos: s.purchaseOrders,
      requests: s.requests,
      suppliers: s.suppliers,
      materials: s.materials,
    });
    expect(list.length).toBeGreaterThan(0);
    for (const i of list) {
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.confidence).toBeLessThanOrEqual(1);
    }
  });
});
