"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import {
  CampaignDialog,
  EventCard,
  EventCardSkeleton,
  TouchDialog,
  draftForCampaign,
  type CampaignDraft,
} from "@/components/marketing/events";
import { GuestsPanel, GuestsPanelSkeleton } from "@/components/marketing/events/guests-panel";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";

export default function MarketingEventPage({
  params,
}: {
  params: Promise<{ slug: string; campaignId: string }>;
}) {
  const { campaignId } = use(params);
  const workspace = useWorkspace();
  const router = useRouter();
  const back = `/w/${workspace.slug}/marketing/events`;
  const campaign = useQuery(api.marketingCampaigns.get, {
    campaignId: campaignId as Id<"marketingCampaigns">,
  });
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const templates = useMemo(() => overview?.templates ?? [], [overview]);
  const [touchId, setTouchId] = useState<Id<"marketingEvents"> | null>(null);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const openTouch = campaign?.touches.find((t) => t._id === touchId);

  return (
    <div className="flex flex-col gap-4">
      <Button
        size="sm"
        variant="ghost"
        className="w-fit"
        nativeButton={false}
        render={<Link href={back} />}
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} /> All events
      </Button>

      {campaign === undefined ? (
        <>
          <EventCardSkeleton />
          <GuestsPanelSkeleton />
        </>
      ) : campaign === null ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>This event is gone</EmptyTitle>
            <EmptyDescription>It was deleted, or the link is wrong.</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" nativeButton={false} render={<Link href={back} />}>
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} /> All events
          </Button>
        </Empty>
      ) : (
        <>
          <EventCard
            campaign={campaign}
            templates={templates}
            locale={workspace.locale}
            onEdit={() => setDraft(draftForCampaign(campaign))}
            onGuests={() => document.getElementById("guests")?.scrollIntoView({ behavior: "smooth" })}
            onOpenTouch={(touch) => setTouchId(touch._id)}
          />
          <div id="guests">
            <GuestsPanel campaign={campaign} />
          </div>
          <CampaignDialog
            draft={draft}
            setDraft={setDraft}
            templates={templates}
            categories={overview?.categories ?? []}
            onDeleted={() => router.push(back)}
          />

          <TouchDialog
            key={`touch:${touchId ?? "none"}`}
            campaign={campaign}
            touch={openTouch ?? null}
            templates={templates}
            onClose={() => setTouchId(null)}
          />
        </>
      )}
    </div>
  );
}
