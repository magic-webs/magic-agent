"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  GAP_DAYS,
  MAX_WAVES,
  isRecommended,
  recommendedPlan,
  validPlan,
  type WavePlan,
} from "@/convex/lib/rollout";
import { fail } from "@/components/marketing/format";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";

export const gapLabel = (days: number) => (days === 1 ? "Every day" : `Every ${days} days`);

export function WaveFields({
  plan,
  onChange,
  aside,
}: {
  plan: WavePlan;
  onChange: (patch: Partial<WavePlan>) => void;
  aside?: ReactNode;
}) {
  const total = plan.shares.reduce((sum, share) => sum + share, 0);
  const problem = validPlan(plan);
  const setShare = (index: number, value: number) =>
    onChange({ shares: plan.shares.map((share, i) => (i === index ? value : share)) });

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label>Wave sizes</Label>
        <div className="flex flex-wrap items-center gap-2">
          {plan.shares.map((share, index) => (
            <div key={index} className="flex items-center gap-1 rounded-lg border border-border py-1 pr-1 pl-2">
              <span className="text-xs text-muted-foreground">Wave {index + 1}</span>
              <Input
                aria-label={`Wave ${index + 1} percentage`}
                type="number"
                min={1}
                max={100}
                value={Number.isFinite(share) ? share : ""}
                onChange={(e) => setShare(index, Math.round(Number(e.target.value)))}
                className="h-7 w-16 text-right tabular-nums"
              />
              <span className="text-xs text-muted-foreground">%</span>
              {plan.shares.length > 1 ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove wave ${index + 1}`}
                  onClick={() => onChange({ shares: plan.shares.filter((_, i) => i !== index) })}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              ) : null}
            </div>
          ))}
          {plan.shares.length < MAX_WAVES ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange({ shares: [...plan.shares, Math.max(1, 100 - total)] })}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add wave
            </Button>
          ) : null}
        </div>
        <p className={cn("text-xs", total === 100 ? "text-muted-foreground" : "font-medium text-destructive")}>
          {total === 100 ? "Adds up to 100%." : (problem ?? `Adds up to ${total}%.`)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Days between waves</Label>
          <SelectField
            aria-label="Days between waves"
            value={String(plan.gapDays)}
            onValueChange={(value) => onChange({ gapDays: Number(value) })}
            options={GAP_DAYS.map((days) => ({ value: String(days), label: gapLabel(days) }))}
          />
        </div>
        {aside}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={plan.engagedFirst}
          onCheckedChange={(next) => onChange({ engagedFirst: next === true })}
        />
        <span>
          Most engaged contacts first
          <span className="block text-xs text-muted-foreground">
            People who replied, ordered or read recently go in the early waves. Their good response
            keeps your quality high for the colder contacts later.
          </span>
        </span>
      </label>
    </>
  );
}

export function WaveDefaultsDialog({ initial, onClose }: { initial: WavePlan; onClose: () => void }) {
  const workspace = useWorkspace();
  const saveDefaults = useMutation(api.marketing.saveRolloutDefaults);
  const [plan, setPlan] = useState<WavePlan>(initial);
  const [busy, setBusy] = useState(false);
  const problem = validPlan(plan);

  const save = async () => {
    setBusy(true);
    try {
      await saveDefaults({ workspaceId: workspace._id, ...plan });
      toast.add({ title: "Default waves saved", type: "success" });
      onClose();
    } catch (error) {
      fail("Could not save the waves", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Smart campaign waves</DialogTitle>
          <DialogDescription>
            Every new smart campaign in this workspace starts with these. You can still change them
            for one campaign when you review it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <WaveFields plan={plan} onChange={(patch) => setPlan({ ...plan, ...patch })} />
        </DialogBody>
        <DialogFooter>
          {isRecommended(plan) ? null : (
            <Button variant="ghost" className="sm:mr-auto" onClick={() => setPlan(recommendedPlan())}>
              Use recommended
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || Boolean(problem)}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
