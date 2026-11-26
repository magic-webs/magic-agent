"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  fail,
  useInstagram,
  type InstagramChannel,
  type InstagramRule,
} from "@/components/instagram/context";
import { AccountAvatar } from "@/components/instagram/account-avatar";
import {
  PRESETS,
  RuleDialog,
  draftFromRule,
  type RuleDraft,
} from "@/components/instagram/rule-dialog";
import { CardGridSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Comment01Icon,
  ImageCompositionIcon,
  MoreHorizontalIcon,
  PlusSignIcon,
  SentIcon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons";

type Editing = { ruleId?: Id<"instagramRules">; initial?: RuleDraft } | null;
type Filter = "all" | "live" | "paused";

export default function InstagramCommentsPage() {
  const workspace = useWorkspace();
  const { channel } = useInstagram();
  const rules = useQuery(api.instagramAutomation.listRules, { workspaceId: workspace._id });
  const [editing, setEditing] = useState<Editing>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const mine = rules?.filter((rule) => rule.channelId === channel._id);
  const live = mine?.filter((rule) => rule.enabled).length ?? 0;
  const shown = mine?.filter((rule) =>
    filter === "all" ? true : filter === "live" ? rule.enabled : !rule.enabled
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
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

      {mine && mine.length > 0 ? (
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All {mine.length}</TabsTrigger>
            <TabsTrigger value="live">Live {live}</TabsTrigger>
            <TabsTrigger value="paused">Paused {mine.length - live}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {shown === undefined ? (
        <CardGridSkeleton count={3} />
      ) : mine?.length === 0 ? (
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
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filter === "live" ? "No rule is live." : "No rule is paused."}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {shown.map((rule) => (
            <RuleCard
              key={rule._id}
              rule={rule}
              channel={channel}
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

function PostMedia({
  posts,
  paused,
  onOpen,
}: {
  posts: InstagramRule["posts"];
  paused: boolean;
  onOpen: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const at = Math.min(index, Math.max(posts.length - 1, 0));
  const post = posts[at];
  const src = post?.thumbnailUrl && !broken.has(post.thumbnailUrl) ? post.thumbnailUrl : null;
  const step = (by: number) => setIndex((at + by + posts.length) % posts.length);

  return (
    <div className="group/media relative aspect-square overflow-hidden bg-muted">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Edit rule"
        className="block size-full"
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={post?.caption ?? ""}
            onError={() => setBroken((prev) => new Set(prev).add(src))}
            className={cn(
              "size-full object-cover transition-[filter,opacity]",
              paused && "opacity-60 grayscale"
            )}
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <HugeiconsIcon icon={ImageCompositionIcon} strokeWidth={1.5} className="size-8" />
            <span className="text-xs font-medium">{post ? "Preview unavailable" : "Every post"}</span>
            {post ? null : (
              <span className="px-4 text-center text-[11px]">
                Answers matching comments on any post, new ones included
              </span>
            )}
          </span>
        )}
      </button>

      {paused ? (
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Paused
        </span>
      ) : null}

      {posts.length > 1 ? (
        <>
          <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
            {at + 1}/{posts.length}
          </span>
          <button
            type="button"
            aria-label="Previous post"
            onClick={() => step(-1)}
            className="absolute top-1/2 left-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-900 opacity-0 shadow-sm transition-opacity group-hover/media:opacity-100 focus-visible:opacity-100"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next post"
            onClick={() => step(1)}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-900 opacity-0 shadow-sm transition-opacity group-hover/media:opacity-100 focus-visible:opacity-100"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4" />
          </button>
          <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
            {posts.map((row, dot) => (
              <span
                key={row.id}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  dot === at ? "bg-white" : "bg-white/45"
                )}
              />
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}

function RuleCard({
  rule,
  channel,
  onEdit,
}: {
  rule: InstagramRule;
  channel: InstagramChannel;
  onEdit: () => void;
}) {
  const setEnabled = useMutation(api.instagramAutomation.setRuleEnabled);
  const remove = useMutation(api.instagramAutomation.removeRule);
  const [deleting, setDeleting] = useState(false);

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
  const dm = rule.dm ? (rule.dm.buttonUrl ? "DM + button" : "DM") : null;
  const permalink = rule.posts.find((post) => post.permalink)?.permalink;

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span
          className={cn(
            "rounded-full p-[2px]",
            rule.enabled
              ? "bg-[linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)]"
              : "bg-border"
          )}
        >
          <AccountAvatar channel={channel} size={24} className="ring-2 ring-card" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{rule.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {channel.label} ·{" "}
            {rule.posts.length
              ? `${rule.posts.length} ${rule.posts.length === 1 ? "post" : "posts"}`
              : "Every post"}
          </p>
        </div>
        <Switch
          size="sm"
          checked={rule.enabled}
          onCheckedChange={toggle}
          aria-label={rule.enabled ? "Pause rule" : "Turn rule on"}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon-xs" variant="ghost" aria-label="Rule actions">
                <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
            {permalink ? (
              <DropdownMenuItem onClick={() => window.open(permalink, "_blank", "noopener")}>
                Open post
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PostMedia posts={rule.posts} paused={!rule.enabled} onOpen={onEdit} />

      <div className="flex flex-1 flex-col gap-1 px-2.5 pt-2 pb-2.5">
        <div className="flex items-center gap-3 text-xs">
          <Stat icon={Comment01Icon} label={reply ?? "No reply"} muted={!reply} />
          <Stat icon={SentIcon} label={dm ?? "No DM"} muted={!dm} />
          {rule.oncePerUser ? (
            <Stat icon={UserCheck01Icon} label="Once" className="ml-auto" />
          ) : null}
        </div>

        <p className="text-xs font-semibold">
          {rule.fired} {rule.fired === 1 ? "time" : "times"} fired
        </p>

        <p className="text-xs leading-snug">
          <span className="font-semibold">When</span>{" "}
          {rule.match === "any" ? (
            <span className="text-muted-foreground">anyone comments</span>
          ) : (
            <>
              <span className="text-muted-foreground">a comment says </span>
              {rule.keywords.slice(0, 6).map((keyword, i) => (
                <span key={keyword}>
                  {i ? <span className="text-muted-foreground">, </span> : null}
                  <span className="font-medium text-[#4f5bd5] dark:text-[#8b93f0]">
                    {keyword}
                  </span>
                </span>
              ))}
              {rule.keywords.length > 6 ? (
                <span className="text-muted-foreground"> +{rule.keywords.length - 6}</span>
              ) : null}
            </>
          )}
        </p>

        {rule.dm ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{rule.dm.text}</p>
        ) : null}

        <p className="mt-auto pt-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
          {rule.lastFiredAt
            ? `Last fired ${formatDistanceToNow(rule.lastFiredAt, { addSuffix: true })}`
            : `Created ${formatDistanceToNow(rule.createdAt, { addSuffix: true })}`}
        </p>
      </div>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{rule.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              New comments stop getting its replies and DMs. Its activity stays in the log.
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
    </article>
  );
}

function Stat({
  icon,
  label,
  muted,
  className,
}: {
  icon: typeof Comment01Icon;
  label: string;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1",
        muted ? "text-muted-foreground" : "font-medium",
        className
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-4" />
      {label}
    </span>
  );
}
