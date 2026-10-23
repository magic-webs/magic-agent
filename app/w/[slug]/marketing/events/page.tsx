"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { localDate } from "@/components/marketing/calendar";
import { EventsTab, EventsTabSkeleton, TouchDialog } from "@/components/marketing/events";
import { EVENT_TEMPLATE_BODY } from "@/components/marketing/format";
import { TemplateDialog, type TemplateDraft } from "@/components/marketing/template-dialog";

export default function MarketingEventsPage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const now = useHourBucket();
  const today = localDate(now, workspace.timezone);
  const startNew = useSearchParams().get("new") === "1";
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const campaigns = useQuery(api.marketingCampaigns.list, { workspaceId: workspace._id });
  const templates = useMemo(() => overview?.templates ?? [], [overview]);
  const [touchId, setTouchId] = useState<Id<"marketingEvents"> | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);

  const loaded = overview !== undefined;
  useEffect(() => {
    if (startNew && loaded) router.replace(`/w/${workspace.slug}/marketing/events`);
  }, [startNew, loaded, router, workspace.slug]);

  const openCampaign = touchId
    ? (campaigns ?? []).find((c) => c.touches.some((t) => t._id === touchId))
    : undefined;
  const openTouch = openCampaign?.touches.find((t) => t._id === touchId);

  if (!loaded) return <EventsTabSkeleton />;

  return (
    <>
      <EventsTab
        campaigns={campaigns}
        templates={templates}
        categories={overview?.categories ?? []}
        today={today}
        startNew={startNew}
        onOpenTouch={(touch) => setTouchId(touch._id)}
        onCreateTemplate={() =>
          setTemplateDraft({
            name: "Event reminder",
            occasion: "event",
            category: "marketing",
            body: EVENT_TEMPLATE_BODY,
            metaTemplateName: "",
            languageCode: "en",
            headerKind: "none",
            header: "",
            headerMedia: null,
            footer: "",
            buttons: [],
          })
        }
      />
      <TouchDialog
        key={`touch:${touchId ?? "none"}`}
        campaign={openCampaign ?? null}
        touch={openTouch ?? null}
        templates={templates}
        onClose={() => setTouchId(null)}
      />
      <TemplateDialog draft={templateDraft} setDraft={setTemplateDraft} templates={templates} />
    </>
  );
}
