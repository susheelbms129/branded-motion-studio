export type Role = "owner" | "procurement_manager" | "finance_manager" | "approver" | "employee";

export type Accent =
  | "blue"
  | "cyan"
  | "violet"
  | "magenta"
  | "emerald"
  | "amber"
  | "coral"
  | "pink"
  | "indigo"
  | "ai";

export interface Organization {
  id: string;
  slug: string;
  name: string;
  plan: "Starter" | "Growth" | "Enterprise";
  industry: string;
  city: string;
  gstin: string;
  currency: "INR" | "USD" | "EUR" | "AED";
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  status: "active" | "invited" | "suspended";
  joinedAt: string;
  lastActiveAt: string;
  accent: Accent;
}

export interface Category {
  id: string;
  name: string;
  accent: Accent;
  monthlyBudget: number;
}

export interface SupplierContact {
  id: string;
  name: string;
  designation: string;
  email: string;
  phone: string;
  primary: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  city: string;
  state: string;
  gstin: string;
  categoryIds: string[];
  paymentTermsDays: number;
  since: string;
  status: "active" | "inactive" | "under_review";
  email: string;
  phone: string;
  website: string;
  contacts: SupplierContact[];
}

export interface Material {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  unit: string;
  gstRate: number;
  hsn: string;
  preferredSupplierId: string | null;
  description: string;
}

export interface LineItem {
  id: string;
  materialId: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

export type RequestStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "converted_to_rfq"
  | "completed";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface ApprovalStep {
  id: string;
  approverId: string;
  level: number;
  status: "pending" | "approved" | "rejected" | "waiting";
  at: string | null;
  comment: string | null;
}

export interface TimelineEvent {
  id: string;
  at: string;
  actorId: string;
  type:
    | "created"
    | "submitted"
    | "approved"
    | "rejected"
    | "commented"
    | "converted"
    | "sent"
    | "quoted"
    | "awarded"
    | "issued"
    | "acknowledged"
    | "received"
    | "closed"
    | "updated";
  text: string;
}

export interface PurchaseRequest {
  id: string;
  number: string;
  title: string;
  requesterId: string;
  department: string;
  categoryId: string;
  status: RequestStatus;
  priority: Priority;
  neededBy: string;
  createdAt: string;
  justification: string;
  items: LineItem[];
  approvals: ApprovalStep[];
  timeline: TimelineEvent[];
  rfqId: string | null;
}

export type RfqStatus = "draft" | "sent" | "evaluating" | "awarded" | "closed";
export type InviteStatus = "sent" | "viewed" | "quoted" | "declined";

export interface RfqInvite {
  supplierId: string;
  status: InviteStatus;
  sentAt: string;
  respondedAt: string | null;
}

export interface Rfq {
  id: string;
  number: string;
  title: string;
  requestId: string | null;
  categoryId: string;
  status: RfqStatus;
  createdAt: string;
  dueDate: string;
  ownerId: string;
  items: LineItem[];
  invites: RfqInvite[];
  awardedQuotationId: string | null;
  notes: string;
}

export interface QuotationLine {
  materialId: string;
  qty: number;
  unitPrice: number;
}

export interface Quotation {
  id: string;
  rfqId: string;
  supplierId: string;
  receivedAt: string;
  lines: QuotationLine[];
  gstRate: number;
  shipping: number;
  otherCharges: number;
  deliveryDays: number;
  paymentTermsDays: number;
  validUntil: string;
  notes: string;
}

export type PoStatus =
  | "draft"
  | "issued"
  | "acknowledged"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";

export interface PoLine {
  id: string;
  materialId: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  gstRate: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  rfqId: string | null;
  quotationId: string | null;
  requestId: string | null;
  categoryId: string;
  status: PoStatus;
  createdAt: string;
  issuedAt: string | null;
  expectedAt: string;
  deliveredAt: string | null;
  createdById: string;
  lines: PoLine[];
  shipping: number;
  otherCharges: number;
  paymentTermsDays: number;
  deliveryAddress: string;
  notes: string;
  history: TimelineEvent[];
}

export type InsightType =
  | "price_increase"
  | "repeated_delay"
  | "lower_landed_cost"
  | "possible_duplicate";
export type Severity = "high" | "medium" | "low";
export type InsightStatus = "open" | "dismissed" | "snoozed" | "resolved";

export interface EvidenceRef {
  kind: "purchase_order" | "purchase_request" | "rfq" | "quotation" | "supplier" | "material";
  id: string;
  label: string;
  detail: string;
}

export interface Insight {
  id: string;
  type: InsightType;
  severity: Severity;
  title: string;
  whatHappened: string;
  whyFlagged: string;
  confidence: number; // 0..1, derived from the amount of supporting evidence
  evidence: EvidenceRef[];
  suggestedAction: string;
  impactAmount: number | null; // only when directly computable from records
  status: InsightStatus;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  kind: "approval" | "rfq" | "po" | "insight" | "team" | "system";
  title: string;
  body: string;
  at: string;
  read: boolean;
  link: { to: string; label: string } | null;
}

export interface ActivityItem {
  id: string;
  actorId: string;
  verb: string;
  target: string;
  targetKind: EvidenceRef["kind"] | "member" | "settings";
  targetId: string | null;
  at: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedById: string;
  sentAt: string;
  status: "pending" | "expired";
}

export interface ApprovalRule {
  id: string;
  name: string;
  condition: { field: "amount" | "category" | "department"; operator: "gt" | "lt" | "eq"; value: string };
  approverRoles: Role[];
  levels: number;
  active: boolean;
}

export interface PriceHistoryPoint {
  date: string;
  unitPrice: number;
  supplierId: string;
  poId: string;
}
