/* Seeded demo workspace. Deterministic PRNG so every load shows the same records. */
import { addDays, formatISO, startOfDay, subDays, subMonths } from "date-fns";

import type {
  ActivityItem,
  AppNotification,
  ApprovalRule,
  ApprovalStep,
  Category,
  Invitation,
  LineItem,
  Material,
  Member,
  Organization,
  PoLine,
  PoStatus,
  PurchaseOrder,
  PurchaseRequest,
  Quotation,
  RequestStatus,
  Rfq,
  RfqInvite,
  Supplier,
  TimelineEvent,
} from "@/types/domain";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedData {
  organizations: Organization[];
  members: Member[];
  categories: Category[];
  suppliers: Supplier[];
  materials: Material[];
  requests: PurchaseRequest[];
  rfqs: Rfq[];
  quotations: Quotation[];
  purchaseOrders: PurchaseOrder[];
  notifications: AppNotification[];
  activity: ActivityItem[];
  invitations: Invitation[];
  approvalRules: ApprovalRule[];
}

export function createSeed(): SeedData {
  const rand = mulberry32(20261112);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const today = startOfDay(new Date());
  const iso = (d: Date) => formatISO(d);
  const ago = (days: number, hours = 10) => iso(addHoursSafe(subDays(today, days), hours));
  function addHoursSafe(d: Date, h: number) {
    const x = new Date(d);
    x.setHours(h, between(0, 59));
    return x;
  }

  const organizations: Organization[] = [
    { id: "org1", slug: "sharma-industries", name: "Sharma Precision Industries", plan: "Growth", industry: "Manufacturing", city: "Pune", gstin: "27AAFCS4821K1Z3", currency: "INR" },
    { id: "org2", slug: "nexa-retail", name: "Nexa Retail Ventures", plan: "Starter", industry: "Retail", city: "Bengaluru", gstin: "29AAGCN7712M1Z8", currency: "INR" },
  ];

  const members: Member[] = [
    { id: "m1", name: "Aarav Sharma", email: "aarav@sharmaprecision.in", role: "owner", department: "Management", status: "active", joinedAt: ago(420), lastActiveAt: ago(0, 9), accent: "blue" },
    { id: "m2", name: "Priya Nair", email: "priya.nair@sharmaprecision.in", role: "procurement_manager", department: "Procurement", status: "active", joinedAt: ago(390), lastActiveAt: ago(0, 8), accent: "violet" },
    { id: "m3", name: "Rohan Mehta", email: "rohan.mehta@sharmaprecision.in", role: "finance_manager", department: "Finance", status: "active", joinedAt: ago(380), lastActiveAt: ago(1), accent: "emerald" },
    { id: "m4", name: "Kavya Iyer", email: "kavya.iyer@sharmaprecision.in", role: "approver", department: "Operations", status: "active", joinedAt: ago(300), lastActiveAt: ago(0, 7), accent: "pink" },
    { id: "m5", name: "Vikram Singh", email: "vikram.singh@sharmaprecision.in", role: "approver", department: "Production", status: "active", joinedAt: ago(280), lastActiveAt: ago(2), accent: "amber" },
    { id: "m6", name: "Ananya Gupta", email: "ananya.gupta@sharmaprecision.in", role: "employee", department: "Production", status: "active", joinedAt: ago(200), lastActiveAt: ago(0, 6), accent: "cyan" },
    { id: "m7", name: "Arjun Reddy", email: "arjun.reddy@sharmaprecision.in", role: "employee", department: "Maintenance", status: "active", joinedAt: ago(160), lastActiveAt: ago(3), accent: "indigo" },
    { id: "m8", name: "Neha Kapoor", email: "neha.kapoor@sharmaprecision.in", role: "employee", department: "Administration", status: "active", joinedAt: ago(120), lastActiveAt: ago(1), accent: "coral" },
    { id: "m9", name: "Siddharth Joshi", email: "siddharth.joshi@sharmaprecision.in", role: "procurement_manager", department: "Procurement", status: "suspended", joinedAt: ago(350), lastActiveAt: ago(60), accent: "magenta" },
  ];
  const requesterIds = ["m6", "m7", "m8", "m2", "m5", "m4"];

  const categories: Category[] = [
    { id: "c1", name: "Raw Materials", accent: "blue", monthlyBudget: 1800000 },
    { id: "c2", name: "Electrical", accent: "amber", monthlyBudget: 450000 },
    { id: "c3", name: "Packaging", accent: "emerald", monthlyBudget: 380000 },
    { id: "c4", name: "IT & Electronics", accent: "violet", monthlyBudget: 300000 },
    { id: "c5", name: "Office Supplies", accent: "cyan", monthlyBudget: 60000 },
    { id: "c6", name: "MRO & Tools", accent: "pink", monthlyBudget: 220000 },
    { id: "c7", name: "Safety & PPE", accent: "coral", monthlyBudget: 120000 },
    { id: "c8", name: "Logistics Services", accent: "indigo", monthlyBudget: 260000 },
  ];

  const sup = (
    id: string, name: string, city: string, state: string, stateCode: string, cats: string[], terms: number,
    contact: [string, string], status: Supplier["status"] = "active",
  ): Supplier => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14);
    const pan = `AA${name.replace(/[^A-Z]/g, "").padEnd(3, "X").slice(0, 3)}${between(1000, 9999)}${String.fromCharCode(65 + between(0, 25))}`;
    return {
      id, name, city, state, gstin: `${stateCode}${pan}1Z${between(1, 9)}`, categoryIds: cats, paymentTermsDays: terms,
      since: ago(between(200, 1400)), status, email: `sales@${slug}.in`, phone: `+91 ${between(70000, 99999)} ${between(10000, 99999)}`,
      website: `www.${slug}.in`,
      contacts: [
        { id: `${id}-c1`, name: contact[0], designation: contact[1], email: `${contact[0].split(" ")[0]?.toLowerCase()}@${slug}.in`, phone: `+91 ${between(70000, 99999)} ${between(10000, 99999)}`, primary: true },
        { id: `${id}-c2`, name: pick(["Ramesh Patil", "Sunita Rao", "Imran Shaikh", "Deepa Menon", "Karan Malhotra"]), designation: "Accounts", email: `accounts@${slug}.in`, phone: `+91 ${between(70000, 99999)} ${between(10000, 99999)}`, primary: false },
      ],
    };
  };

  const suppliers: Supplier[] = [
    sup("s1", "Shree Balaji Steel Traders", "Pune", "Maharashtra", "27", ["c1"], 30, ["Mahesh Agarwal", "Sales Head"]),
    sup("s2", "Arihant Metals & Alloys", "Chennai", "Tamil Nadu", "33", ["c1"], 45, ["Prakash Jain", "Director"]),
    sup("s3", "Mahalaxmi Electricals", "Mumbai", "Maharashtra", "27", ["c2"], 30, ["Sanjay Kulkarni", "Key Accounts"]),
    sup("s4", "Kaveri Packaging Solutions", "Bengaluru", "Karnataka", "29", ["c3"], 30, ["Lakshmi Narayan", "Sales Manager"]),
    sup("s5", "Deccan Corrugators", "Nashik", "Maharashtra", "27", ["c3"], 21, ["Vijay Deshmukh", "Proprietor"]),
    sup("s6", "NetCore IT Solutions", "Bengaluru", "Karnataka", "29", ["c4"], 15, ["Rahul Krishnan", "Account Manager"]),
    sup("s7", "Om Sai Office Mart", "Pune", "Maharashtra", "27", ["c5"], 15, ["Sneha Bhosale", "Owner"]),
    sup("s8", "Ganesh Industrial Tools", "Ahmedabad", "Gujarat", "24", ["c6"], 30, ["Hitesh Patel", "Partner"]),
    sup("s9", "Precision Fasteners India", "Ludhiana", "Punjab", "03", ["c6", "c1"], 45, ["Gurpreet Sandhu", "Export Manager"]),
    sup("s10", "Rathi Safety Gear", "Jaipur", "Rajasthan", "08", ["c7"], 30, ["Ankit Rathi", "Director"]),
    sup("s11", "Vardhman Logistics", "New Delhi", "Delhi", "07", ["c8"], 15, ["Manoj Tiwari", "Operations"]),
    sup("s12", "Sai Krupa Polymers", "Hyderabad", "Telangana", "36", ["c3", "c1"], 30, ["Srinivas Reddy", "Sales Head"], "under_review"),
    sup("s13", "Electro Power Systems", "Coimbatore", "Tamil Nadu", "33", ["c2"], 45, ["Karthik Subramanian", "Regional Sales"]),
  ];

  const mat = (id: string, sku: string, name: string, cat: string, unit: string, gst: number, hsn: string, pref: string | null, desc: string): Material => ({
    id, sku, name, categoryId: cat, unit, gstRate: gst, hsn, preferredSupplierId: pref, description: desc,
  });
  const materials: Material[] = [
    mat("mt1", "RM-MSP-06", "MS Plate 6mm (IS 2062)", "c1", "kg", 18, "7208", "s1", "Mild steel plate, hot rolled, 6mm thickness"),
    mat("mt2", "RM-SSR-20", "SS 304 Round Bar 20mm", "c1", "kg", 18, "7222", "s2", "Stainless steel 304 bright bar"),
    mat("mt3", "RM-ALS-03", "Aluminium Sheet 3mm", "c1", "kg", 18, "7606", "s2", "Aluminium alloy 6061 sheet"),
    mat("mt4", "RM-HDPE-GR", "HDPE Granules (Injection)", "c1", "kg", 18, "3901", "s12", "High density polyethylene granules"),
    mat("mt5", "EL-CBL-4C", "Armoured Cable 4 Core 16 sq mm", "c2", "m", 18, "8544", "s3", "Copper armoured power cable"),
    mat("mt6", "EL-MCB-32", "MCB 32A Triple Pole", "c2", "pcs", 18, "8536", "s3", "Miniature circuit breaker, C curve"),
    mat("mt7", "EL-LED-150", "LED High Bay 150W", "c2", "pcs", 12, "9405", "s13", "Industrial LED high bay fixture"),
    mat("mt8", "PK-CB-5P", "Corrugated Box 5 Ply 18x12x12", "c3", "pcs", 12, "4819", "s4", "Brown 5-ply corrugated carton"),
    mat("mt9", "PK-SF-23", "Stretch Film 23 micron", "c3", "roll", 18, "3920", "s4", "LLDPE stretch wrap roll, 500mm"),
    mat("mt10", "PK-BT-48", "BOPP Tape 48mm x 65m", "c3", "roll", 18, "3919", "s5", "Transparent packing tape"),
    mat("mt11", "IT-LAP-I5", "Business Laptop (i5, 16GB)", "c4", "pcs", 18, "8471", "s6", "14\" business laptop, 3-year warranty"),
    mat("mt12", "IT-MON-24", "24\" IPS Monitor", "c4", "pcs", 18, "8528", "s6", "Full HD IPS monitor with HDMI"),
    mat("mt13", "IT-SW-24P", "Network Switch 24 Port", "c4", "pcs", 18, "8517", "s6", "Managed gigabit switch"),
    mat("mt14", "OF-A4-75", "A4 Copier Paper 75 GSM", "c5", "ream", 12, "4802", "s7", "500 sheets per ream"),
    mat("mt15", "OF-TNR-88", "Toner Cartridge 88A", "c5", "pcs", 18, "8443", "s7", "Compatible laser toner"),
    mat("mt16", "MR-DRL-10", "Carbide Drill Bit 10mm", "c6", "pcs", 18, "8207", "s8", "Solid carbide twist drill"),
    mat("mt17", "MR-BRG-6205", "Ball Bearing 6205 ZZ", "c6", "pcs", 18, "8482", "s9", "Deep groove ball bearing"),
    mat("mt18", "MR-HXB-M12", "Hex Bolt M12 x 50 (8.8)", "c6", "pcs", 18, "7318", "s9", "High tensile hex bolt, zinc plated"),
    mat("mt19", "SF-GLV-NTR", "Nitrile Gloves (Box of 100)", "c7", "box", 12, "4015", "s10", "Powder-free nitrile examination gloves"),
    mat("mt20", "SF-HLM-IS", "Safety Helmet (ISI marked)", "c7", "pcs", 18, "6506", "s10", "HDPE shell with ratchet"),
    mat("mt21", "SF-SHO-S3", "Safety Shoes S3", "c7", "pair", 12, "6403", "s10", "Steel toe, anti-static"),
    mat("mt22", "LG-FTL-PUN", "FTL Freight Pune–Chennai", "c8", "trip", 5, "9965", "s11", "Full truck load, 9 tonne"),
    mat("mt23", "LG-PTL-KG", "Part Load Freight", "c8", "kg", 5, "9965", "s11", "Part truck load per kg"),
    mat("mt24", "PK-PLT-WD", "Wooden Pallet 1200x1000", "c3", "pcs", 12, "4415", "s5", "Heat treated export pallet"),
  ];
  const basePrice: Record<string, number> = {
    mt1: 62, mt2: 245, mt3: 290, mt4: 118, mt5: 485, mt6: 1450, mt7: 4200, mt8: 38, mt9: 380, mt10: 52,
    mt11: 64000, mt12: 9800, mt13: 18500, mt14: 245, mt15: 1650, mt16: 820, mt17: 145, mt18: 14, mt19: 420,
    mt20: 260, mt21: 1350, mt22: 38000, mt23: 9, mt24: 950,
  };
  const qtyRange: Record<string, [number, number]> = {
    mt1: [2000, 9000], mt2: [300, 1500], mt3: [200, 900], mt4: [1000, 5000], mt5: [200, 1200], mt6: [10, 60], mt7: [8, 40],
    mt8: [1000, 6000], mt9: [40, 200], mt10: [200, 1200], mt11: [2, 10], mt12: [3, 15], mt13: [1, 4], mt14: [40, 200],
    mt15: [4, 20], mt16: [20, 120], mt17: [100, 600], mt18: [1000, 8000], mt19: [20, 120], mt20: [30, 150], mt21: [20, 80],
    mt22: [1, 4], mt23: [500, 3000], mt24: [50, 300],
  };
  const matsByCat = (cat: string) => materials.filter((m) => m.categoryId === cat);
  const suppliersByCat = (cat: string) => suppliers.filter((s) => s.categoryIds.includes(cat));

  // Supplier price factors and delivery behaviour (drives computed performance)
  const priceFactor: Record<string, number> = { s1: 1.0, s2: 1.04, s3: 1.03, s4: 0.98, s5: 0.95, s6: 1.0, s7: 1.0, s8: 1.02, s9: 0.97, s10: 1.0, s11: 1.0, s12: 0.93, s13: 0.96 };
  const delayBias: Record<string, [number, number]> = {
    s1: [-2, 2], s2: [-1, 3], s3: [1, 9], s4: [-2, 1], s5: [0, 6], s6: [-1, 1], s7: [-1, 1], s8: [-2, 2],
    s9: [-1, 4], s10: [-2, 1], s11: [-1, 2], s12: [0, 5], s13: [-1, 2],
  };

  const priceAt = (materialId: string, supplierId: string, monthsAgo: number) => {
    let drift = 1 + (12 - monthsAgo) * 0.004; // gentle inflation
    if (materialId === "mt1" && monthsAgo <= 3) drift *= 1 + (4 - monthsAgo) * 0.042; // steel price surge
    if (materialId === "mt5" && monthsAgo <= 2) drift *= 1.09;
    const noise = 1 + (rand() - 0.5) * 0.03;
    const p = (basePrice[materialId] ?? 100) * drift * (priceFactor[supplierId] ?? 1) * noise;
    return p > 1000 ? Math.round(p / 10) * 10 : Math.round(p * 100) / 100;
  };

  // ───────── Purchase orders (12 months) ─────────
  const purchaseOrders: PurchaseOrder[] = [];
  const catWeights = ["c1", "c1", "c1", "c1", "c2", "c2", "c3", "c3", "c3", "c4", "c5", "c6", "c6", "c7", "c8", "c8"];
  let poSeq = 1;
  const addresses = ["Plot 42, MIDC Bhosari, Pune 411026", "Gat No. 118, Chakan Industrial Area, Pune 410501"];
  for (let monthsAgo = 11; monthsAgo >= 0; monthsAgo--) {
    const count = between(5, 8) + (monthsAgo < 3 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const cat = pick(catWeights);
      let supplier = pick(suppliersByCat(cat).filter((s) => s.status !== "inactive"));
      if (cat === "c2" && rand() < 0.6) supplier = suppliers.find((s) => s.id === "s3") as Supplier; // Mahalaxmi heavy usage
      const mats = matsByCat(cat);
      const nLines = Math.min(mats.length, between(1, 3));
      const chosen = [...mats].sort(() => rand() - 0.5).slice(0, nLines);
      const created = subDays(subMonths(today, monthsAgo), between(0, 26));
      if (created > today) continue;
      const lead = between(5, 14);
      const expected = addDays(created, lead + 1);
      const [dMin, dMax] = delayBias[supplier.id] ?? [0, 2];
      const delay = between(dMin, dMax);
      const deliveredDate = addDays(expected, delay);
      const delivered = deliveredDate < today;
      let status: PoStatus = delivered ? (monthsAgo > 1 ? "closed" : "received") : created < subDays(today, 4) ? "acknowledged" : "issued";
      if (!delivered && rand() < 0.2) status = "partially_received";
      const lines: PoLine[] = chosen.map((m, i) => {
        const [qMin, qMax] = qtyRange[m.id] ?? [1, 10];
        const qty = Math.round(between(qMin, qMax) / (qMin >= 100 ? 50 : 1)) * (qMin >= 100 ? 50 : 1) || qMin;
        return { id: `pol${poSeq}-${i}`, materialId: m.id, description: m.name, qty, unit: m.unit, unitPrice: priceAt(m.id, supplier.id, monthsAgo), gstRate: m.gstRate };
      });
      const id = `po${poSeq}`;
      const number = `PO-${created.getFullYear()}-${String(1000 + poSeq).slice(1)}`;
      const createdBy = pick(["m2", "m2", "m9", "m1"]);
      const history: TimelineEvent[] = [
        { id: `${id}-h1`, at: iso(created), actorId: createdBy, type: "created", text: "Purchase order created" },
        { id: `${id}-h2`, at: iso(addDays(created, 0)), actorId: createdBy, type: "issued", text: `Issued to ${supplier.name}` },
      ];
      if (status !== "issued") history.push({ id: `${id}-h3`, at: iso(addDays(created, 1)), actorId: createdBy, type: "acknowledged", text: "Supplier acknowledged the order" });
      if (delivered) history.push({ id: `${id}-h4`, at: iso(deliveredDate), actorId: "m7", type: "received", text: delay > 0 ? `Goods received — ${delay} day${delay === 1 ? "" : "s"} late` : "Goods received on time" });
      if (status === "closed") history.push({ id: `${id}-h5`, at: iso(addDays(deliveredDate, 3)), actorId: "m3", type: "closed", text: "Invoice matched and PO closed" });
      purchaseOrders.push({
        id, number, supplierId: supplier.id, rfqId: null, quotationId: null, requestId: null, categoryId: cat, status,
        createdAt: iso(created), issuedAt: iso(created), expectedAt: iso(expected), deliveredAt: delivered ? iso(deliveredDate) : null,
        createdById: createdBy, lines, shipping: cat === "c8" ? 0 : between(0, 6) * 500, otherCharges: rand() < 0.3 ? between(1, 5) * 250 : 0,
        paymentTermsDays: supplier.paymentTermsDays, deliveryAddress: pick(addresses), notes: "", history,
      });
      poSeq++;
    }
  }
  // one draft and one cancelled
  const draftPo = purchaseOrders[purchaseOrders.length - 1];
  if (draftPo) { draftPo.status = "draft"; draftPo.issuedAt = null; draftPo.deliveredAt = null; draftPo.history = draftPo.history.slice(0, 1); }
  const cancelled = purchaseOrders[purchaseOrders.length - 12];
  if (cancelled && !cancelled.deliveredAt) { cancelled.status = "cancelled"; }

  // ───────── Purchase requests ─────────
  const requests: PurchaseRequest[] = [];
  const prTitles: [string, string, string[]][] = [
    ["MS plates for Line 3 fabrication", "c1", ["mt1"]],
    ["Monthly packaging replenishment", "c3", ["mt8", "mt9", "mt10"]],
    ["Laptops for new QA engineers", "c4", ["mt11"]],
    ["Electrical panel upgrade — Bay 2", "c2", ["mt5", "mt6"]],
    ["Safety gloves for assembly team", "c7", ["mt19"]],
    ["Bearings & fasteners for maintenance", "c6", ["mt17", "mt18"]],
    ["Office stationery — Q4", "c5", ["mt14", "mt15"]],
    ["Warehouse LED lighting retrofit", "c2", ["mt7"]],
    ["SS round bar for shaft machining", "c1", ["mt2"]],
    ["Export pallets for Chennai dispatch", "c3", ["mt24"]],
    ["Freight — Pune to Chennai (Nov)", "c8", ["mt22"]],
    ["Monitors for design workstations", "c4", ["mt12"]],
    ["Helmets & shoes for new hires", "c7", ["mt20", "mt21"]],
    ["Carbide drill bits — CNC cell", "c6", ["mt16"]],
    ["HDPE granules for moulding trial", "c1", ["mt4"]],
    ["Aluminium sheets for enclosures", "c1", ["mt3"]],
    ["Network switch for plant office", "c4", ["mt13"]],
    ["Nitrile gloves — stores top-up", "c7", ["mt19"]],
    ["Corrugated boxes — export batch", "c3", ["mt8"]],
    ["Armoured cable for new compressor", "c2", ["mt5"]],
    ["Toner cartridges for admin", "c5", ["mt15"]],
    ["Part load freight — samples", "c8", ["mt23"]],
    ["MS plates — urgent top-up", "c1", ["mt1"]],
    ["Stretch film for palletising", "c3", ["mt9"]],
    ["Bolts for structural frame", "c6", ["mt18"]],
    ["MCBs for distribution boards", "c2", ["mt6"]],
  ];
  const statusPlan: RequestStatus[] = [
    "completed", "completed", "completed", "converted_to_rfq", "pending_approval", "completed", "approved", "converted_to_rfq",
    "completed", "rejected", "completed", "pending_approval", "approved", "completed", "draft", "converted_to_rfq",
    "pending_approval", "pending_approval", "converted_to_rfq", "pending_approval", "draft", "approved", "pending_approval", "draft",
    "pending_approval", "converted_to_rfq",
  ];
  const deptOf: Record<string, string> = Object.fromEntries(members.map((m) => [m.id, m.department]));
  prTitles.forEach(([title, cat, mats], i) => {
    const age = Math.max(0, 58 - i * 2 - between(0, 1));
    const created = subDays(today, age);
    const requesterId = title.startsWith("Nitrile") ? "m7" : title.startsWith("Safety gloves") ? "m6" : pick(requesterIds);
    const status = statusPlan[i] ?? "draft";
    const items: LineItem[] = mats.map((mid, j) => {
      const m = materials.find((x) => x.id === mid) as Material;
      const [qMin, qMax] = qtyRange[mid] ?? [1, 10];
      const qty = Math.round(between(qMin, qMax) / (qMin >= 100 ? 50 : 1)) * (qMin >= 100 ? 50 : 1) || qMin;
      return { id: `pr${i}-${j}`, materialId: mid, description: m.name, qty, unit: m.unit, unitPrice: Math.round((basePrice[mid] ?? 100) * 1.03 * 100) / 100 };
    });
    const total = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
    const approvers = total > 200000 ? ["m4", "m3"] : ["m4"];
    const approvals: ApprovalStep[] = approvers.map((a, lvl) => {
      let st: ApprovalStep["status"] = "waiting";
      if (["approved", "converted_to_rfq", "completed"].includes(status)) st = "approved";
      else if (status === "rejected") st = lvl === 0 ? "rejected" : "waiting";
      else if (status === "pending_approval") st = lvl === 0 ? "pending" : "waiting";
      return {
        id: `pr${i}-ap${lvl}`, approverId: a, level: lvl + 1, status: st,
        at: st === "approved" || st === "rejected" ? iso(addDays(created, lvl + 1)) : null,
        comment: st === "rejected" ? "Existing stock covers next 3 weeks — please re-raise in December." : st === "approved" && lvl === 0 ? "Approved, within department budget." : null,
      };
    });
    const timeline: TimelineEvent[] = [{ id: `pr${i}-t0`, at: iso(created), actorId: requesterId, type: "created", text: "Request created" }];
    if (status !== "draft") timeline.push({ id: `pr${i}-t1`, at: iso(addHoursSafe(created, 12)), actorId: requesterId, type: "submitted", text: "Submitted for approval" });
    approvals.filter((a) => a.at).forEach((a) => timeline.push({ id: `${a.id}-t`, at: a.at as string, actorId: a.approverId, type: a.status === "approved" ? "approved" : "rejected", text: `${a.status === "approved" ? "Approved" : "Rejected"} at level ${a.level}${a.comment ? ` — “${a.comment}”` : ""}` }));
    requests.push({
      id: `pr${i + 1}`, number: `PR-${created.getFullYear()}-${String(140 + i).padStart(4, "0")}`, title, requesterId,
      department: deptOf[requesterId] ?? "Operations", categoryId: cat, status,
      priority: pick(["low", "medium", "medium", "high", "urgent"]), neededBy: iso(addDays(created, between(10, 30))),
      createdAt: iso(created), justification: `Required for ongoing ${deptOf[requesterId]?.toLowerCase() ?? "operations"} work. Quantities based on current consumption and open production orders.`,
      items, approvals, timeline, rfqId: null,
    });
  });

  // ───────── RFQs & quotations ─────────
  const rfqs: Rfq[] = [];
  const quotations: Quotation[] = [];
  const rfqSources = requests.filter((r) => r.status === "converted_to_rfq" || (r.status === "completed" && rfqs.length < 0));
  const extra = requests.filter((r) => r.status === "completed").slice(0, 3);
  const rfqPlan: { req: PurchaseRequest; status: Rfq["status"] }[] = [
    ...extra.map((req) => ({ req, status: "awarded" as const })),
    ...rfqSources.map((req, i) => ({ req, status: (["evaluating", "sent", "evaluating", "sent", "draft"] as const)[i] ?? "sent" })),
  ];
  rfqPlan.forEach(({ req, status }, i) => {
    const id = `rfq${i + 1}`;
    const created = addDays(new Date(req.createdAt), 3);
    const pool = suppliersByCat(req.categoryId);
    const extraPool = suppliers.filter((s) => !pool.includes(s) && s.categoryIds.some((c) => c === "c1" || c === "c6")).slice(0, 2);
    const invited = [...pool, ...(pool.length < 3 ? extraPool : [])].slice(0, 4);
    const daysSince = Math.max(0, Math.round((today.getTime() - created.getTime()) / 86400000));
    const invites: RfqInvite[] = invited.map((s, j) => {
      let st: RfqInvite["status"] = "sent";
      if (status === "awarded" || status === "evaluating") st = j === invited.length - 1 && invited.length > 3 ? "declined" : "quoted";
      else if (status === "sent") st = j === 0 ? "quoted" : j === 1 ? "viewed" : daysSince > 3 && j === 2 ? "quoted" : "sent";
      return { supplierId: s.id, status: st, sentAt: iso(created), respondedAt: st === "quoted" || st === "declined" ? iso(addDays(created, j + 1)) : null };
    });
    const rfq: Rfq = {
      id, number: `RFQ-${created.getFullYear()}-${String(60 + i).padStart(4, "0")}`, title: req.title, requestId: req.id,
      categoryId: req.categoryId, status, createdAt: iso(created), dueDate: iso(addDays(created, 7)), ownerId: "m2",
      items: req.items.map((it) => ({ ...it, id: `${id}-${it.id}` })), invites, awardedQuotationId: null,
      notes: "Prices to be quoted ex-works with GST shown separately. Mention delivery lead time and payment terms.",
    };
    if (status !== "draft") {
      invites.filter((inv) => inv.status === "quoted").forEach((inv, j) => {
        const monthsAgo = Math.round(daysSince / 30);
        const qid = `q${quotations.length + 1}`;
        const sp = suppliers.find((s) => s.id === inv.supplierId) as Supplier;
        quotations.push({
          id: qid, rfqId: id, supplierId: inv.supplierId, receivedAt: inv.respondedAt as string,
          lines: rfq.items.map((it) => ({ materialId: it.materialId, qty: it.qty, unitPrice: priceAt(it.materialId, inv.supplierId, monthsAgo) })),
          gstRate: materials.find((m) => m.id === rfq.items[0]?.materialId)?.gstRate ?? 18,
          shipping: [0, 2500, 4500, 1800][j % 4] ?? 0, otherCharges: j === 2 ? 1200 : 0,
          deliveryDays: [7, 10, 5, 12][j % 4] ?? 7, paymentTermsDays: sp.paymentTermsDays,
          validUntil: iso(addDays(created, 30)), notes: j === 0 ? "Prices firm for 15 days. Freight extra at actuals." : "",
        });
      });
    }
    req.rfqId = id;
    rfqs.push(rfq);
  });
  // Awarded RFQs get POs linked to their cheapest quotation
  rfqs.filter((r) => r.status === "awarded").forEach((r, i) => {
    const qs = quotations.filter((q) => q.rfqId === r.id);
    const best = [...qs].sort((a, b) => a.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) + a.shipping - (b.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) + b.shipping))[0];
    if (!best) return;
    r.awardedQuotationId = best.id;
    const po = purchaseOrders.find((p) => p.categoryId === r.categoryId && !p.rfqId && new Date(p.createdAt) > new Date(r.createdAt)) ?? purchaseOrders[purchaseOrders.length - 3 - i];
    if (po) { po.rfqId = r.id; po.quotationId = best.id; po.requestId = r.requestId; po.supplierId = best.supplierId; }
  });

  // ───────── Notifications, activity, invitations, rules ─────────
  const pending = requests.filter((r) => r.status === "pending_approval");
  const notifications: AppNotification[] = [
    ...pending.slice(0, 4).map((r, i) => ({
      id: `n${i + 1}`, kind: "approval" as const, title: `${r.number} needs your approval`,
      body: `${members.find((m) => m.id === r.requesterId)?.name} requested “${r.title}”.`, at: iso(addHoursSafe(subDays(today, i), 9 - i)), read: i > 1,
      link: { to: `requests/${r.id}`, label: "Review request" },
    })),
    { id: "n10", kind: "rfq", title: "New quotation received", body: "Kaveri Packaging Solutions responded to an open RFQ.", at: ago(1, 15), read: false, link: { to: "rfqs", label: "Open RFQs" } },
    { id: "n11", kind: "insight", title: "Price increase detected", body: "MS Plate 6mm unit price rose across the last purchase orders.", at: ago(1, 11), read: false, link: { to: "insights", label: "View insight" } },
    { id: "n12", kind: "po", title: "Delivery overdue", body: "A purchase order with Mahalaxmi Electricals is past its expected date.", at: ago(2, 10), read: true, link: { to: "purchase-orders", label: "View orders" } },
    { id: "n13", kind: "team", title: "Neha Kapoor joined the workspace", body: "Invited as Employee in Administration.", at: ago(5, 12), read: true, link: { to: "team", label: "View team" } },
    { id: "n14", kind: "system", title: "Monthly spend report is ready", body: "October spend analytics are available to export.", at: ago(9, 9), read: true, link: { to: "analytics", label: "Open analytics" } },
  ];

  const activity: ActivityItem[] = [
    ...requests.slice(-8).reverse().map((r, i) => ({ id: `a${i}`, actorId: r.requesterId, verb: r.status === "draft" ? "drafted" : "submitted", target: r.number, targetKind: "purchase_request" as const, targetId: r.id, at: r.createdAt })),
    ...rfqs.slice(-3).map((r, i) => ({ id: `ar${i}`, actorId: "m2", verb: r.status === "draft" ? "created RFQ" : "sent RFQ", target: r.number, targetKind: "rfq" as const, targetId: r.id, at: r.createdAt })),
    ...purchaseOrders.slice(-5).map((p, i) => ({ id: `ap${i}`, actorId: p.createdById, verb: p.status === "draft" ? "drafted" : "issued", target: p.number, targetKind: "purchase_order" as const, targetId: p.id, at: p.createdAt })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const invitations: Invitation[] = [
    { id: "inv1", email: "meera.pillai@sharmaprecision.in", role: "approver", invitedById: "m1", sentAt: ago(2), status: "pending" },
    { id: "inv2", email: "accounts@sharmaprecision.in", role: "finance_manager", invitedById: "m3", sentAt: ago(16), status: "expired" },
  ];

  const approvalRules: ApprovalRule[] = [
    { id: "ar1", name: "Department head approval", condition: { field: "amount", operator: "gt", value: "0" }, approverRoles: ["approver"], levels: 1, active: true },
    { id: "ar2", name: "Finance approval above ₹2,00,000", condition: { field: "amount", operator: "gt", value: "200000" }, approverRoles: ["finance_manager"], levels: 2, active: true },
    { id: "ar3", name: "IT purchases need owner sign-off", condition: { field: "category", operator: "eq", value: "c4" }, approverRoles: ["owner"], levels: 2, active: false },
  ];

  return { organizations, members, categories, suppliers, materials, requests, rfqs, quotations, purchaseOrders, notifications, activity, invitations, approvalRules };
}
