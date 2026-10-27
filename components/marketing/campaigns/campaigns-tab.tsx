"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  STATUS_VARIANT,
  broadcastHref,
  datedLabel,
  hourLabel,
  rate,
  rolloutLabel,
  statusLabel,
} from "@/components/marketing/format";
import { localDate } from "@/components/marketing/calendar";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HugeiconsIcon } from "@hugeicons/react";
import { Megaphone02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";

const ROW_WIDTHS = [
  ["w-48", "w-64"],
  ["w-36", "w-56"],
  ["w-56", "w-72"],
  ["w-40", "w-52"],
  ["w-44", "w-60"],
];

function CampaignRowsSkeleton() {
  return ROW_WIDTHS.map(([title, meta], i) => (
    <TableRow key={i} className="hover:bg-transparent" aria-hidden>
      <TableCell>
        <div className="flex h-5 items-center">
          <Skeleton className={`h-3.5 ${title}`} />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className={`h-3 ${meta}`} />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-3.5 w-10" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="ml-auto h-3.5 w-9" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="ml-auto h-3.5 w-9" />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Skeleton className="ml-auto h-3.5 w-9" />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Skeleton className="ml-auto h-3.5 w-6" />
      </TableCell>
    </TableRow>
  ));
}

export function CampaignsTab() {
  const workspace = useWorkspace();
  const today = localDate(useHourBucket(), workspace.timezone);
  const { results, status, loadMore } = usePaginatedQuery(
    api.marketingBroadcasts.list,
    { workspaceId: workspace._id },
    { initialNumItems: 25 }
  );
  const router = useRouter();
  const base = `/w/${workspace.slug}/marketing/campaigns`;
  const href = (row: (typeof results)[number]) => broadcastHref(base, row);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Campaigns</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            One-off broadcasts — offers, launches, announcements and festival greetings — with
            delivery, reads and replies tracked for each.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New campaign
        </Button>
      </div>

      {results.length === 0 && status === "Exhausted" ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Megaphone02Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              Pick an audience and an approved template, and send now or at a time you choose.
            </EmptyDescription>
          </EmptyHeader>
          <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New campaign
          </Button>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden text-right md:table-cell">Sent</TableHead>
                <TableHead className="hidden text-right md:table-cell">Read</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Replied</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status === "LoadingFirstPage" ? <CampaignRowsSkeleton /> : results.map((row) => (
                <TableRow key={row._id} className="cursor-pointer" onClick={() => router.push(href(row))}>
                  <TableCell>
                    <Link
                      href={href(row)}
                      onClick={(event) => event.stopPropagation()}
                      className="font-medium underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
                    >
                      {row.title}
                    </Link>
                    {row.rollout ? (
                      <Badge variant="outline" className="ml-2 align-middle">
                        Smart
                      </Badge>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {datedLabel(row.date, today)} · {hourLabel(row.sendHour)}
                      {row.templateName ? ` · ${row.templateName}` : ""}
                      {row.audience ? " · chosen audience" : " · everyone"}
                    </p>
                    {row.rollout && row.status === "sending" ? (
                      <p className="text-xs text-muted-foreground">{rolloutLabel(row.rollout)}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]} className="gap-1">
                      {row.status === "sending" ? <Spinner className="size-3" /> : null}
                      {statusLabel(row.status, row.stats.sent)}

                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(row.stats.sent + row.stats.failed).toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {row.stats.delivered.toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {rate(row.stats.read, row.stats.sent + row.stats.failed)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {rate(row.stats.replied, row.stats.sent + row.stats.failed)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {row.stats.failed ? row.stats.failed.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {status === "CanLoadMore" ? (
            <div className="flex justify-center border-t border-border p-2">
              <Button size="sm" variant="ghost" onClick={() => loadMore(25)}>
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
