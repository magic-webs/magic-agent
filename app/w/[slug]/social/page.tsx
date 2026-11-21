"use client";

import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import { useInstagram } from "@/components/instagram/context";
import { ActivityList } from "@/components/instagram/activity-list";
import { StatTile } from "@/components/dashboard-charts";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight02Icon,
  Comment01Icon,
  Message01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

export default function InstagramOverviewPage() {
  const workspace = useWorkspace();
  const { overview } = useInstagram();
  const { totals } = overview;
  const base = `/w/${workspace.slug}/instagram`;

  const shortcuts = [
    {
      href: `${base}/comments`,
      icon: Comment01Icon,
      title: "Comment rules",
      body: "Reply under a comment and send a DM when someone comments a keyword.",
    },
    {
      href: `${base}/moderation`,
      icon: SecurityCheckIcon,
      title: "Moderation",
      body: "Hide or delete spam, links and abuse before anyone sees them.",
    },
    {
      href: `${base}/messages`,
      icon: Message01Icon,
      title: "DM tools",
      body: "Thank people who mention you in a story, and set ice breaker questions.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Last 7 days{overview.capped ? " (latest 2,000 events)" : ""}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Comments" value={totals.comments} previous={null} />
          <StatTile label="Public replies" value={totals.publicReplies} previous={null} />
          <StatTile label="DMs sent" value={totals.dms} previous={null} />
          <StatTile label="Moderated" value={totals.moderated} previous={null} />
          <StatTile label="Story mentions" value={totals.storyMentions} previous={null} />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {shortcuts.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex flex-col gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
          >
            <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-5 text-muted-foreground" />
            <p className="flex items-center gap-1 text-sm font-medium">
              {item.title}
              <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </p>
            <p className="text-xs text-muted-foreground">{item.body}</p>
          </Link>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`${base}/activity`} />}
          >
            See all
          </Button>
        </div>
        <ActivityList pageSize={8} paged={false} />
      </section>
    </div>
  );
}
