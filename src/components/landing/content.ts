import { Boxes, ClipboardCheck, FileSpreadsheet, Gauge, History, LineChart, ReceiptText, Scale, ShieldCheck, Sparkles, Truck, Users, Wallet, type LucideIcon } from "lucide-react";

export const BRAND = {
  lockup: "/brand/vendora-logo.png",
  mark: "/__l5e/assets-v1/e5384986-52a0-450d-a108-8f833b3c727b/vendora-mark.png",
};

export interface MenuItem {
  title: string;
  desc: string;
  href: string;
  icon: LucideIcon;
}
export interface MenuGroup {
  label: string;
  blurb: string;
  items: MenuItem[];
}

export const MENUS: MenuGroup[] = [
  {
    label: "Platform",
    blurb: "One trail from the first request to the last invoice.",
    items: [
      { title: "Vendora Flow", desc: "Six stages, zero side-channels", href: "#flow", icon: ClipboardCheck },
      { title: "Landed-Cost Lab", desc: "Compare quotes with GST and freight", href: "#lab", icon: Scale },
      { title: "Supplier Scorecards", desc: "Scores built from real deliveries", href: "#platform", icon: Truck },
      { title: "AI Insights", desc: "Every alert shows its evidence", href: "#insights", icon: Sparkles },
      { title: "Approval Rules", desc: "Limits and sign-offs that enforce themselves", href: "#platform", icon: ShieldCheck },
      { title: "Audit Trail", desc: "Who did what, and when", href: "#platform", icon: History },
    ],
  },
  {
    label: "Solutions",
    blurb: "Built around the people who actually touch a purchase.",
    items: [
      { title: "Procurement teams", desc: "RFQs, quotes and POs in one desk", href: "#roles", icon: FileSpreadsheet },
      { title: "Finance leaders", desc: "Budgets, GST and payment terms", href: "#roles", icon: Wallet },
      { title: "Approvers on the move", desc: "Decide in seconds, with context", href: "#roles", icon: Gauge },
      { title: "Founders and owners", desc: "See spend without chasing people", href: "#roles", icon: Users },
    ],
  },
  {
    label: "Resources",
    blurb: "Answers before you ask for a call.",
    items: [
      { title: "How scoring works", desc: "The exact weights, in the open", href: "#platform", icon: LineChart },
      { title: "Questions, answered", desc: "Security, GST, rollout", href: "#faq", icon: ShieldCheck },
      { title: "Plans", desc: "Starter, Growth, Enterprise", href: "#plans", icon: Boxes },
      { title: "Book a walkthrough", desc: "Thirty minutes, your data shape", href: "#demo", icon: ReceiptText },
    ],
  },
];

export const FLOW_STEPS = [
  {
    key: "request",
    title: "Raise it",
    kicker: "Purchase request",
    body: "Anyone on the floor describes what they need. Vendora attaches the category, budget line and the right approver before it leaves their screen.",
    panel: { title: "Request PR-0412", tag: "Draft", tone: "blue", rows: [["Item", "Hydraulic hose, 1/2 in"], ["Quantity", "40 pcs"], ["Budget line", "MRO & Tools"], ["Needed by", "28 Nov"]], foot: "Routed to Kavya Iyer for approval" },
  },
  {
    key: "approve",
    title: "Approve it",
    kicker: "Approval chain",
    body: "Rules you set decide who signs. Small spends clear in a tap; large ones climb to Finance with the numbers already in front of them.",
    panel: { title: "Approval chain", tag: "In review", tone: "amber", rows: [["Level 1", "Department head · Approved"], ["Level 2", "Finance · Waiting"], ["Rule", "Above ₹2,00,000"], ["Waiting", "3 hours"]], foot: "Finance gets a nudge at 24 hours" },
  },
  {
    key: "source",
    title: "Source it",
    kicker: "RFQ",
    body: "Send one RFQ to every shortlisted supplier. Responses land in the same sheet, so nothing hides in a personal inbox.",
    panel: { title: "RFQ-2026-031", tag: "Live", tone: "violet", rows: [["Invited", "5 suppliers"], ["Quoted", "4 so far"], ["Closes", "Tomorrow, 6 pm"], ["Reminders", "Sent automatically"]], foot: "One supplier has not opened it yet" },
  },
  {
    key: "compare",
    title: "Compare it",
    kicker: "Quotation comparison",
    body: "Unit price is only the start. Vendora adds GST, freight and charges, then ranks by the weights you chose.",
    panel: { title: "Best overall: Supplier C", tag: "Ranked", tone: "emerald", rows: [["Lowest landed", "₹2,48,450"], ["Fastest", "6 days"], ["Terms", "45 days"], ["Score gap", "+7.4 points"]], foot: "Reasons are written out, not hidden in a score" },
  },
  {
    key: "order",
    title: "Order it",
    kicker: "Purchase order",
    body: "The winning quote becomes a purchase order in one click. Lines, GST, delivery address and terms carry over untouched.",
    panel: { title: "PO-2026-718", tag: "Issued", tone: "cyan", rows: [["Supplier", "Supplier C"], ["Total", "₹2,48,450"], ["Expected", "19 Nov"], ["Terms", "Net 45"]], foot: "Sent to the supplier with a read receipt" },
  },
  {
    key: "review",
    title: "Learn from it",
    kicker: "Delivery and review",
    body: "Receipts are matched to the order. On-time delivery feeds the supplier's scorecard, so the next RFQ is sharper than this one.",
    panel: { title: "Delivered 18 Nov", tag: "On time", tone: "emerald", rows: [["Ordered", "500 units"], ["Received", "500 units"], ["Delay", "None"], ["Scorecard", "Updated"]], foot: "Next RFQ remembers this delivery" },
  },
] as const;

export const FAQ = [
  { q: "Does Vendora understand GST and Indian number formats?", a: "Yes. Totals use Indian digit grouping (₹12,50,000), large figures shorten to lakh and crore, and every quote is compared after GST, freight and other charges rather than on unit price alone." },
  { q: "How is a supplier score calculated?", a: "Half from on-time delivery, thirty percent from price against the median quote on the same RFQ, and twenty percent from how often they respond. A supplier with fewer than two deliveries shows no score at all, because a guess would mislead you." },
  { q: "Are the AI Insights just guesses?", a: "No. Every insight lists the purchase orders, quotes or requests it was built from, explains why it was flagged, and shows a confidence level based on how much evidence exists. An impact amount appears only when it can be computed from your records." },
  { q: "Who can see and approve what?", a: "Five roles — Owner, Procurement Manager, Finance Manager, Approver and Employee — with thirteen individually defined permissions. Open the role explorer above to see exactly what each one can do." },
  { q: "Can we set our own approval limits?", a: "Yes. Rules can trigger on amount, category or department, can require several levels, and can be switched on or off without touching anything else." },
  { q: "How do we get started?", a: "Book a walkthrough. We load a workspace shaped like your categories, suppliers and approval chain, so you judge Vendora on something that looks like your own purchasing." },
];

export const PLANS = [
  { name: "Starter", who: "A small team ending purchases-by-WhatsApp", points: ["Purchase requests and approvals", "RFQs and quotation comparison", "Purchase orders with GST", "Core supplier directory"], accent: "cyan" as const },
  { name: "Growth", who: "Procurement as a real function", points: ["Everything in Starter", "Supplier scorecards", "AI Insights with evidence", "Multi-level approval rules", "Spend analytics by category"], accent: "violet" as const, featured: true },
  { name: "Enterprise", who: "Several units, strict controls", points: ["Everything in Growth", "Custom roles and permissions", "Full audit trail", "Dedicated rollout support", "Priority response"], accent: "magenta" as const },
];

export const FOOTER_COLS = [
  { title: "Platform", links: [["Vendora Flow", "#flow"], ["Landed-Cost Lab", "#lab"], ["Supplier Scorecards", "#platform"], ["AI Insights", "#insights"]] },
  { title: "Solutions", links: [["Procurement", "#roles"], ["Finance", "#roles"], ["Approvers", "#roles"], ["Owners", "#roles"]] },
  { title: "Company", links: [["Plans", "#plans"], ["Questions", "#faq"], ["Book a demo", "#demo"]] },
];
