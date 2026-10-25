"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { fail, useInstagram, type InstagramRule } from "@/components/instagram/context";
import {
  PRESETS,
  RuleDialog,
  draftFromRule,
  type RuleDraft,
} from "@/components/instagram/rule-dialog";
import { CardGridSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

type Editing = { ruleId?: Id<"instagramRules">; initial?: RuleDraft } | null;

export default function InstagramCommentsPage() {
  const workspace = useWorkspace();
  const { channel } = useInstagram();
  const rules = useQuery(api.instagramAutomation.listRules, { workspaceId: workspace._id });
  const [editing, setEditing] = useState<Editing>(null);

  const mine = rules?.filter((rule) => rule.channelId === channel._id);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">Comment rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A comment fires one rule: a keyword rule before a catch-all, and one for chosen
            posts before one for every post.
          </p>
        </div>
        <Button onClick={() => setEditing({})}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New rule
        </Button>
      </header>

      {mine === undefined ? (
        <CardGridSkeleton count={3} />
      ) : mine.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Start from one of these:</p>
          <div className="grid gap-3 md:grid-cols-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.title}
                type="button"
                onClick={() => setEditing({ initial: preset.draft })}
                className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-4 text-left transition-colors hover:bg-muted/50"
              >
                <span className="text-sm font-medium">{preset.title}</span>
                <span className="text-xs text-muted-foreground">{preset.body}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {mine.map((rule) => (
            <RuleCard
              key={rule._id}
              rule={rule}
              onEdit={() => setEditing({ ruleId: rule._id, initial: draftFromRule(rule) })}
            />
          ))}
        </div>
      )}

      {editing ? (
        <RuleDialog
          channelId={channel._id}
          ruleId={editing.ruleId}
          initial={editing.initial}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function RuleCard({ rule, onEdit }: { rule: InstagramRule; onEdit: () => void }) {
  const setEnabled = useMutation(api.instagramAutomation.setRuleEnabled);
  const remove = useMutation(api.instagramAutomation.removeRule);

  const toggle = async (enabled: boolean) => {
    try {
      await setEnabled({ ruleId: rule._id, enabled });
    } catch (error) {
      fail("Could not change the rule", error);
    }
  };

  const reply =
    rule.publicReply.mode === "ai"
      ? "AI reply"
      : rule.publicReply.mode === "fixed"
        ? `${rule.publicReply.variants.length} ${rule.publicReply.variants.length === 1 ? "reply" : "replies"}`
        : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{rule.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rule.posts.length ? `${rule.posts.length} chosen posts` : "Every post"} ·{" "}
            {rule.fired} fired
            {rule.lastFiredAt
              ? `, last ${formatDistanceToNow(rule.lastFiredAt, { addSuffix: true })}`
              : ""}
          </p>
        </div>
        <Switch
          checked={rule.enabled}
          onCheckedChange={toggle}
          aria-label={rule.enabled ? "Pause rule" : "Turn rule on"}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {rule.match === "any" ? (
          <Badge variant="outline">Any comment</Badge>
        ) : (
          rule.keywords.slice(0, 8).map((keyword) => (
            <Badge key={keyword} variant="outline">
              {keyword}
            </Badge>
          ))
        )}
        {rule.keywords.length > 8 ? (
          <Badge variant="outline">+{rule.keywords.length - 8}</Badge>
        ) : null}
      </div>

      {rule.posts.length ? (
        <div className="flex gap-1.5">
          {rule.posts.slice(0, 6).map((post) =>
            post.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={post.id}
                src={post.thumbnailUrl}
                alt=""
                className="size-10 rounded object-cover"
              />
            ) : (
              <span key={post.id} className="size-10 rounded bg-muted" />
            )
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {reply ? <Badge variant="secondary">{reply}</Badge> : null}
        {rule.dm ? <Badge variant="secondary">DM{rule.dm.buttonUrl ? " + button" : ""}</Badge> : null}
        {rule.oncePerUser ? <Badge variant="secondary">Once per person</Badge> : null}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button size="sm" variant="ghost" aria-label="Delete rule">
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{rule.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  New comments stop getting its replies and DMs. Its activity stays in the
                  log.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
                <AlertDialogAction
                  render={
                    <Button
                      variant="destructive"
                      onClick={() =>
                        remove({ ruleId: rule._id }).catch((error) =>
                          fail("Could not delete the rule", error)
                        )
                      }
                    >
                      Delete
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </span>
      </div>
    </div>
  );
}
