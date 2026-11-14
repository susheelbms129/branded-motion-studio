import { Bookmark, BookmarkCheck } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { useSaved } from "@/lib/saved-store";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

/**
 * Save a supplier to the company's shortlist. Owners and procurement managers can save and remove; everyone else on the
 * team sees the "Saved" mark but no button. The database enforces the same rule, so hiding the button is only manners.
 */
export function SaveButton({ supplierId, name, full = false }: { supplierId: string; name: string; full?: boolean }) {
  const orgId = useUi((s) => s.orgId);
  const role = useUi((s) => s.role);
  const saved = useSaved((s) => s.ids.has(supplierId));
  const working = useSaved((s) => s.busy.has(supplierId));
  const status = useSaved((s) => s.status);
  const load = useSaved((s) => s.load);

  useEffect(() => {
    if (orgId) void load(orgId);
  }, [orgId, load]);

  // The demo workspace has no real company, so there is nothing to save into.
  if (!orgId || status === "error") return null;
  if (!can(role, "supplier.manage")) {
    return saved ? (
      <span className="inline-flex items-center gap-1.5 rounded-full tint-emerald px-2.5 py-1 text-xs font-semibold">
        <BookmarkCheck className="size-3.5" aria-hidden /> Saved
      </span>
    ) : null;
  }

  async function toggle() {
    if (!orgId) return;
    try {
      const nowSaved = await useSaved.getState().toggle(orgId, supplierId);
      toast.success(nowSaved ? `${name} saved` : `${name} removed`, {
        action: { label: "Undo", onClick: () => void useSaved.getState().toggle(orgId, supplierId).catch(() => undefined) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We couldn't update your saved suppliers.");
    }
  }

  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <Button
      type="button"
      variant={saved ? "secondary" : "outline"}
      size={full ? "default" : "icon"}
      onClick={() => void toggle()}
      disabled={working || status === "loading"}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved suppliers` : `Save ${name}`}
      title={saved ? "Saved. Click to remove" : "Save to your shortlist"}
      className={cn("relative z-10", saved && "text-primary")}
    >
      <Icon className={cn(saved && "fill-current/20")} />
      {full ? (saved ? "Saved" : "Save supplier") : null}
    </Button>
  );
}
