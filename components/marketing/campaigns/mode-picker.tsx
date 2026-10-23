"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { defaultPlan, isRecommended } from "@/convex/lib/rollout";
import { useWorkspace } from "@/components/workspace-provider";
import { WaveDefaultsDialog, gapLabel } from "@/components/marketing/campaigns/wave-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  PencilEdit02Icon,
  SecurityCheckIcon,
  SlidersHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

function ModeCard({
  href,
  icon,
  title,
  badge,
  body,
  points,
}: {
  href: string;
  icon: IconSvgElement;
  title: string;
  badge?: string;
  body: string;
  points: string[];
}) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col gap-3 p-5 outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HugeiconsIcon icon={icon} strokeWidth={2} className="size-5" />
        </span>
        <span className="font-semibold">{title}</span>
        {badge ? <Badge className="ml-auto">{badge}</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2">
            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="mt-0.5 size-4 shrink-0 text-primary" />
            {point}
          </li>
        ))}
      </ul>
    </Link>
  );
}

export function CampaignModePicker({ base }: { base: string }) {
  const workspace = useWorkspace();
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const [editing, setEditing] = useState(false);
  const plan = defaultPlan(overview?.rolloutDefaults);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">New campaign</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          How should it go out? Both send one approved template to the people you choose.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border transition-colors hover:border-primary">
          <ModeCard
            href={`${base}/new?mode=smart`}
            icon={SecurityCheckIcon}
            title="Smart campaign"
            badge="Safest"
            body="Sends in daily waves to your most engaged contacts first, watches your WhatsApp quality and limit, and pauses itself if anything looks risky."
            points={[
              `Starts small and grows: ${plan.shares.join(" → ")}%`,
              "Every wave stays under your daily Meta limit",
              "Holds on yellow quality, stops on red or spam",
              "A report and a notification for every wave",
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-5 py-3">
            {overview === undefined ? (
              <Skeleton className="h-3.5 w-56" />
            ) : (
              <p className="text-xs text-muted-foreground">
                {isRecommended(plan) ? "Recommended waves" : "Your waves"} · {gapLabel(plan.gapDays).toLowerCase()} ·{" "}
                {plan.engagedFirst ? "most engaged first" : "in contact order"}
              </p>
            )}
            <Button size="sm" variant="outline" disabled={overview === undefined} onClick={() => setEditing(true)}>
              <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} /> Customize waves
            </Button>
          </div>
        </div>
        <div className="flex flex-col overflow-hidden rounded-xl border border-border transition-colors hover:border-primary">
          <ModeCard
            href={`${base}/new?mode=manual`}
            icon={SlidersHorizontalIcon}
            title="Manual campaign"
            body="You choose when it goes and how fast. Everyone you pick is sent to in one go."
            points={[
              "Send now or at a time you choose",
              "Pick the speed, or each person's best time",
              "Best for small, warm audiences",
            ]}
          />
        </div>
      </div>
      {editing ? <WaveDefaultsDialog initial={plan} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
