"use client";

import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { useInstagram, type InstagramChannel } from "@/components/instagram/context";
import { AccountAvatar } from "@/components/instagram/account-avatar";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  BubbleChatIcon,
  Comment01Icon,
  Delete02Icon,
  MinusSignCircleIcon,
  SentIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";

type Filter = NonNullable<FunctionArgs<typeof api.instagramAutomation.listActivity>["filter"]>;
type Row = FunctionReturnType<typeof api.instagramAutomation.listActivity>["page"][number];
type Posts = FunctionReturnType<typeof api.instagramAutomation.knownPosts>;

const FILTERS: Array<{ value: Filter; label: string; empty: string }> = [
  { value: "all", label: "All", empty: "Comments and story mentions show here as they arrive." },
  { value: "answered", label: "Answered", empty: "No comment has been replied to or sent a DM yet." },
  { value: "moderated", label: "Moderated", empty: "No comment has been hidden or deleted." },
  { value: "skipped", label: "Skipped", empty: "Every comment so far was answered or moderated." },
  { value: "stories", label: "Story mentions", empty: "No one has mentioned the account in a story yet." },
  { value: "failed", label: "Failed", empty: "Nothing has failed to send." },
];

const AVATAR_COLOURS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
];

export function ActivityList({ pageSize, paged }: { pageSize: number; paged: boolean }) {
  const workspace = useWorkspace();
  const { channel } = useInstagram();
  const [filter, setFilter] = useState<Filter>("all");
  const posts = useQuery(api.instagramAutomation.knownPosts, { channelId: channel._id });
  const { results, status, loadMore } = usePaginatedQuery(
    api.instagramAutomation.listActivity,
    { workspaceId: workspace._id, channelId: channel._id, filter },
    { initialNumItems: pageSize }
  );

  const days: Array<{ label: string; rows: Row[] }> = [];
  for (const row of results) {
    const label = dayLabel(row.createdAt);
    const last = days.at(-1);
    if (last?.label === label) last.rows.push(row);
    else days.push({ label, rows: [row] });
  }

  return (
    <div className="flex flex-col gap-3">
      {paged ? (
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList className="max-w-full overflow-x-auto">
            {FILTERS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {status === "LoadingFirstPage" ? (
        <TableSkeleton rows={4} columns={3} />
      ) : results.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>Nothing here</EmptyTitle>
            <EmptyDescription>
              {FILTERS.find((item) => item.value === filter)?.empty}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <section key={day.label} className="flex flex-col gap-1.5">
              {paged ? (
                <h3 className="text-xs font-medium text-muted-foreground">{day.label}</h3>
              ) : null}
              <ul className="divide-y divide-border rounded-xl border border-border">
                {day.rows.map((row) => (
                  <ActivityRow key={row._id} row={row} channel={channel} posts={posts} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {paged && status !== "Exhausted" && status !== "LoadingFirstPage" ? (
        <Button
          variant="outline"
          className="self-center"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(pageSize)}
        >
          {status === "LoadingMore" ? <Spinner /> : null} Load more
        </Button>
      ) : null}
    </div>
  );
}

function dayLabel(at: number) {
  if (isToday(at)) return "Today";
  if (isYesterday(at)) return "Yesterday";
  return format(at, "d MMM yyyy");
}

function Person({ name }: { name: string }) {
  const letter = name.replace(/^@/, "").charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
        AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
      )}
    >
      {letter}
    </span>
  );
}

function ActivityRow({
  row,
  channel,
  posts,
}: {
  row: Row;
  channel: InstagramChannel;
  posts: Posts | undefined;
}) {
  const [open, setOpen] = useState(false);
  const name = row.fromUsername ? `@${row.fromUsername}` : (row.fromName ?? "Someone");
  const post = row.mediaId ? posts?.[row.mediaId] : undefined;
  const story = row.kind === "story_mention";
  const hidden = row.actions.includes("hidden");
  const deleted = row.actions.includes("deleted");

  return (
    <li className="flex gap-3 p-3">
      <Person name={name} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className={cn("text-sm wrap-break-word", (hidden || deleted) && "text-muted-foreground")}>
            <span className="font-semibold text-foreground">{name}</span>{" "}
            {story ? (
              <span className="text-muted-foreground">mentioned you in their story</span>
            ) : (
              <span className={cn(deleted && "line-through")}>{row.text}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDistanceToNow(row.createdAt, { addSuffix: true })}
            {row.ruleName ? ` · ${row.ruleName}` : ""}
          </p>
        </div>

        {row.publicReply ? (
          <div className="flex items-start gap-2 border-l-2 border-border pl-3">
            <AccountAvatar channel={channel} size={20} className="mt-px" />
            <p className="min-w-0 text-sm wrap-break-word">
              <span className="font-semibold">{channel.username}</span> {row.publicReply}
            </p>
          </div>
        ) : null}

        {row.dmText ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex max-w-xl flex-col gap-0.5 self-start rounded-2xl rounded-tl-md bg-[#3797f0]/10 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1 text-[11px] font-medium text-[#1877f2] dark:text-[#6cb4ff]">
              <HugeiconsIcon icon={SentIcon} strokeWidth={2} className="size-3" />
              Sent in DM
            </span>
            <span className={cn("text-sm wrap-break-word whitespace-pre-wrap", !open && "line-clamp-2")}>
              {row.dmText}
            </span>
          </button>
        ) : null}

        <Outcome row={row} />
      </div>

      {post?.thumbnailUrl ? (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open the post"
          className="shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbnailUrl} alt="" className="size-11 rounded-md object-cover" />
        </a>
      ) : null}
    </li>
  );
}

function Outcome({ row }: { row: Row }) {
  const pills: Array<{ icon: typeof SentIcon; label: string; tone: "ok" | "warn" | "bad" | "muted" }> = [];
  if (row.actions.includes("public_reply")) pills.push({ icon: Comment01Icon, label: "Replied", tone: "ok" });
  if (row.actions.includes("dm")) pills.push({ icon: SentIcon, label: "DM sent", tone: "ok" });
  if (row.actions.includes("hidden")) pills.push({ icon: ViewOffSlashIcon, label: "Hidden", tone: "warn" });
  if (row.actions.includes("deleted")) pills.push({ icon: Delete02Icon, label: "Deleted", tone: "bad" });
  if (row.error) pills.push({ icon: AlertCircleIcon, label: "Failed", tone: "bad" });
  if (pills.length === 0) pills.push({ icon: MinusSignCircleIcon, label: "Skipped", tone: "muted" });

  const note = [row.reason, row.error].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {pills.map((pill) => (
        <span
          key={pill.label}
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
            pill.tone === "ok" && "bg-green-500/10 text-green-700 dark:text-green-400",
            pill.tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            pill.tone === "bad" && "bg-destructive/10 text-destructive",
            pill.tone === "muted" && "bg-muted text-muted-foreground"
          )}
        >
          <HugeiconsIcon icon={pill.icon} strokeWidth={2} className="size-3" />
          {pill.label}
        </span>
      ))}
      {note ? <span className="text-muted-foreground">{note}</span> : null}
    </div>
  );
}
