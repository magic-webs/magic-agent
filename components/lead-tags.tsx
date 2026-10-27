"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LEAD_TAG_COLORS, type LeadTagColor } from "@/convex/lib/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  Delete02Icon,
  FloppyDiskIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  RoboticIcon,
  Tag01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type LeadTag = {
  _id: Id<"leadTags">;
  name: string;
  color: string;
  description: string;
  leadCount: number;
};

const TAG_TONES: Record<LeadTagColor, { chip: string; dot: string }> = {
  slate: {
    chip: "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-500/25 dark:bg-slate-500/15 dark:text-slate-200",
    dot: "bg-slate-500",
  },
  red: {
    chip: "border-red-200 bg-red-100 text-red-800 dark:border-red-500/25 dark:bg-red-500/15 dark:text-red-200",
    dot: "bg-red-500",
  },
  orange: {
    chip: "border-orange-200 bg-orange-100 text-orange-800 dark:border-orange-500/25 dark:bg-orange-500/15 dark:text-orange-200",
    dot: "bg-orange-500",
  },
  amber: {
    chip: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  green: {
    chip: "border-green-200 bg-green-100 text-green-800 dark:border-green-500/25 dark:bg-green-500/15 dark:text-green-200",
    dot: "bg-green-500",
  },
  teal: {
    chip: "border-teal-200 bg-teal-100 text-teal-800 dark:border-teal-500/25 dark:bg-teal-500/15 dark:text-teal-200",
    dot: "bg-teal-500",
  },
  sky: {
    chip: "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-500/25 dark:bg-sky-500/15 dark:text-sky-200",
    dot: "bg-sky-500",
  },
  violet: {
    chip: "border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-500/25 dark:bg-violet-500/15 dark:text-violet-200",
    dot: "bg-violet-500",
  },
  pink: {
    chip: "border-pink-200 bg-pink-100 text-pink-800 dark:border-pink-500/25 dark:bg-pink-500/15 dark:text-pink-200",
    dot: "bg-pink-500",
  },
};

function toneOf(color: string) {
  return TAG_TONES[color as LeadTagColor] ?? TAG_TONES.slate;
}

export function TagChip({ tag, className }: { tag: LeadTag; className?: string }) {
  return (
    <span
      title={tag.description || undefined}
      className={cn(
        "inline-flex max-w-40 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneOf(tag.color).chip,
        className
      )}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

export function TagChips({
  tagIds,
  tags,
}: {
  tagIds: Id<"leadTags">[];
  tags: LeadTag[];
}) {
  const shown = tags.filter((tag) => tagIds.includes(tag._id));
  if (shown.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((tag) => (
        <TagChip key={tag._id} tag={tag} />
      ))}
    </span>
  );
}

/** A submenu of checkboxes, for a lead's own actions menu. */
export function LeadTagsSubmenu({
  conversationId,
  tagIds,
  tags,
}: {
  conversationId: Id<"conversations">;
  tagIds: Id<"leadTags">[];
  tags: LeadTag[];
}) {
  const setTags = useMutation(api.leads.setTags);

  const toggle = async (tagId: Id<"leadTags">, on: boolean) => {
    try {
      await setTags({
        conversationId,
        tagIds: on ? [...tagIds, tagId] : tagIds.filter((id) => id !== tagId),
      });
    } catch (error) {
      toast.add({
        title: "Could not change the tags",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} /> Tags
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
        {tags.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No tags yet. Add them under Manage tags.
          </p>
        ) : (
          tags.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag._id}
              checked={tagIds.includes(tag._id)}
              onCheckedChange={(checked) => toggle(tag._id, checked)}
            >
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", toneOf(tag.color).dot)}
              />
              <span className="truncate">{tag.name}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function LeadTagsField({
  conversationId,
  tagIds,
  tags,
}: {
  conversationId: Id<"conversations">;
  tagIds: Id<"leadTags">[];
  tags: LeadTag[] | undefined;
}) {
  const setTags = useMutation(api.leads.setTags);

  const toggle = async (tagId: Id<"leadTags">, on: boolean) => {
    try {
      await setTags({
        conversationId,
        tagIds: on ? [...tagIds, tagId] : tagIds.filter((id) => id !== tagId),
      });
    } catch (error) {
      toast.add({
        title: "Could not change the tags",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Tags</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={tags === undefined}
            render={<Button size="xs" variant="ghost" className="text-muted-foreground" />}
          >
            <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} /> Edit
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto">
            {!tags?.length ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No tags yet. Add them on the Leads page.
              </p>
            ) : (
              tags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag._id}
                  checked={tagIds.includes(tag._id)}
                  onCheckedChange={(checked) => toggle(tag._id, checked)}
                >
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", toneOf(tag.color).dot)}
                  />
                  <span className="truncate">{tag.name}</span>
                </DropdownMenuCheckboxItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {tags === undefined ? (
        <Spinner className="size-3.5" />
      ) : tags.some((tag) => tagIds.includes(tag._id)) ? (
        <TagChips tagIds={tagIds} tags={tags} />
      ) : (
        <p className="text-xs text-muted-foreground">No tags.</p>
      )}
    </div>
  );
}

function TagList({
  tags,
  onEdit,
}: {
  tags: LeadTag[];
  onEdit: (target: LeadTag | "new") => void;
}) {
  const removeTag = useMutation(api.leads.removeTag);

  return (
    <>
      <SheetHeader className="border-b p-4 pr-14">
        <SheetTitle>Lead tags</SheetTitle>
        <SheetDescription>
          Labels of your own — a type of enquiry, a priority, a source. A tag
          with a description is also applied by the follow-up desk when it
          reviews a conversation; one without is only ever applied by hand.
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-4">
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet.</p>
        ) : null}
        {tags.map((tag) => (
          <div key={tag._id} className="flex items-start gap-2 rounded-lg border p-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <TagChip tag={tag} />
                {tag.description ? (
                  <Badge variant="outline" title="The follow-up desk applies this tag">
                    <HugeiconsIcon icon={RoboticIcon} strokeWidth={2} /> desk
                  </Badge>
                ) : null}
                <Badge variant="ghost" className="tabular-nums">
                  {tag.leadCount} {tag.leadCount === 1 ? "lead" : "leads"}
                </Badge>
              </p>
              {tag.description ? (
                <p className="mt-1 text-xs text-muted-foreground">{tag.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="icon-lg"
                variant="ghost"
                aria-label={`Edit ${tag.name}`}
                onClick={() => onEdit(tag)}
              >
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
              </Button>
              <Button
                size="icon-lg"
                variant="ghost"
                aria-label={`Delete ${tag.name}`}
                onClick={async () => {
                  try {
                    const result = await removeTag({ tagId: tag._id });
                    toast.add({
                      title: `Deleted ${tag.name}`,
                      description: result.cleared
                        ? `Removed from ${result.cleared} lead(s).`
                        : undefined,
                      type: "success",
                    });
                  } catch (error) {
                    toast.add({
                      title: "Could not delete the tag",
                      description: friendlyError(error),
                      type: "error",
                    });
                  }
                }}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <SheetFooter className="border-t p-4">
        <Button size="lg" onClick={() => onEdit("new")}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add tag
        </Button>
      </SheetFooter>
    </>
  );
}

function TagForm({
  workspaceId,
  tag,
  onDone,
}: {
  workspaceId: Id<"workspaces">;
  tag?: LeadTag;
  onDone: () => void;
}) {
  const createTag = useMutation(api.leads.createTag);
  const updateTag = useMutation(api.leads.updateTag);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? "sky");
  const [description, setDescription] = useState(tag?.description ?? "");

  const save = async () => {
    setBusy(true);
    try {
      if (tag) {
        await updateTag({ tagId: tag._id, name, color, description });
      } else {
        await createTag({ workspaceId, name, color, description });
      }
      toast.add({ title: tag ? "Tag saved" : "Tag added", type: "success" });
      onDone();
    } catch (error) {
      toast.add({
        title: "Could not save the tag",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SheetHeader className="gap-2 border-b p-4 pr-14">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onDone}>
          <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} /> All tags
        </Button>
        <SheetTitle>{tag ? `Edit ${tag.name}` : "Add a tag"}</SheetTitle>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tag-name">Name</Label>
          <Input
            id="tag-name"
            value={name}
            placeholder="Tag name"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Colour</Label>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_TAG_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={option}
                aria-pressed={color === option}
                onClick={() => setColor(option)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background",
                  TAG_TONES[option].dot,
                  color === option && "ring-2 ring-ring"
                )}
              >
                {color === option ? <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5 text-white" /> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tag-description">
            When the desk should apply it
            <span className="ml-1 font-normal text-muted-foreground">— optional</span>
          </Label>
          <Textarea
            id="tag-description"
            rows={4}
            value={description}
            placeholder="What a conversation says when this tag fits"
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave it empty to apply this tag only by hand. Once someone changes a
            lead&apos;s tags by hand, the desk leaves that lead&apos;s tags alone.
          </p>
        </div>
      </div>

      <SheetFooter className="flex-row justify-end border-t p-4">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy || !name.trim()}>
          {busy ? <Spinner /> : <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} />} Save
        </Button>
      </SheetFooter>
    </>
  );
}

export function LeadTagsSheet({
  workspaceId,
  tags,
  open,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">;
  tags: LeadTag[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState<LeadTag | "new" | null>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setEditing(null);
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {editing ? (
          <TagForm
            key={editing === "new" ? "new" : editing._id}
            workspaceId={workspaceId}
            tag={editing === "new" ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        ) : (
          <TagList tags={tags} onEdit={setEditing} />
        )}
      </SheetContent>
    </Sheet>
  );
}
