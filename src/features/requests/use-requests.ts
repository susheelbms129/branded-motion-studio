import { useQuery } from "@tanstack/react-query";

import { countMyPendingApprovals, listRequests, type RequestRow } from "@/lib/requests-api";
import { useUi } from "@/lib/ui-store";

/** Anything that changes a request invalidates this key prefix, so lists, details and counts all refresh together. */
export const REQUESTS_KEY = "requests";

/** How many requests are waiting for THIS person's decision (the sidebar badge). Zero in the demo workspace. */
export function usePendingApprovals(): number {
  const orgId = useUi((s) => s.orgId);
  const q = useQuery({
    queryKey: [REQUESTS_KEY, "pending-count", orgId],
    queryFn: () => countMyPendingApprovals(orgId!),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });
  return q.data ?? 0;
}

export interface RequestsSummary {
  loading: boolean;
  /** All requests the company has ever raised. */
  total: number;
  /** Requests currently waiting for any approval. */
  pendingCount: number;
  /** The newest few that are waiting. */
  pending: RequestRow[];
}

/** The buyer dashboard's view of requests, straight from the database. Empty in the demo workspace. */
export function useRequestsSummary(): RequestsSummary {
  const orgId = useUi((s) => s.orgId);
  const q = useQuery({
    queryKey: [REQUESTS_KEY, "summary", orgId],
    queryFn: async () => {
      const [all, pending] = await Promise.all([
        listRequests(orgId!, "all", 1, 0),
        listRequests(orgId!, "pending_approval", 5, 0),
      ]);
      return { total: all.total, pendingCount: pending.total, pending: pending.items };
    },
    enabled: !!orgId,
  });
  return {
    loading: !!orgId && q.isLoading,
    total: q.data?.total ?? 0,
    pendingCount: q.data?.pendingCount ?? 0,
    pending: q.data?.pending ?? [],
  };
}
