"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { localDate } from "@/components/marketing/calendar";
import { EVERYONE } from "@/components/marketing/audience/audience-picker";
import {
  CampaignComposer,
  emptyCampaign,
  type CampaignDraft,
  type CampaignMode,
} from "@/components/marketing/campaigns/composer";
import { CampaignModePicker } from "@/components/marketing/campaigns/mode-picker";
import { recommendedPlan } from "@/convex/lib/rollout";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ArrowLeftIcon } from "@phosphor-icons/react";

export default function NewCampaignPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const now = useHourBucket();
  const today = localDate(now, workspace.timezone);
  const base = `/w/${workspace.slug}/marketing/campaigns`;
  const editId = params.get("edit") as Id<"marketingEvents"> | null;
  const fromId = params.get("from") as Id<"marketingEvents"> | null;
  const sourceId = editId ?? fromId;
  const followUpList = params.get("audience") as Id<"audiences"> | null;
  const fromBook = params.get("book") as Id<"recordBooks"> | null;
  const mode = params.get("mode") as CampaignMode | null;

  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const source = useQuery(api.marketingBroadcasts.get, sourceId ? { eventId: sourceId } : "skip");
  const templates = useMemo(() => overview?.templates ?? [], [overview]);

  if (!sourceId && !followUpList && !fromBook && mode !== "manual" && mode !== "smart") {
    return (
      <div className="flex flex-col gap-4">
        <Button size="sm" variant="ghost" className="w-fit" nativeButton={false} render={<Link href={base} />}>
          <ArrowLeftIcon /> All campaigns
        </Button>
        <CampaignModePicker base={base} />
      </div>
    );
  }
  if (!overview || (sourceId && source === undefined)) return <TableSkeleton rows={6} columns={3} />;
  if (sourceId && source === null) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>This campaign is gone</EmptyTitle>
          <EmptyDescription>It was deleted, or the link is wrong.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" nativeButton={false} render={<Link href={base} />}>
          <ArrowLeftIcon /> All campaigns
        </Button>
      </Empty>
    );
  }

  const draft: CampaignDraft = source
    ? {
        ...emptyCampaign(today, source.rollout ? "smart" : "manual"),
        plan: source.rollout
          ? {
              shares: source.rollout.shares,
              gapDays: source.rollout.gapDays,
              engagedFirst: source.rollout.engagedFirst,
              limitTier: source.rollout.limitTier,
            }
          : recommendedPlan(),
        eventId: editId ? source._id : undefined,
        title: editId
          ? source.title
          : followUpList
            ? `${source.title} (follow-up)`
            : `${source.title} (copy)`,
        templateId: source.templateId,
        message: source.note ?? "",
        audience: followUpList
          ? { ...EVERYONE, audienceIds: [followUpList] }
          : (source.audience ?? EVERYONE),
        date: editId && source.date >= today ? source.date : today,
        sendHour: editId ? source.sendHour : 10,
        ratePerMinute: source.ratePerMinute,
        trackLinks: source.trackLinks ?? true,
        smartTiming: source.smartTiming ?? false,
      }
    : fromBook
      ? { ...emptyCampaign(today, mode ?? "manual"), audience: { ...EVERYONE, records: [{ bookId: fromBook }] } }
      : emptyCampaign(today, mode ?? "manual");

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="ghost" className="w-fit" nativeButton={false} render={<Link href={base} />}>
        <ArrowLeftIcon /> All campaigns
      </Button>
      <CampaignComposer

        key={sourceId ?? `new-${mode ?? "manual"}`}
        draft={draft}
        templates={templates}
        categories={overview.categories}
        today={today}
        startInReview={Boolean(editId && source?.rollout)}
        onClose={() => router.push(base)}
        onSaved={(eventId, sentNow) => router.push(sentNow ? `${base}/${eventId}` : base)}
      />
    </div>
  );
}
