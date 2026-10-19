"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Composer } from "@/components/platform-notifications/composer";
import { Report } from "@/components/platform-notifications/report";

export default function AdminNotificationPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const broadcast = useQuery(
    api.platformNotifications.get,
    isNew ? "skip" : { id: id as Id<"platformBroadcasts"> }
  );

  if (isNew) return <Composer />;

  if (broadcast === undefined) {
    return (
      <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
        <PageHeaderSkeleton />
        <TableSkeleton columns={3} rows={6} />
      </div>
    );
  }

  if (broadcast === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="max-w-md border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Notification not found</EmptyTitle>
            <EmptyDescription>It may have been a draft that was deleted.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button nativeButton={false} render={<Link href="/admin/notifications" />}>
              Back to notifications
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return broadcast.status === "draft" || broadcast.status === "scheduled" ? (
    <Composer key={broadcast._id} broadcast={broadcast} />
  ) : (
    <Report broadcast={broadcast} />
  );
}
