import {
  BarChart3,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  Package,
  ReceiptText,
  Scale,
  Settings,
  Sparkles,
  Truck,
  Users,
  Bell,
  type LucideIcon,
} from "lucide-react";

import type { Accent } from "@/types/domain";

export type ModuleKey =
  | "dashboard"
  | "requests"
  | "rfqs"
  | "quotations"
  | "purchaseOrders"
  | "suppliers"
  | "materials"
  | "analytics"
  | "insights"
  | "team"
  | "notifications"
  | "settings";

export const MODULES: Record<ModuleKey, { label: string; icon: LucideIcon; accent: Accent; path: string; shortcut?: string }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard, accent: "blue", path: "", shortcut: "O" },
  requests: { label: "Purchase Requests", icon: ClipboardList, accent: "blue", path: "requests", shortcut: "R" },
  rfqs: { label: "RFQs", icon: FileSpreadsheet, accent: "violet", path: "rfqs", shortcut: "Q" },
  quotations: { label: "Quotations", icon: Scale, accent: "cyan", path: "rfqs" },
  purchaseOrders: { label: "Purchase Orders", icon: ReceiptText, accent: "emerald", path: "purchase-orders", shortcut: "P" },
  suppliers: { label: "Suppliers", icon: Truck, accent: "amber", path: "suppliers", shortcut: "S" },
  materials: { label: "Products & Materials", icon: Package, accent: "pink", path: "materials" },
  analytics: { label: "Spend Analytics", icon: BarChart3, accent: "indigo", path: "analytics" },
  insights: { label: "AI Insights", icon: Sparkles, accent: "ai", path: "insights" },
  team: { label: "Team & Permissions", icon: Users, accent: "cyan", path: "team" },
  notifications: { label: "Notifications", icon: Bell, accent: "coral", path: "notifications" },
  settings: { label: "Settings", icon: Settings, accent: "indigo", path: "settings" },
};
