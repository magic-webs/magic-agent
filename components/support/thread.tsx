"use client";

import { useEffect, useRef } from "react";
import { format, formatDistanceToNow } from "date-fns";
import type { Doc } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AttachmentList } from "@/components/support/attachments";
import { eventText } from "@/components/support/labels";
import { cn } from "@/lib/utils";

type Message = {
  _id: string;
  author: "client" | "staff";
  authorName: string;
  mine: boolean;
  internal?: boolean;
  body: string;
  attachments: { key: string; name: string; type: string; size: number; url: string }[];
  createdAt: number;
};

type Event = {
  _id: string;
  kind: Doc<"supportEvents">["kind"];
  actorName: string;
  detail: string | null;
  createdAt: number;
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}

export function when(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

export function Thread({
  messages,
  events,
  staffView = false,
}: {
  messages: Message[];
  events: Event[];
  staffView?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const items = [
    ...messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
    ...events
      .filter((event) => event.kind !== "created")
      .map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
  ].sort((a, b) => a.at - b.at);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) =>
        item.kind === "event" ? (
          <div
            key={item.event._id}
            className="flex items-center gap-3 text-xs text-muted-foreground"
            title={format(item.at, "PPpp")}
          >
            <span className="h-px flex-1 bg-border" />
            <span className="text-center">
              {eventText(item.event)} · {when(item.at)}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : (
          <div
            key={item.message._id}
            className={cn(
              "flex gap-3",
              (staffView ? item.message.author === "staff" : item.message.mine) && "flex-row-reverse"
            )}
          >
            <Avatar className="size-8 shrink-0">
              <AvatarFallback
                className={cn(
                  "text-xs",
                  item.message.author === "staff" && "bg-primary/10 text-primary"
                )}
              >
                {initials(item.message.authorName)}
              </AvatarFallback>
            </Avatar>
            <div
              className={cn(
                "min-w-0 max-w-[85%] rounded-xl border px-4 py-3",
                item.message.internal
                  ? "border-amber-500/40 bg-amber-500/10"
                  : item.message.author === "staff"
                    ? "bg-primary/5"
                    : "bg-card"
              )}
            >
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{item.message.authorName}</span>
                {item.message.author === "staff" && !staffView ? <span>Support team</span> : null}
                {item.message.internal ? (
                  <span className="font-medium text-amber-700 dark:text-amber-300">Internal note</span>
                ) : null}
                <span title={format(item.message.createdAt, "PPpp")}>{when(item.message.createdAt)}</span>
              </div>
              {item.message.body ? (
                <p className="text-sm break-words whitespace-pre-wrap">{item.message.body}</p>
              ) : null}
              <AttachmentList attachments={item.message.attachments} />
            </div>
          </div>
        )
      )}
      <div ref={end} />
    </div>
  );
}
