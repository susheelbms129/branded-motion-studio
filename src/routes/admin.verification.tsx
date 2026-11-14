import { createFileRoute, redirect } from "@tanstack/react-router";

import { AdminVerificationPage } from "@/features/admin/AdminVerificationPage";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { isReviewer } from "@/lib/verification-api";

// Only people listed in the database's platform_admins table get in. Everyone else is sent away.
// This is just the door; every function behind it checks again in the database.
export const Route = createFileRoute("/admin/verification")({
  ssr: false,
  beforeLoad: async () => {
    if (!isSupabaseConfigured) throw redirect({ to: "/" });
    const { data } = await getSupabase().auth.getSession();
    if (!data.session?.user) throw redirect({ to: "/signin" });
    if (!(await isReviewer())) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Verification review — Vendora" }, { name: "robots", content: "noindex" }] }),
  component: AdminVerificationPage,
});
