"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ActivityChart, RankedBars, StatTile } from "@/components/dashboard-charts";
import { useClock } from "@/components/support/use-clock";
import { SelectField } from "@/components/select-field";
import { StatTilesSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";

const DAY = 24 * 60 * 60 * 1000;

function duration(ms: number | null): string {
  if (ms === null) return "—";
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

export default function SupportReportsPage() {
  const now = useClock(5 * 60_000);
  const [days, setDays] = useState("30");
  const from = Math.floor((now - Number(days) * DAY) / DAY) * DAY;
  const report = useQuery(api.supportAdmin.report, { from });

  const series = report
    ? Array.from({ length: Number(days) }, (_, index) => {
        const date = new Date(from + (index + 1) * DAY).toISOString().slice(0, 10);
        return { date, tickets: report.byDay.find((row) => row.day === date)?.count ?? 0 };
      })
    : [];

  const ages = report
    ? [
        { bucket: "Under a day", count: report.backlogAge.filter((at) => now - at < DAY).length },
        { bucket: "1–3 days", count: report.backlogAge.filter((at) => now - at >= DAY && now - at < 3 * DAY).length },
        { bucket: "3–7 days", count: report.backlogAge.filter((at) => now - at >= 3 * DAY && now - at < 7 * DAY).length },
        { bucket: "Over a week", count: report.backlogAge.filter((at) => now - at >= 7 * DAY).length },
      ]
    : [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-4 sm:px-6">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/admin/support" aria-label="Back to the inbox" />}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <h1 className="flex-1 font-heading text-2xl font-semibold tracking-tight">Support reports</h1>
        <SelectField
          className="w-36"
          value={days}
          onValueChange={setDays}
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
          ]}
          aria-label="Period"
        />
      </header>

      <div className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
        {report === undefined ? (
          <StatTilesSkeleton count={6} className="sm:grid-cols-3 lg:grid-cols-6" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="New tickets" value={report.total} previous={null} />
              <StatTile label="Open now" value={report.backlog} previous={null} />
              <StatTile label="Unassigned" value={report.unassigned} previous={null} />
              <StatTile label="First reply" value={report.avgFirstResponseMs} previous={null} format={duration} />
              <StatTile label="Time to resolve" value={report.avgResolutionMs} previous={null} format={duration} />
              <StatTile
                label="Replied on time"
                value={report.firstResponseHitRate === null ? null : Math.round(report.firstResponseHitRate * 100)}
                previous={null}
                suffix="%"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Tickets opened</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityChart
                  data={series}
                  windowDays={Number(days)}
                  series={{ key: "tickets", label: "Tickets" }}
                  noun="tickets"
                  emptyLabel="No tickets in this period."
                />
              </CardContent>
            </Card>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>By type</CardTitle>
                </CardHeader>
                <CardContent>
                  <RankedBars
                    data={report.byType}
                    categoryKey="label"
                    valueKey="count"
                    valueLabel="Tickets"
                    emptyLabel="No tickets in this period."
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Busiest workspaces</CardTitle>
                </CardHeader>
                <CardContent>
                  <RankedBars
                    data={report.topWorkspaces}
                    categoryKey="name"
                    valueKey="count"
                    valueLabel="Tickets"
                    emptyLabel="No tickets in this period."
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Open ticket age</CardTitle>
                </CardHeader>
                <CardContent>
                  <RankedBars
                    data={ages}
                    categoryKey="bucket"
                    valueKey="count"
                    valueLabel="Open tickets"
                    emptyLabel="Nothing open."
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>
                  Team · CSAT {report.csat === null ? "—" : `${report.csat.toFixed(1)}/5`} from {report.csatCount} rating(s)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">Resolved</TableHead>
                      <TableHead className="text-right">CSAT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.agents.map((agent) => (
                      <TableRow key={agent.name}>
                        <TableCell>{agent.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{agent.open}</TableCell>
                        <TableCell className="text-right tabular-nums">{agent.resolved}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {agent.csat === null ? "—" : agent.csat.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
