"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type StoredStage = NonNullable<Doc<"workspaces">["stage"]>;

const PRESETS = [
  { value: "account_setup", label: "Account setup", dot: "bg-amber-500" },
  { value: "development", label: "Development", dot: "bg-sky-500" },
  { value: "testing", label: "Testing", dot: "bg-indigo-500" },
  { value: "feedback", label: "Feedback", dot: "bg-orange-500" },
  { value: "live", label: "Live", dot: "bg-emerald-500" },
] as const satisfies ReadonlyArray<{ value: StoredStage; label: string; dot: string }>;

export const WORKSPACE_STAGES = PRESETS;
export const displayedStage = selected;

type Stage = (typeof PRESETS)[number]["value"] | "custom";

function selected(stage: StoredStage | undefined): Stage {
  const known = PRESETS.find((preset) => preset.value === stage);
  if (known) return known.value;
  return stage === "custom" ? "custom" : PRESETS[0].value;
}

function describe(stage: StoredStage | undefined, label: string | undefined) {
  if (stage === "custom") {
    return { label: label || "Custom", dot: "bg-violet-500" };
  }
  return PRESETS.find((preset) => preset.value === stage) ?? PRESETS[0];
}

export function WorkspaceStageBadge({
  stage,
  label,
  className,
}: {
  stage?: StoredStage;
  label?: string;
  className?: string;
}) {
  const shown = describe(stage, label);
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", shown.dot)} />
      <span className="max-w-32 truncate">{shown.label}</span>
    </Badge>
  );
}

export function WorkspaceStagePicker({
  workspaceId,
  name,
  stage,
  label,
}: {
  workspaceId: Id<"workspaces">;
  name: string;
  stage?: StoredStage;
  label?: string;
}) {
  const setStage = useMutation(api.workspaces.setStage);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (next: Stage, nextLabel?: string) => {
    setBusy(true);
    try {
      await setStage({ workspaceId, stage: next, label: nextLabel });
      setCustomOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not change the stage",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Stage of ${name}`}
              className="inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <WorkspaceStageBadge stage={stage} label={label} />
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto min-w-48">
          <DropdownMenuRadioGroup
            value={selected(stage)}
            onValueChange={(next) => {
              if (next !== "custom") void save(next as Stage);
            }}
          >
            {PRESETS.map((preset) => (
              <DropdownMenuRadioItem key={preset.value} value={preset.value}>
                <span className={cn("size-1.5 rounded-full", preset.dot)} />
                {preset.label}
              </DropdownMenuRadioItem>
            ))}
            {stage === "custom" ? (
              <DropdownMenuRadioItem value="custom">
                <span className="size-1.5 rounded-full bg-violet-500" />
                {label || "Custom"}
              </DropdownMenuRadioItem>
            ) : null}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setDraft(stage === "custom" ? (label ?? "") : "");
              setCustomOpen(true);
            }}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} /> Custom stage…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Custom stage</DialogTitle>
            <DialogDescription>
              Where {name} is, in your own words.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void save("custom", draft);
            }}
          >
            <Label htmlFor="ws-stage">Stage name</Label>
            <Input
              id="ws-stage"
              value={draft}
              maxLength={40}
              placeholder="Stage name"
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
            />
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !draft.trim()}
              onClick={() => void save("custom", draft)}
            >
              {busy ? <Spinner /> : null} Save stage
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
