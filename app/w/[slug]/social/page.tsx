"use client";

import Link from "next/link";
import { useCachedQuery } from "@/lib/use-cached-query";
import { api } from "@/convex/_generated/api";
import { useWorkspace } from "@/components/workspace-provider";
import { useInstagram } from "@/components/instagram/context";
import { ActivityList } from "@/components/instagram/activity-list";
import { ActivityChart, RankedBars, StatTile } from "@/components/dashboard-charts";
import { useHourBucket } from "@/components/use-now";
import { DashboardSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight02Icon,
  Comment01Icon,
  Message01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

export default function SocialOverviewPage() {
  const workspace = useWorkspace();
  const { channel } = useInstagram();
  const now = useHourBucket();
  const stats = useCachedQuery(api.instagramAutomation.channelStats, { channelId: channel._id, now });
  const base = `/w/${workspace.slug}/social`;
  const instagram = channel.type === "instagram";

  if (stats === undefined) return <DashboardSkeleton />;

  const { current, previous, setup } = stats;
  const rate = current.comments ? Math.round((current.answered / current.comments) * 100) : null;
  const previousRate = previous.comments
    ? Math.round((previous.answered / previous.comments) * 100)
    : null;

  const tiles = [
    {
      href: `${base}/comments`,
      icon: Comment01Icon,
      title: "Comment rules",
      status: setup.totalRules
        ? `${setup.liveRules} of ${setup.totalRules} live`
        : "No rules yet",
      ok: setup.liveRules > 0,
      hint: setup.liveRules ? null : "Add a rule to answer comments automatically.",
    },
    {
      href: `${base}/moderation`,
      icon: SecurityCheckIcon,
      title: "Moderation",
      status: setup.moderation ? "On" : "Off",
      ok: setup.moderation,
      hint: setup.moderation ? null : "Spam and links stay up until you turn it on.",
    },
    ...(instagram
      ? [
          {
            href: `${base}/messages`,
            icon: Message01Icon,
            title: "DM tools",
            status: [
              setup.storyMention ? "Story reply on" : "Story reply off",
              `${setup.iceBreakers} ice ${setup.iceBreakers === 1 ? "breaker" : "breakers"}`,
            ].join(" · "),
            ok: setup.storyMention || setup.iceBreakers > 0,
            hint:
              setup.storyMention || setup.iceBreakers
                ? null
                : "Greet new chats and thank story mentions.",
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className={cn("grid gap-3", tiles.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="group flex items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <HugeiconsIcon icon={tile.icon} strokeWidth={2} className="size-4.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1 text-sm font-medium">
                {tile.title}
                <HugeiconsIcon
                  icon={ArrowRight02Icon}
                  strokeWidth={2}
                  className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tile.ok ? "bg-green-500" : "bg-amber-500"
                  )}
                />
                <span className="truncate">{tile.status}</span>
              </span>
              {tile.hint ? (
                <span className="text-xs text-muted-foreground">{tile.hint}</span>
              ) : null}
            </span>
          </Link>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          Last {stats.days} days
          <span className="font-normal text-muted-foreground">
            {" "}
            · compared with the {stats.days} before
            {stats.capped ? " · latest 4,000 events" : ""}
          </span>
        </h2>
        <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3", instagram ? "xl:grid-cols-6" : "xl:grid-cols-5")}>
          <StatTile
            label="Comments"
            value={current.comments}
            previous={previous.comments}
            data={stats.daily}
            dataKey="comments"
          />
          <StatTile
            label="Answered"
            value={current.answered}
            previous={previous.answered}
            data={stats.daily}
            dataKey="answered"
          />
          <StatTile label="Answer rate" value={rate} previous={previousRate} suffix="%" />
          <StatTile label="DMs sent" value={current.dms} previous={previous.dms} />
          <StatTile
            label="Moderated"
            value={current.moderated}
            previous={previous.moderated}
            data={stats.daily}
            dataKey="moderated"
          />
          {instagram ? (
            <StatTile
              label="Story mentions"
              value={current.storyMentions}
              previous={previous.storyMentions}
            />
          ) : null}
        </div>
        {current.failed ? (
          <Link
            href={`${base}/activity`}
            className="self-start text-xs font-medium text-destructive hover:underline"
          >
            {current.failed} {current.failed === 1 ? "send" : "sends"} failed this week — see
            Activity
          </Link>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Comments per day</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityChart
              data={stats.daily}
              windowDays={stats.days}
              series={{ key: "comments", label: "Comments" }}
              columns={[
                { key: "comments", label: "Comments" },
                { key: "answered", label: "Answered" },
                { key: "moderated", label: "Moderated" },
              ]}
              noun="comments"
              emptyLabel="Comments show here once people start commenting on your posts."
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Busiest rules</CardTitle>
            </CardHeader>
            <CardContent>
              <RankedBars
                data={stats.topRules}
                categoryKey="name"
                valueKey="value"
                valueLabel="Fired"
                emptyLabel="No rule has fired this week."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top commenters</CardTitle>
            </CardHeader>
            <CardContent>
              <RankedBars
                data={stats.topPeople}
                categoryKey="name"
                valueKey="value"
                valueLabel="Comments"
                emptyLabel="No comments this week."
              />
            </CardContent>
          </Card>
        </div>
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
        <ActivityList pageSize={6} paged={false} />
      </section>
    </div>
  );
}
