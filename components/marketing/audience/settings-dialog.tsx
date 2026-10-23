"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isBuiltIn } from "@/convex/lib/audience";
import { ConfirmButton } from "@/components/marketing/calendar";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { fail, type Category } from "./shared";

export const MAX_CATEGORIES = 10;

const CAP_OPTIONS = [
  { value: "0", label: "No limit" },
  ...[1, 2, 3, 4, 5, 7].map((n) => ({
    value: String(n),
    label: `${n} per person a week`,
  })),
];

export function weeklyLimitLabel(cap: number) {
  return `Weekly limit: ${cap > 0 ? `${cap} per person` : "none"}`;
}

function keyFor(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "category";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

function useSaveSettings() {
  const workspace = useWorkspace();
  const saveSettings = useMutation(api.marketing.saveAudienceSettings);
  const [busy, setBusy] = useState(false);
  const save = async (weeklyCap: number, categories: Category[], done: string) => {
    setBusy(true);
    try {
      await saveSettings({ workspaceId: workspace._id, weeklyCap, categories });
      toast.add({ title: done, type: "success" });
      return true;
    } catch (error) {
      fail("Could not save", error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

export function CategoryDialog({
  categories,
  weeklyCap,
  editing,
  onClose,
  onRemoved,
}: {
  categories: Category[];
  weeklyCap: number;
  editing: Category | null;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const custom = categories.filter((c) => !isBuiltIn(c.key));
  const [label, setLabel] = useState(editing?.label ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [tried, setTried] = useState(false);
  const { busy, save } = useSaveSettings();

  const name = label.trim();
  const lower = name.toLowerCase();
  const problem = !name
    ? "Give it a name."
    : categories.some((c) => isBuiltIn(c.key) && c.label.toLowerCase() === lower)
      ? `${name} is built in. Pick another name.`
      : custom.some((c) => c.key !== editing?.key && c.label.trim().toLowerCase() === lower)
        ? "Another category has this name."
        : null;

  const submit = async () => {
    setTried(true);
    if (problem) return;
    const fields = { label: name, description: description.trim() };
    const next = editing
      ? custom.map((c) => (c.key === editing.key ? { ...c, ...fields } : c))
      : [...custom, { ...fields, key: keyFor(name, new Set([...categories.map((c) => c.key), "unknown"])) }];
    if (await save(weeklyCap, next, editing ? "Category saved" : "Category added")) onClose();
  };

  const remove = async () => {
    if (!editing) return;
    const next = custom.filter((c) => c.key !== editing.key);
    if (await save(weeklyCap, next, "Category removed")) {
      onRemoved?.();
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            A group contacts are sorted into alongside Complete and Incomplete — customers, leads,
            suppliers. Agent Check reads the description to decide who belongs here.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={label}
              maxLength={40}
              placeholder="Customers"
              aria-invalid={tried && problem ? true : undefined}
              onChange={(e) => setLabel(e.target.value)}
            />
            {tried && problem ? <p className="text-xs text-destructive">{problem}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-description">Who belongs here</Label>
            <Textarea
              id="category-description"
              rows={3}
              maxLength={300}
              value={description}
              placeholder="People who have bought from us at least once"
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Describe it the way you would explain it to a new colleague.
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          {editing ? (
            <ConfirmButton
              variant="ghost"
              className="text-destructive sm:mr-auto"
              disabled={busy}
              heading={`Remove ${editing.label}?`}
              description="Its contacts go back to being sorted into Complete or Incomplete automatically."
              confirmLabel="Remove"
              destructive
              onConfirm={remove}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} /> Remove
            </ConfirmButton>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : null} {editing ? "Save" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WeeklyLimitDialog({
  categories,
  weeklyCap,
  onClose,
}: {
  categories: Category[];
  weeklyCap: number;
  onClose: () => void;
}) {
  const [cap, setCap] = useState(String(weeklyCap));
  const { busy, save } = useSaveSettings();

  const submit = async () => {
    const custom = categories.filter((c) => !isBuiltIn(c.key));
    if (await save(Number(cap), custom, "Weekly limit saved")) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Weekly message limit</DialogTitle>
          <DialogDescription>How many campaign messages one person can get in seven days.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-1.5">
          <Label>Messages per person</Label>
          <SelectField aria-label="Messages per person" value={cap} onValueChange={setCap} options={CAP_OPTIONS} />
          <p className="text-xs text-muted-foreground">
            Campaigns and event reminders skip anyone who has already had this many in the last seven
            days. Birthday wishes are not counted. Meta limits marketing messages per person too, and
            sends past its limit fail.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
