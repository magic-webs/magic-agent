"use client";

import { ActivityList } from "@/components/instagram/activity-list";

export default function InstagramActivityPage() {
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every comment and story mention the automations saw, and what they did. Kept for
          90 days.
        </p>
      </header>
      <ActivityList pageSize={30} paged />
    </div>
  );
}
