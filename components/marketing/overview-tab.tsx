"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { formatMoney } from "@/convex/lib/billing";
import { limitLabel } from "@/convex/lib/rollout";
import { ActivityChart, StatTile } from "@/components/dashboard-charts";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  CalendarAdd01Icon,
  FileImportIcon,
  RefreshIcon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { QUALITY, fail, pct, rate, shortTime } from "@/components/marketing/format";
import { cn } from "@/lib/utils";

type Summary = FunctionReturnType<typeof api.marketingOverview.summary>;

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const TILE_SPARKLINES = [true, false, true, true, true, true, false, false];
const AUDIENCE_WIDTHS = ["w-28", "w-32", "w-44", "w-36"];
const OUT_WIDTHS = ["w-40", "w-28", "w-48", "w-32"];

function OutHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead className="text-right">Sent</TableHead>
        <TableHead className="text-right">Read</TableHead>
        <TableHead className="hidden text-right sm:table-cell">Replied</TableHead>
        <TableHead className="hidden text-right md:table-cell">Clicked</TableHead>
        <TableHead className="hidden text-right md:table-cell">Orders</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex h-5 items-center font-medium">{children}</dd>
    </div>
  );
}

function NumberHealth({ now }: { now: number }) {
  const workspace = useWorkspace();
  const health = useQuery(api.marketingRollout.health, { workspaceId: workspace._id, now });
  const refresh = useAction(api.marketingRollout.refreshHealth);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    refresh({ workspaceId: workspace._id }).catch(() => undefined);
  }, [refresh, workspace._id]);

  const check = async () => {
    setChecking(true);
    try {
      await refresh({ workspaceId: workspace._id });
    } catch (error) {
      fail("Could not check your number", error);
    } finally {
      setChecking(false);
    }
  };

  const quality = QUALITY[health?.quality ?? "UNKNOWN"];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex h-7 items-center justify-between gap-2">
        <p className="text-sm font-semibold">Your WhatsApp number</p>
        {health ? (
          <Button size="sm" variant="ghost" disabled={checking} onClick={() => void check()}>
            {checking ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />} Check again
          </Button>
        ) : null}
      </div>
      {health === null ? (
        <p className="text-sm text-muted-foreground">
          Connect a WhatsApp channel to see its quality and messaging limit.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Fact label="Quality">
              {health ? (
                <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", quality.className)}>
                  {quality.label}
                </span>
              ) : (
                <Skeleton className="h-5 w-14" />
              )}
            </Fact>
            <Fact label="Messaging limit">
              {health ? (
                health.limitTier ? limitLabel(health.limitTier) : "Not known"
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
            </Fact>
            <Fact label="Sent in the last 24 hours">
              {health ? (
                <span className="tabular-nums">{health.used24h.toLocaleString()}</span>
              ) : (
                <Skeleton className="h-4 w-12" />
              )}
            </Fact>
            <Fact label="Checked">
              {health ? (
                health.checkedAt ? shortTime(health.checkedAt) : "Not yet"
              ) : (
                <Skeleton className="h-4 w-32" />
              )}
            </Fact>
          </dl>
          {health?.quality === "RED" ? (
            <p className="text-xs font-medium text-destructive">
              Quality is red. Smart campaigns stay paused until it recovers.
            </p>
          ) : health?.quality === "YELLOW" ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Quality is yellow. Smart campaigns wait 48 hours and halve the next wave.
            </p>
          ) : null}
          {health?.alert ? <p className="text-xs text-muted-foreground">Meta: {health.alert}</p> : null}
        </>
      )}
    </section>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILE_SPARKLINES.map((sparkline, i) => (
          <div key={i} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
            <Skeleton className="my-0.5 h-3 w-24" />
            <Skeleton className="h-6 w-16" />
            {sparkline ? <Skeleton className="h-10 w-full" /> : null}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Messages sent each day</p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Skeleton className="h-3 w-40" />
              <div className="flex gap-1">
                <Skeleton className="h-9 w-20 rounded-lg" />
                <Skeleton className="h-9 w-20 rounded-lg" />
              </div>
            </div>
            <Skeleton className="h-56 w-full" />
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold">Audience</p>
          <div className="grid gap-2">
            {AUDIENCE_WIDTHS.map((width) => (
              <div key={width} className="flex h-5 items-center justify-between">
                <Skeleton className={cn("h-3.5", width)} />
                <Skeleton className="h-3.5 w-10" />
              </div>
            ))}
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">What went out</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <OutHeader />
            <TableBody>
              {OUT_WIDTHS.map((width) => (
                <TableRow key={width} className="hover:bg-transparent">
                  <TableCell>
                    <div className="flex h-5 items-center">
                      <Skeleton className={cn("h-3.5", width)} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-3.5 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-3.5 w-8" />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Skeleton className="ml-auto h-3.5 w-8" />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Skeleton className="ml-auto h-3.5 w-6" />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Skeleton className="ml-auto h-3.5 w-6" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function Report({ data }: { data: Summary }) {
  const workspace = useWorkspace();
  const { totals, previous, series } = data;
  const rateSeries = series.map((row) => ({
    date: row.date,
    sent: row.sent,
    readRate: row.sent ? Math.round((row.read / row.sent) * 100) : null,
    replyRate: row.sent ? Math.round((row.replied / row.sent) * 100) : null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Messages sent" value={totals.sent} previous={previous.sent} data={series} dataKey="sent" />
        <StatTile
          label="Delivered"
          value={pct(totals.delivered, totals.sent)}
          previous={pct(previous.delivered, previous.sent)}
          suffix="%"
        />
        <StatTile
          label="Read"
          value={pct(totals.read, totals.sent)}
          previous={pct(previous.read, previous.sent)}
          suffix="%"
          data={rateSeries}
          dataKey="readRate"
        />
        <StatTile
          label="Replied"
          value={pct(totals.replied, totals.sent)}
          previous={pct(previous.replied, previous.sent)}
          suffix="%"
          data={rateSeries}
          dataKey="replyRate"
        />
        <StatTile label="Link clicks" value={totals.clicked} previous={previous.clicked} data={series} dataKey="clicked" />
        <StatTile label="Orders and bookings" value={totals.converted} previous={previous.converted} data={series} dataKey="converted" />
        <StatTile
          label="Unsubscribed"
          value={totals.optedOut}
          previous={previous.optedOut}
          lowerIsBetter
        />
        <StatTile
          label="Spent on campaigns"
          value={data.spend.currency ? data.spend.micros : null}
          previous={null}
          format={(value) => formatMoney(value, data.spend.currency ?? "USD", workspace.locale)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4 lg:col-span-2">
          <p className="text-sm font-semibold">Messages sent each day</p>
          <ActivityChart
            data={series}
            windowDays={data.days}
            series={{ key: "sent", label: "Sent" }}
            columns={[
              { key: "sent", label: "Sent" },
              { key: "delivered", label: "Delivered" },
              { key: "read", label: "Read" },
              { key: "replied", label: "Replied" },
              { key: "clicked", label: "Clicked" },
              { key: "failed", label: "Failed" },
            ]}
            noun="messages"
            emptyLabel="Nothing sent in this period."
          />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold">Audience</p>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Can be messaged</dt>
              <dd className="font-medium tabular-nums">
                {data.audience.reachable.toLocaleString()}
                {data.audience.partial ? "+" : ""}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">New in this period</dt>
              <dd className="tabular-nums">{data.audience.newContacts.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Unsubscribed in this period</dt>
              <dd className="tabular-nums">{data.audience.newOptOuts.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Unsubscribed in all</dt>
              <dd className="tabular-nums">{data.audience.optedOut.toLocaleString()}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            An unsubscribe rate above 2% of a send usually means the message reached people who
            didn&apos;t expect it — check who it went to.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">What went out</p>
        {data.campaigns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No campaigns or reminders went out in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">

            <Table>
              <OutHeader />
              <TableBody>
                {data.campaigns.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell>
                      <span className="font-medium">{row.title}</span>
                      {row.isReminder ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          event
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.stats.sent.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{rate(row.stats.read, row.stats.sent)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {rate(row.stats.replied, row.stats.sent)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{row.stats.clicked}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{row.stats.converted}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

export function OverviewTab({ onGo }: { onGo: (tab: string) => void }) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const [days, setDays] = useState("30");
  const data = useQuery(api.marketingOverview.summary, {
    workspaceId: workspace._id,
    days: Number(days),
    now,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-sm text-muted-foreground">
            How your WhatsApp marketing is landing, across every campaign, event and greeting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectField aria-label="Period" className="w-40" value={days} onValueChange={setDays} options={PERIODS} />
          <Button variant="outline" onClick={() => onGo("audience")}>
            <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} /> Import contacts
          </Button>
          <Button variant="outline" onClick={() => onGo("events")}>
            <HugeiconsIcon icon={CalendarAdd01Icon} strokeWidth={2} /> New event
          </Button>
          <Button onClick={() => onGo("campaigns")}>
            <HugeiconsIcon icon={SentIcon} strokeWidth={2} /> New campaign
          </Button>
        </div>
      </div>

      <NumberHealth now={now} />

      {data ? <Report data={data} /> : <ReportSkeleton />}
    </div>
  );
}
