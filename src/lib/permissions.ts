import type { Role } from "@/types/domain";

export type Permission =
  | "request.create"
  | "request.approve"
  | "rfq.manage"
  | "quotation.manage"
  | "po.create"
  | "po.approve"
  | "supplier.manage"
  | "material.manage"
  | "analytics.view"
  | "insights.manage"
  | "team.manage"
  | "settings.manage"
  | "billing.manage";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner / Admin",
  procurement_manager: "Procurement Manager",
  finance_manager: "Finance Manager",
  approver: "Approver",
  employee: "Employee",
};

export const ROLES: Role[] = ["owner", "procurement_manager", "finance_manager", "approver", "employee"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "request.create", "request.approve", "rfq.manage", "quotation.manage", "po.create", "po.approve",
    "supplier.manage", "material.manage", "analytics.view", "insights.manage", "team.manage",
    "settings.manage", "billing.manage",
  ],
  procurement_manager: [
    "request.create", "request.approve", "rfq.manage", "quotation.manage", "po.create",
    "supplier.manage", "material.manage", "analytics.view", "insights.manage",
  ],
  finance_manager: ["request.create", "request.approve", "po.approve", "analytics.view", "insights.manage", "billing.manage"],
  approver: ["request.create", "request.approve", "analytics.view"],
  employee: ["request.create"],
};

export const PERMISSION_LABEL: Record<Permission, string> = {
  "request.create": "Create purchase requests",
  "request.approve": "Approve purchase requests",
  "rfq.manage": "Create and send RFQs",
  "quotation.manage": "Enter and compare quotations",
  "po.create": "Create purchase orders",
  "po.approve": "Approve purchase orders",
  "supplier.manage": "Manage saved suppliers",
  "material.manage": "Manage products & materials",
  "analytics.view": "View spend analytics",
  "insights.manage": "Act on AI insights",
  "team.manage": "Manage team & roles",
  "settings.manage": "Manage organization settings",
  "billing.manage": "Manage billing",
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
