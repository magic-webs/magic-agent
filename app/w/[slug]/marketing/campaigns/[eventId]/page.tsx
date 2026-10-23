"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { CampaignReport } from "@/components/marketing/campaigns/report";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";

export default function CampaignReportPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { eventId } = use(params);
  const workspace = useWorkspace();
  const router = useRouter();
  const base = `/w/${workspace.slug}/marketing/campaigns`;
  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="ghost" className="w-fit" nativeButton={false} render={<Link href={base} />}>
        <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} /> All campaigns
      </Button>
      <CampaignReport
        eventId={eventId as Id<"marketingEvents">}
        onClose={() => router.push(base)}
        onDuplicate={() => router.push(`${base}/new?from=${eventId}`)}
        onReengage={(audienceId) => router.push(`${base}/new?from=${eventId}&audience=${audienceId}`)}
      />
    </div>
  );
}
