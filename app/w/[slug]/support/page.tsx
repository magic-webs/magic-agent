"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import { ticketRef } from "@/convex/lib/support";
import { useWorkspace } from "@/components/workspace-provider";
import { PriorityBadge, StatusBadge, eventText, typeLabel } from "@/components/support/labels";
import { when } from "@/components/support/thread";
import { ListSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { CustomerSupportIcon, PlusSignIcon, Shield01Icon } from "@hugeicons/core-free-icons";

type View = "active" | "done" | "all" | "access";

export default function SupportPage() {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>("active");
  const tickets = useQuery(
    api.support.list,
    view === "access" ? "skip" : { workspaceId: workspace._id, filter: view }
  );
  const log = useQuery(
    api.supportAccess.accessLog,
    view === "access" ? { workspaceId: workspace._id } : "skip"
  );
  const base = `/w/${workspace.slug}/support`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Support</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Raise a problem with our team, follow the conversation, and decide when we may open
            your workspace.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New ticket
        </Button>
      </header>

      <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
        <Tabs value={view} onValueChange={(next) => setView(next as View)}>
          <TabsList>
            <TabsTrigger value="active">Open</TabsTrigger>
            <TabsTrigger value="done">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="access">Access log</TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "access" ? (
          <Card>
            <CardHeader>
              <CardTitle>Who opened your workspace</CardTitle>
              <CardDescription>
                Every access you granted, every time support opened your workspace, and every
                time shared credentials were viewed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {log === undefined ? (
                <ListSkeleton rows={4} />
              ) : log.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="divide-y">
                  {log.map((event) => (
                    <li key={event._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                      <HugeiconsIcon icon={Shield01Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
                      <span className="flex-1">{eventText(event)}</span>
                      {event.number ? (
                        <Link href={`${base}/${event.ticketId}`} className="text-primary hover:underline">
                          {ticketRef(event.number)}
                        </Link>
                      ) : null}
                      <span className="text-xs text-muted-foreground" title={format(event.createdAt, "PPpp")}>
                        {when(event.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : tickets === undefined ? (
          <ListSkeleton rows={5} />
        ) : tickets.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={CustomerSupportIcon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>{view === "active" ? "No open tickets" : "No tickets here"}</EmptyTitle>
              <EmptyDescription>
                Something not working, or need a hand setting up? Tell us and attach a screenshot.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
                New ticket
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {tickets.map((ticket) => (
              <Link
                key={ticket._id}
                href={`${base}/${ticket._id}`}
                className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {ticket.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" /> : null}
                    <span className="text-xs text-muted-foreground tabular-nums">{ticketRef(ticket.number)}</span>
                    <span className={cn("truncate text-sm", ticket.unread ? "font-semibold" : "font-medium")}>
                      {ticket.subject}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {ticket.lastReplyBy === "staff" ? "Support: " : ""}
                    {ticket.lastMessagePreview}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {ticket.accessRequestedAt && !ticket.accessUntil ? (
                    <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                      Access requested
                    </span>
                  ) : null}
                  {ticket.accessUntil ? (
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Access open
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{typeLabel(ticket.type)}</span>
                  <PriorityBadge priority={ticket.priority} />
                  <StatusBadge status={ticket.status} />
                  <span className="w-24 text-right text-xs text-muted-foreground">{when(ticket.lastMessageAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
