/**
 * The supplier workspace menu. Plain data on purpose, so a test can prove that it never contains a buyer page.
 * `to: null` means the page is not built yet: it shows as "Soon" and is not a link, so nobody lands on a dead page.
 *
 * A supplier owns their own company data. They never see buyer tools (requests, RFQs, purchase orders, shortlists, spend),
 * and buyers never see this menu. The database enforces the same split; this file only decides what is shown.
 */
export const SUPPLIER_NAV = [
  { key: "dashboard", label: "Dashboard", to: "/supplier/dashboard" },
  { key: "passport", label: "Trust Passport", to: "/supplier/verification" },
  { key: "products", label: "Products", to: "/supplier/products" },
  { key: "profile", label: "Company profile", to: null },
] as const;

export type SupplierNavKey = (typeof SUPPLIER_NAV)[number]["key"];
