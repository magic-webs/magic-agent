import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function notifyRollout(
  ctx: MutationCtx,
  event: { _id: Id<"marketingEvents">; workspaceId: Id<"workspaces">; title: string },
  kind: "campaign_wave" | "campaign_hold" | "campaign_paused" | "campaign_done",
  message: string
) {
  const titles = {
    campaign_wave: `${event.title}: wave sent`,
    campaign_hold: `${event.title}: holding`,
    campaign_paused: `${event.title}: paused`,
    campaign_done: `${event.title}: finished`,
  };
  await ctx.scheduler.runAfter(0, internal.push.notify, {
    workspaceId: event.workspaceId,
    event: kind,
    data: { title: titles[kind], message, eventId: event._id },
  });
}

export async function pauseRollout(
  ctx: MutationCtx,
  eventId: Id<"marketingEvents">,
  reason: string
) {
  const event = await ctx.db.get("marketingEvents", eventId);
  if (!event?.rollout || event.status !== "sending") return;
  const now = Date.now();
  await ctx.db.patch("marketingEvents", event._id, {
    status: "paused",
    lastError: reason,
    rollout: { ...event.rollout, nextCheckAt: undefined },
    updatedAt: now,
  });
  await ctx.db.insert("rolloutChecks", {
    eventId: event._id,
    wave: event.rollout.wave,
    at: now,
    decision: "pause",
    reason,
  });
  await notifyRollout(ctx, event, "campaign_paused", reason);
}
