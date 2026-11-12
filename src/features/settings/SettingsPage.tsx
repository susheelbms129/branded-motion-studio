import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Can, PageHeader, Panel } from "@/components/vendora/kit";
import { setActiveCurrency, type CurrencyCode } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/permissions";
import { useUi } from "@/lib/ui-store";
import { useWs } from "@/lib/ws-store";

const PLANS = [
  { name: "Starter", price: "₹0", note: "Up to 3 users · 25 POs/month" },
  { name: "Growth", price: "₹4,999/mo", note: "Up to 25 users · unlimited POs · insights" },
  { name: "Enterprise", price: "Custom", note: "SSO, audit logs, ERP integrations" },
];

export function SettingsPage() {
  const ws = useWs();
  const org = ws.organizations[0]!;
  const [f, setF] = useState({
    name: org.name,
    industry: org.industry,
    city: org.city,
    gstin: org.gstin,
    currency: org.currency,
  });
  const { theme, toggleTheme } = useUi();
  const save = () => {
    ws.updateOrg({ ...f, currency: f.currency as CurrencyCode });
    setActiveCurrency(f.currency as CurrencyCode);
    toast.success("Organization settings saved");
  };
  return (
    <>
      <PageHeader
        title="Settings"
        accent="indigo"
        crumbs={[{ label: "Settings" }]}
        description="Organization profile, approval rules, appearance and plan."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Organization">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="o1">Company name</Label>
                <Input
                  id="o1"
                  className="mt-1.5"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o2">Industry</Label>
                <Input
                  id="o2"
                  className="mt-1.5"
                  value={f.industry}
                  onChange={(e) => setF({ ...f, industry: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o3">City</Label>
                <Input
                  id="o3"
                  className="mt-1.5"
                  value={f.city}
                  onChange={(e) => setF({ ...f, city: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="o4">GSTIN</Label>
                <Input
                  id="o4"
                  className="mt-1.5"
                  value={f.gstin}
                  onChange={(e) => setF({ ...f, gstin: e.target.value })}
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Select
                  value={f.currency}
                  onValueChange={(v) => setF({ ...f, currency: v as CurrencyCode })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["INR", "USD", "EUR", "AED"] as const).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Can permission="settings.manage">
              <Button className="mt-5" onClick={save}>
                Save changes
              </Button>
            </Can>
          </Panel>
          <Panel title="Approval rules" description="Who must approve a purchase request, and when">
            <ul className="space-y-2">
              {ws.approvalRules.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-xl border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.levels} level{r.levels > 1 ? "s" : ""} ·{" "}
                      {r.approverRoles.map((x) => ROLE_LABEL[x]).join(", ")}
                    </div>
                  </div>
                  <Can permission="settings.manage">
                    <Switch
                      checked={r.active}
                      onCheckedChange={() => ws.toggleRule(r.id)}
                      aria-label={`Toggle ${r.name}`}
                    />
                  </Can>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Appearance">
            <div className="flex items-center justify-between text-sm">
              <span>Dark mode</span>
              <Switch
                checked={theme === "dark"}
                onCheckedChange={toggleTheme}
                aria-label="Dark mode"
              />
            </div>
          </Panel>
          <Panel title="Plan & billing">
            <ul className="space-y-2">
              {PLANS.map((p) => (
                <li
                  key={p.name}
                  className={`rounded-xl border p-3 ${p.name === org.plan ? "border-primary/40 bg-primary/5" : ""}`}
                >
                  <div className="flex justify-between text-sm font-medium">
                    <span>{p.name}</span>
                    <span className="tabular">{p.price}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{p.note}</div>
                  {p.name === org.plan ? (
                    <div className="mt-1 text-[11px] font-medium text-primary">Current plan</div>
                  ) : (
                    <Can permission="billing.manage">
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => {
                          ws.updateOrg({ plan: p.name as typeof org.plan });
                          toast.success(`Switched to ${p.name}`);
                        }}
                      >
                        Switch
                      </Button>
                    </Can>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
