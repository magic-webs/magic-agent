"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, ShieldCheckIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";

const MODES = [
  {
    mode: "smart",
    icon: ShieldCheckIcon,
    title: "Smart campaign",
    badge: "Safest",
    body: "Sends in daily waves to your most engaged contacts first, watches your WhatsApp quality and limit, and pauses itself if anything looks risky.",
    points: [
      "Starts small and grows: 10 → 20 → 30 → 40%",
      "Every wave stays under your daily Meta limit",
      "Holds on yellow quality, stops on red or spam",
      "A report and a notification for every wave",
    ],
  },
  {
    mode: "manual",
    icon: SlidersHorizontalIcon,
    title: "Manual campaign",
    body: "You choose when it goes and how fast. Everyone you pick is sent to in one go.",
    points: [
      "Send now or at a time you choose",
      "Pick the speed, or each person's best time",
      "Best for small, warm audiences",
    ],
  },
] as const;

export function CampaignModePicker({ base }: { base: string }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">New campaign</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          How should it go out? Both send one approved template to the people you choose.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {MODES.map(({ mode, icon: Icon, title, body, points, ...rest }) => (
          <Link
            key={mode}
            href={`${base}/new?mode=${mode}`}
            className="flex flex-col gap-3 rounded-xl border border-border p-5 outline-none transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <span className="font-semibold">{title}</span>
              {"badge" in rest ? <Badge className="ml-auto">{rest.badge}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{body}</p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {points.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  {point}
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </div>
    </div>
  );
}
