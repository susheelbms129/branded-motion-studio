/**
 * The supplier workspace menu. Plain data on purpose, so a test can prove that it never contains a buyer page.
 * `to: null` means the page is not built yet: it shows as "Soon" and is not a link, so nobody lands on a dead page.
 *
 * A supplier owns their own company data. They never see buyer tools (requests, RFQs, purchase orders, shortlists, spend),
 * and buyers never see this menu. The database enforces the same split; this file only decides what is shown.
 */
export const SUPPLIER_NAV = [
  { key: "dashboard", label: "Dashboard", to: "/supplier/dashboard" },
  { key: "quotes", label: "Quote requests", to: "/supplier/quote-requests" },
  { key: "orders", label: "Orders received", to: "/supplier/orders" },
  { key: "payments", label: "Getting paid", to: "/supplier/payments" },
  { key: "passport", label: "Trust Passport", to: "/supplier/verification" },
  { key: "rank", label: "Fair Rank", to: "/supplier/fair-rank" },
  { key: "products", label: "Products", to: "/supplier/products" },
  { key: "profile", label: "Company profile", to: "/supplier/profile" },
] as const;

export type SupplierNavKey = (typeof SUPPLIER_NAV)[number]["key"];

/** The browser event a page fires after the supplier answers a quote request, so the menu badge refreshes. */
export const QUOTES_CHANGED = "vendora:quotes-changed";
