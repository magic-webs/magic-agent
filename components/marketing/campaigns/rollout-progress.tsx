"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { limitLabel } from "@/convex/lib/rollout";
import {
  APPROVED_TONE,
  QUALITY,
  REFUSED_TONE,
  WAITING_TONE,
  rate,
  rolloutLabel,
  shortTime,
} from "@/components/marketing/format";
import { useHourBucket } from "@/components/use-now";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const DECISION: Record<Doc<"rolloutChecks">["decision"], { label: string; className: string }> = {
  launch: { label: "Sent a wave", className: APPROVED_TONE },
  hold: { label: "Held", className: WAITING_TONE },
  wait: { label: "Waited", className: "bg-muted text-muted-foreground" },
  pause: { label: "Paused", className: REFUSED_TONE },
  finish: { label: "Finished", className: APPROVED_TONE },
};

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", className)}>{children}</span>;
}

export function RolloutProgress({ eventId }: { eventId: Id<"marketingEvents"> }) {
  const now = useHourBucket();
  const progress = useQuery(api.marketingRollout.progress, { eventId, now });
  if (progress === undefined) {
    return (
      <div className="flex justify-center rounded-lg border border-border p-6">
        <Spinner />
      </div>
    );
  }
  if (progress === null) return null;
  const { rollout, waves, checks, health } = progress;
  const sent = rollout.planned - rollout.queued;
  const quality = QUALITY[health.quality];

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Smart rollout</p>
          <p className="text-xs text-muted-foreground">
            {rolloutLabel(rollout)} · waves of {rollout.shares.join(" / ")}%,{" "}
            {rollout.gapDays === 1 ? "every day" : `every ${rollout.gapDays} days`}
            {rollout.engagedFirst ? ", most engaged first" : ""}
          </p>
        </div>
        {rollout.planned > 0 ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {sent.toLocaleString()} of {rollout.planned.toLocaleString()} given a wave ·{" "}
            {rollout.queued.toLocaleString()} still to go
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Number quality</dt>
          <dd>
            <Chip className={quality.className}>{quality.label}</Chip>
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Daily limit</dt>
          <dd className="font-medium">{health.limitTier ? limitLabel(health.limitTier) : "Not known"}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Sent in 24 hours</dt>
          <dd className="font-medium tabular-nums">{health.used24h.toLocaleString()}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Next check</dt>
          <dd className="font-medium">{rollout.nextCheckAt ? shortTime(rollout.nextCheckAt) : "—"}</dd>
        </div>
      </dl>

      {waves.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wave</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="hidden text-right md:table-cell">Delivered</TableHead>
                <TableHead className="hidden text-right md:table-cell">Read</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Replied</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Unsubscribed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waves.map((wave) => (
                <TableRow key={wave.wave}>
                  <TableCell className="font-medium">{wave.wave}</TableCell>
                  <TableCell>{shortTime(wave.at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{wave.size.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{wave.stats.sent.toLocaleString()}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {rate(wave.stats.delivered, wave.stats.sent)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {rate(wave.stats.read, wave.stats.sent)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {rate(wave.stats.replied, wave.stats.sent)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {rate(wave.stats.optedOut, wave.stats.delivered)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {wave.stats.failed ? wave.stats.failed.toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {checks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Every check</p>
          <ol className="flex flex-col gap-2">
            {checks.map((check) => {
              const decision = DECISION[check.decision];
              return (
                <li key={check._id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip className={decision.className}>{decision.label}</Chip>
                    <span className="text-xs text-muted-foreground">{shortTime(check.at)}</span>
                    {check.quality ? (
                      <span className="text-xs text-muted-foreground">
                        · quality {QUALITY[check.quality].label.toLowerCase()}
                      </span>
                    ) : null}
                    {check.used24h !== undefined ? (
                      <span className="text-xs text-muted-foreground">
                        · {check.used24h.toLocaleString()} sent in 24h
                      </span>
                    ) : null}
                  </div>
                  <p>{check.reason}</p>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
