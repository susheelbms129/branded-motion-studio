import { Link, useNavigate } from "@tanstack/react-router";
import type { ComponentProps } from "react";

/** App-relative link: to="requests/123" → /buyer/dashboard/requests/123 ; to="" → /buyer/dashboard */
export const appPath = (path = "") => `/buyer/dashboard${path ? `/${path}` : ""}`;
export function AppLink({
  to = "",
  ...rest
}: { to?: string } & Omit<ComponentProps<typeof Link>, "to">) {
  return <Link to={appPath(to) as never} preload="intent" {...(rest as object)} />;
}
export function useAppNavigate() {
  const nav = useNavigate();
  return (path = "", search?: Record<string, string>) =>
    void nav({ to: appPath(path) as never, ...(search ? { search: search as never } : {}) });
}
