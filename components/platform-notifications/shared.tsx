"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Mail01Icon,
  Message02Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";


export type Broadcast = Doc<"platformBroadcasts"> & { imageUrl: string | null };
export type Category = Doc<"platformBroadcasts">["category"];
export type Status = Doc<"platformBroadcasts">["status"];
export type Channel = "push" | "email" | "sms";
export type Audience = Doc<"platformBroadcasts">["audience"];

export const CATEGORIES: { value: Category; label: string; hint: string }[] = [
  { value: "update", label: "Product update", hint: "Improvements to something they already use" },
  { value: "feature", label: "New feature", hint: "Something new they can start using" },
  { value: "offer", label: "Offer", hint: "Promotions and discounts; carries an unsubscribe link" },
  { value: "notice", label: "Service notice", hint: "Maintenance, outages and account matters" },
];

export const categoryLabel = (category: Category) =>
  CATEGORIES.find((item) => item.value === category)?.label ?? category;

export const CHANNELS: { value: Channel; label: string; icon: typeof SmartPhone01Icon }[] = [
  { value: "push", label: "App push", icon: SmartPhone01Icon },
  { value: "email", label: "Email", icon: Mail01Icon },
  { value: "sms", label: "SMS", icon: Message02Icon },
];

export const STAGES: { value: NonNullable<Audience["stages"]>[number]; label: string }[] = [
  { value: "account_setup", label: "Account setup" },
  { value: "development", label: "Development" },
  { value: "testing", label: "Testing" },
  { value: "feedback", label: "Feedback" },
  { value: "live", label: "Live" },
  { value: "custom", label: "Custom" },
];

const STATUS: Record<Status, { label: string; className: string }> = {
  draft: { label: "Draft", className: "" },
  scheduled: { label: "Scheduled", className: "border-sky-500/40 text-sky-700 dark:text-sky-300" },
  sending: { label: "Sending", className: "border-amber-500/40 text-amber-700 dark:text-amber-300" },
  sent: { label: "Sent", className: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" },
  cancelled: { label: "Stopped", className: "text-muted-foreground" },
  failed: { label: "Failed", className: "border-destructive/40 text-destructive" },
};

export function StatusBadge({ status }: { status: Status }) {
  const shape = STATUS[status];
  return (
    <Badge variant="outline" className={cn(shape.className)}>
      {shape.label}
    </Badge>
  );
}

export function ChannelIcons({ channels }: { channels: Broadcast["channels"] }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {CHANNELS.filter((channel) => channels[channel.value]).map((channel) => (
        <HugeiconsIcon icon={channel.icon} strokeWidth={2} key={channel.value} className="size-4" aria-label={channel.label} />
      ))}
    </div>
  );
}

export function audienceText(audience: Audience, planName?: (id: string) => string): string {
  if (audience.kind === "all") return "All active workspaces";
  if (audience.kind === "stages") {
    const labels = (audience.stages ?? []).map(
      (stage) => STAGES.find((item) => item.value === stage)?.label ?? stage
    );
    return `Stage: ${labels.join(", ")}`;
  }
  if (audience.kind === "plans") {
    const names = (audience.planIds ?? []).map((id) => planName?.(id) ?? "plan");
    return `Plan: ${names.join(", ")}`;
  }
  const count = audience.workspaceIds?.length ?? 0;
  return `${count} workspace${count === 1 ? "" : "s"}`;
}

export function PushPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[28px] border bg-gradient-to-b from-zinc-800 to-zinc-950 p-3 pt-8 shadow-sm">
      <p className="mb-6 text-center font-heading text-4xl font-light text-white/90">9:41</p>
      <div className="rounded-2xl bg-white/85 p-3 backdrop-blur dark:bg-zinc-800/90">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex size-5 items-center justify-center rounded-md bg-[#0c7d3e] text-[9px] font-bold text-white">
            M
          </div>
          <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Magic Agent
          </span>
          <span className="ml-auto text-[11px] text-zinc-500 dark:text-zinc-400">now</span>
        </div>
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {title || "Notification title"}
        </p>
        <p className="line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">
          {body || "Your message appears here."}
        </p>
      </div>
    </div>
  );
}

export function SmsPreview({ text }: { text: string }) {
  return (
    <div className="rounded-xl border bg-muted/40 p-3">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs">
        {text || "Your SMS appears here."}
      </div>
    </div>
  );
}
