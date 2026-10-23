"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { AddContactsDialog } from "@/components/marketing/add-contacts-dialog";
import { AudienceTab, AudienceTabSkeleton } from "@/components/marketing/audience/audience-tab";
import { BirthdaySettings } from "@/components/marketing/birthday-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { GiftIcon } from "@hugeicons/core-free-icons";

export default function MarketingAudiencePage() {
  const workspace = useWorkspace();
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const templates = useMemo(() => overview?.templates ?? [], [overview]);
  const [adding, setAdding] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  const addByHand = () => {
    setAdding((n) => n + 1);
    setAddOpen(true);
  };

  return (
    <>
      {overview ? (
        <AudienceTab
          categories={overview.categories}
          weeklyCap={overview.weeklyCap}
          reachable={overview.audience.whatsapp}
          optedOut={overview.audience.optedOut}
          capped={overview.audience.capped}
          onAddByHand={addByHand}
          birthdays={
            <BirthdaySettings
              key={JSON.stringify(overview.settings)}
              settings={overview.settings}
              templates={templates}
              timezone={workspace.timezone}
              withBirthday={overview.audience.withBirthday}
            />
          }
        />
      ) : (
        <AudienceTabSkeleton
          onAddByHand={addByHand}
          birthdays={<BirthdaySkeleton timezone={workspace.timezone} />}
        />
      )}
      <AddContactsDialog key={adding} open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function BirthdaySkeleton({ timezone }: { timezone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HugeiconsIcon icon={GiftIcon} strokeWidth={2} className="size-5 text-pink-600 dark:text-pink-400" />
          Birthday wishes
        </CardTitle>
        <CardDescription>
          Every customer whose birthday is today gets this, once, at the hour you pick.{" "}
          <Skeleton className="inline-block h-3.5 w-56 max-w-full align-middle" aria-hidden />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex h-5 items-center gap-3" aria-hidden>
          <Skeleton className="h-[18.4px] w-8 rounded-full" />
          <Skeleton className="h-3.5 w-6" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            <Skeleton className="h-8 w-40 rounded-lg" aria-hidden />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Send at ({timezone})</Label>
            <Skeleton className="h-8 w-28 rounded-lg" aria-hidden />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2" aria-hidden>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </CardContent>
    </Card>
  );
}
