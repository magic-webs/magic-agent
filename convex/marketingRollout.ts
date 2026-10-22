import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { templateBlocker, zonedParts } from "./lib/marketing";
import { eventKey, hourlySent, statsFor, waveKey, type MarketingCounts } from "./lib/marketingStats";
import {
  dailyLimit,
  decide,
  nextCheckAt,
  normaliseQuality,
  normaliseTier,
  rateFor,
  scoreContact,
  usedSince,
  waveTargets,
  type Quality,
  type WaveMetrics,
} from "./lib/rollout";
import { readHealth } from "./lib/whatsappHealth";
import { notifyRollout, pauseRollout } from "./lib/rolloutPause";
import { healthQuality } from "./schema/marketing";
import { sendingChannel } from "./marketing";

const ASSIGN_BATCH = 400;
const CHECK_HISTORY = 200;
const HEALTH_FRESH_MS = 60_000;

async function healthRow(ctx: QueryCtx, channelId: Id<"channels">) {
  return await ctx.db
    .query("channelHealth")
    .withIndex("by_channelId", (q) => q.eq("channelId", channelId))
    .unique();
}

function metricsOf(stats: MarketingCounts): WaveMetrics {
  return {
    sent: stats.sent,
    failed: stats.failed,
    delivered: stats.delivered,
    optedOut: stats.optedOut,
    heldBack: stats.heldBack,
    blocked: stats.blocked,
    unreachable: stats.unreachable,
  };
}

function whenLabel(at: number, timeZone: string) {
  const local = zonedParts(at, timeZone);
  return `${local.date} at ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
}

export const health = query({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const channel = await sendingChannel(ctx, args.workspaceId);
    if (!channel) return null;
    const row = await healthRow(ctx, channel._id);
    return {
      quality: (row?.quality ?? "UNKNOWN") as Quality,
      limitTier: row?.limitTier ?? null,
      alert: row?.alert ?? null,
      checkedAt: row?.checkedAt ?? null,
      used24h: usedSince(await hourlySent(ctx, args.workspaceId, args.now), args.now),
    };
  },
});

export const healthChannel = internalQuery({
  args: { workspaceId: v.id("workspaces"), owner: v.boolean() },
  handler: async (ctx, args) => {
    if (args.owner) await requireWorkspace(ctx, args.workspaceId);
    const channel = await sendingChannel(ctx, args.workspaceId);
    if (!channel?.whatsapp) return null;
    const row = await healthRow(ctx, channel._id);
    return {
      channelId: channel._id,
      checkedAt: row?.checkedAt ?? null,
      whatsapp: {
        apiBaseUrl: channel.whatsapp.apiBaseUrl,
        apiVersion: channel.whatsapp.apiVersion,
        phoneNumberId: channel.whatsapp.phoneNumberId,
        accessToken: channel.whatsapp.accessToken,
      },
    };
  },
});

export const refreshHealth = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<null> => {
    const channel = await ctx.runQuery(internal.marketingRollout.healthChannel, {
      workspaceId: args.workspaceId,
      owner: true,
    });
    if (!channel) return null;
    if (channel.checkedAt && Date.now() - channel.checkedAt < HEALTH_FRESH_MS) return null;
    const reading = await readHealth(channel.whatsapp);
    await ctx.runMutation(internal.marketingRollout.saveHealth, {
      workspaceId: args.workspaceId,
      channelId: channel.channelId,
      ok: reading.ok,
      quality: reading.quality,
      limitTier: reading.limitTier,
      throughput: reading.throughput,
    });
    return null;
  },
});

export const saveHealth = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    ok: v.boolean(),
    quality: healthQuality,
    limitTier: v.optional(v.string()),
    throughput: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await healthRow(ctx, args.channelId);
    const now = Date.now();
    if (!args.ok) {
      if (row) await ctx.db.patch("channelHealth", row._id, { checkedAt: now });
      else {
        await ctx.db.insert("channelHealth", {
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          quality: "UNKNOWN",
          source: "meta",
          checkedAt: now,
        });
      }
      return;
    }
    const fields = {
      quality: args.quality,
      limitTier: args.limitTier ?? row?.limitTier,
      throughput: args.throughput ?? row?.throughput,
      source: "meta" as const,
      checkedAt: now,
    };
    if (row) await ctx.db.patch("channelHealth", row._id, fields);
    else await ctx.db.insert("channelHealth", { workspaceId: args.workspaceId, channelId: args.channelId, ...fields });
  },
});

export const progress = query({
  args: { eventId: v.id("marketingEvents"), now: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event?.rollout) return null;
    await requireWorkspace(ctx, event.workspaceId);
    const checks = await ctx.db
      .query("rolloutChecks")
      .withIndex("by_eventId_and_at", (q) => q.eq("eventId", event._id))
      .order("desc")
      .take(CHECK_HISTORY);
    const launches = checks.filter((check) => check.decision === "launch").reverse();
    const waves = [];
    for (const launch of launches) {
      waves.push({
        wave: launch.wave,
        at: launch.at,
        size: launch.size ?? 0,
        stats: await statsFor(ctx, waveKey(eventKey(event._id), launch.wave)),
      });
    }
    const channel = await sendingChannel(ctx, event.workspaceId);
    const row = channel ? await healthRow(ctx, channel._id) : null;
    return {
      rollout: event.rollout,
      checks,
      waves,
      health: {
        quality: (row?.quality ?? "UNKNOWN") as Quality,
        limitTier: row?.limitTier ?? event.rollout.limitTier ?? null,
        checkedAt: row?.checkedAt ?? null,
        used24h: usedSince(await hourlySent(ctx, event.workspaceId, args.now), args.now),
      },
    };
  },
});

export const planContext = internalQuery({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event?.rollout || event.status !== "sending" || event.rollout.phase !== "planning") return null;
    return { workspaceId: event.workspaceId, audience: event.audience };
  },
});

export const plan = internalAction({
  args: { eventId: v.id("marketingEvents"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const event = await ctx.runQuery(internal.marketingRollout.planContext, { eventId: args.eventId });
    if (!event) return null;
    const page = await ctx.runQuery(internal.marketing.audiencePage, {
      workspaceId: event.workspaceId,
      key: eventKey(args.eventId),
      audience: event.audience,
      now: Date.now(),
      planning: true,
      cursor: args.cursor,
    });
    await ctx.runMutation(internal.marketingRollout.addToPool, {
      eventId: args.eventId,
      contactIds: page.contacts.map((contact) => contact.contactId),
      cursor: page.isDone ? null : page.continueCursor,
    });
    return null;
  },
});

export const addToPool = internalMutation({
  args: {
    eventId: v.id("marketingEvents"),
    contactIds: v.array(v.id("contacts")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    const rollout = event?.rollout;
    if (!event || !rollout || event.status !== "sending" || rollout.phase !== "planning") return;
    const now = Date.now();
    let added = 0;
    for (const contactId of args.contactIds) {
      const existing = await ctx.db
        .query("rolloutRecipients")
        .withIndex("by_eventId_and_contactId", (q) => q.eq("eventId", event._id).eq("contactId", contactId))
        .unique();
      if (existing) continue;
      const contact = await ctx.db.get("contacts", contactId);
      if (!contact) continue;
      await ctx.db.insert("rolloutRecipients", {
        eventId: event._id,
        contactId,
        score: rollout.engagedFirst ? scoreContact(contact, now) : 0,
      });
      added++;
    }
    const planned = rollout.planned + added;

    if (args.cursor !== null) {
      await ctx.db.patch("marketingEvents", event._id, {
        rollout: { ...rollout, planned, queued: planned, planCursor: args.cursor },
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.marketingRollout.plan, {
        eventId: event._id,
        cursor: args.cursor,
      });
      return;
    }

    if (planned === 0) {
      await ctx.db.patch("marketingEvents", event._id, {
        status: "sent",
        finishedAt: now,
        lastError: "Nobody in this audience can be sent to.",
        rollout: { ...rollout, phase: "done", planned: 0, queued: 0, planCursor: undefined },
        updatedAt: now,
      });
      return;
    }

    const targets = waveTargets(planned, rollout.shares);
    await ctx.db.patch("marketingEvents", event._id, {
      rollout: {
        ...rollout,
        phase: "watching",
        planned,
        queued: planned,
        planCursor: undefined,
        targets,
        step: 0,
        stepLeft: targets[0] ?? planned,
        nextCheckAt: now,
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.marketingRollout.check, { eventId: event._id, at: now });
  },
});

export const checkContext = internalQuery({
  args: { eventId: v.id("marketingEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event?.rollout || event.status !== "sending") return null;
    return { workspaceId: event.workspaceId, nextCheckAt: event.rollout.nextCheckAt ?? null };
  },
});

export const check = internalAction({
  args: { eventId: v.id("marketingEvents"), at: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const event = await ctx.runQuery(internal.marketingRollout.checkContext, { eventId: args.eventId });
    if (!event || event.nextCheckAt !== args.at) return null;
    const channel = await ctx.runQuery(internal.marketingRollout.healthChannel, {
      workspaceId: event.workspaceId,
      owner: false,
    });
    if (channel) {
      const reading = await readHealth(channel.whatsapp);
      await ctx.runMutation(internal.marketingRollout.saveHealth, {
        workspaceId: event.workspaceId,
        channelId: channel.channelId,
        ok: reading.ok,
        quality: reading.quality,
        limitTier: reading.limitTier,
        throughput: reading.throughput,
      });
    }
    await ctx.runMutation(internal.marketingRollout.act, { eventId: args.eventId, at: args.at });
    return null;
  },
});

async function assignBatch(
  ctx: MutationCtx,
  eventId: Id<"marketingEvents">,
  wave: number,
  count: number
): Promise<number> {
  const rows = await ctx.db
    .query("rolloutRecipients")
    .withIndex("by_eventId_and_wave_and_score", (q) => q.eq("eventId", eventId).eq("wave", undefined))
    .order("desc")
    .take(Math.min(count, ASSIGN_BATCH));
  for (const row of rows) await ctx.db.patch("rolloutRecipients", row._id, { wave });
  return rows.length;
}

export const act = internalMutation({
  args: { eventId: v.id("marketingEvents"), at: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    const rollout = event?.rollout;
    if (!event || !rollout || event.status !== "sending" || rollout.nextCheckAt !== args.at) return;
    const now = Date.now();
    const template = event.templateId ? await ctx.db.get("marketingTemplates", event.templateId) : null;
    const channel = await sendingChannel(ctx, event.workspaceId);
    const health = channel ? await healthRow(ctx, channel._id) : null;
    const limitTier = health?.limitTier ?? rollout.limitTier;
    const hours = await hourlySent(ctx, event.workspaceId, now);
    const previous =
      rollout.wave > 0 && rollout.ackWave !== rollout.wave
        ? metricsOf(await statsFor(ctx, waveKey(eventKey(event._id), rollout.wave)))
        : null;
    const targets = rollout.targets ?? [];
    const lastStep = rollout.step >= targets.length - 1;
    const target = lastStep ? rollout.queued : Math.max(rollout.stepLeft, 1);

    const decision = decide({
      now,
      quality: health?.quality ?? "UNKNOWN",
      limit: dailyLimit(limitTier),
      hours,
      templateBlocker: template ? templateBlocker(template) : "The template was removed.",
      templateQuality: template?.qualityScore,
      previous,
      waveEndedAt: rollout.waveEndedAt,
      queued: rollout.queued,
      target,
      lastSize: rollout.lastSize,
      shrink: rollout.shrink,
      holds: rollout.holds,
      heldForWave: rollout.heldForWave ?? false,
    });

    await ctx.db.insert("rolloutChecks", {
      eventId: event._id,
      wave: rollout.wave,
      at: now,
      quality: health?.quality ?? "UNKNOWN",
      limitTier,
      used24h: usedSince(hours, now),
      metrics: previous ?? undefined,
      decision: decision.kind,
      size: decision.kind === "launch" ? decision.size : undefined,
      reason: decision.reason,
    });

    if (decision.kind === "launch") {
      const wave = rollout.wave + 1;
      const assigned = await assignBatch(ctx, event._id, wave, decision.size);
      let step = rollout.step;
      let stepLeft = rollout.stepLeft - decision.size;
      const cut = lastStep ? decision.size < rollout.queued : stepLeft > 0;
      if (!lastStep && stepLeft <= 0) {
        step += 1;
        stepLeft = targets[step] ?? 0;
      }
      await ctx.db.patch("marketingEvents", event._id, {
        cursor: null,
        ratePerMinute: rateFor(decision.size),
        rollout: {
          ...rollout,
          phase: "sending",
          wave,
          step,
          stepLeft: Math.max(0, stepLeft),
          queued: Math.max(0, rollout.queued - decision.size),
          lastSize: decision.size,
          shrink: undefined,
          holds: 0,
          heldForWave: false,
          waveGap: cut ? 1 : rollout.gapDays,
          waveStartedAt: now,
          waveEndedAt: undefined,
          nextCheckAt: undefined,
        },
        updatedAt: now,
      });
      if (decision.size > assigned && assigned === ASSIGN_BATCH) {
        await ctx.scheduler.runAfter(0, internal.marketingRollout.assignWave, {
          eventId: event._id,
          wave,
          left: decision.size - assigned,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.marketingSend.runEvent, { eventId: event._id, cursor: null });
      }
      return;
    }

    if (decision.kind === "hold" || decision.kind === "wait") {
      await ctx.db.patch("marketingEvents", event._id, {
        rollout: {
          ...rollout,
          ...(decision.kind === "hold"
            ? { phase: "holding" as const, holds: rollout.holds + 1, shrink: decision.shrink, heldForWave: true }
            : {}),
          nextCheckAt: decision.until,
        },
        updatedAt: now,
      });
      await ctx.scheduler.runAt(decision.until, internal.marketingRollout.check, {
        eventId: event._id,
        at: decision.until,
      });
      if (decision.kind === "hold") {
        await notifyRollout(ctx, event, "campaign_hold", `${decision.reason} Next check ${whenLabel(decision.until, await timeZoneOf(ctx, event))}.`);
      }
      return;
    }

    if (decision.kind === "pause") {
      await ctx.db.patch("marketingEvents", event._id, {
        status: "paused",
        lastError: decision.reason,
        rollout: { ...rollout, nextCheckAt: undefined },
        updatedAt: now,
      });
      await notifyRollout(ctx, event, "campaign_paused", decision.reason);
      return;
    }

    await finish(ctx, event, now);
  },
});

async function timeZoneOf(ctx: QueryCtx, event: Doc<"marketingEvents">) {
  return (await ctx.db.get("workspaces", event.workspaceId))?.timezone ?? "UTC";
}

async function finish(ctx: MutationCtx, event: Doc<"marketingEvents">, now: number) {
  if (!event.rollout) return;
  await ctx.db.patch("marketingEvents", event._id, {
    status: "sent",
    finishedAt: now,
    rollout: { ...event.rollout, phase: "done", nextCheckAt: undefined },
    updatedAt: now,
  });
  const stats = await statsFor(ctx, eventKey(event._id));
  await notifyRollout(
    ctx,
    event,
    "campaign_done",
    `Sent to ${stats.sent.toLocaleString()} people over ${event.rollout.wave} waves.`
  );
}

export const assignWave = internalMutation({
  args: { eventId: v.id("marketingEvents"), wave: v.number(), left: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    if (!event?.rollout || event.status !== "sending" || event.rollout.wave !== args.wave) return;
    const assigned = await assignBatch(ctx, event._id, args.wave, args.left);
    const left = args.left - assigned;
    if (left > 0 && assigned === ASSIGN_BATCH) {
      await ctx.scheduler.runAfter(0, internal.marketingRollout.assignWave, { ...args, left });
    } else {
      await ctx.scheduler.runAfter(0, internal.marketingSend.runEvent, { eventId: event._id, cursor: null });
    }
  },
});

export const waveSent = internalMutation({
  args: { eventId: v.id("marketingEvents"), wave: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get("marketingEvents", args.eventId);
    const rollout = event?.rollout;
    if (!event || !rollout || rollout.phase !== "sending" || rollout.wave !== args.wave) return;
    const now = Date.now();
    if (rollout.queued <= 0) {
      await finish(ctx, event, now);
      return;
    }
    const timeZone = await timeZoneOf(ctx, event);
    const at = nextCheckAt({
      waveStartedAt: rollout.waveStartedAt ?? now,
      waveEndedAt: now,
      sendHour: event.sendHour,
      gapDays: rollout.waveGap ?? rollout.gapDays,
      timeZone,
    });
    await ctx.db.patch("marketingEvents", event._id, {
      rollout: { ...rollout, phase: "watching", waveEndedAt: now, nextCheckAt: at },
      updatedAt: now,
    });
    await ctx.scheduler.runAt(at, internal.marketingRollout.check, { eventId: event._id, at });
    const stats = await statsFor(ctx, waveKey(eventKey(event._id), args.wave));
    await notifyRollout(
      ctx,
      event,
      "campaign_wave",
      `Wave ${args.wave} went to ${stats.sent.toLocaleString()} people. ${rollout.queued.toLocaleString()} still to go — the next wave is checked ${whenLabel(at, timeZone)}.`
    );
  },
});

export const pause = internalMutation({
  args: { eventId: v.id("marketingEvents"), error: v.string() },
  handler: async (ctx, args) => {
    await pauseRollout(ctx, args.eventId, args.error);
  },
});

export async function resumeRollout(ctx: MutationCtx, event: Doc<"marketingEvents">) {
  const rollout = event.rollout;
  if (!rollout) throw new ConvexError("This is not a smart campaign.");
  const now = Date.now();
  const ackWave = event.lastError ? rollout.wave : rollout.ackWave;
  if (rollout.phase === "planning") {
    await ctx.db.patch("marketingEvents", event._id, { status: "sending", lastError: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.marketingRollout.plan, {
      eventId: event._id,
      cursor: rollout.planCursor ?? null,
    });
    return;
  }
  if (rollout.phase === "sending") {
    await ctx.db.patch("marketingEvents", event._id, {
      status: "sending",
      lastError: undefined,
      rollout: { ...rollout, ackWave },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.marketingSend.runEvent, {
      eventId: event._id,
      cursor: event.cursor ?? null,
    });
    return;
  }
  await ctx.db.patch("marketingEvents", event._id, {
    status: "sending",
    lastError: undefined,
    rollout: { ...rollout, ackWave, holds: 0, nextCheckAt: now },
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.marketingRollout.check, { eventId: event._id, at: now });
}

async function matchTemplates(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  value: Record<string, unknown>
) {
  const id = value.message_template_id !== undefined ? String(value.message_template_id) : null;
  const name = typeof value.message_template_name === "string" ? value.message_template_name : null;
  const templates = await ctx.db
    .query("marketingTemplates")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(500);
  return templates.filter(
    (template) =>
      (id !== null && template.metaTemplateId === id) ||
      (name !== null && template.metaTemplateName === name)
  );
}

export const applyHealthWebhook = internalMutation({
  args: {
    channelKey: v.string(),
    changes: v.array(v.object({ field: v.string(), value: v.any() })),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_channelKey", (q) => q.eq("channelKey", args.channelKey))
      .unique();
    if (!channel) return;
    const now = Date.now();
    const patch: Partial<Doc<"channelHealth">> = {};

    for (const change of args.changes) {
      const value = (change.value ?? {}) as Record<string, unknown>;
      if (change.field === "phone_number_quality_update") {
        const event = String(value.event ?? "").toUpperCase();
        if (event === "FLAGGED") patch.quality = "RED";
        else if (event === "UNFLAGGED") patch.quality = "UNKNOWN";
        const tier = normaliseTier(value.current_limit ?? value.max_daily_conversations_per_business);
        if (tier) patch.limitTier = tier;
      } else if (change.field === "business_capability_update") {
        const tier = normaliseTier(
          value.max_daily_conversations_per_business ?? value.max_daily_conversation_per_phone
        );
        if (tier) patch.limitTier = tier;
      } else if (change.field === "account_alerts") {
        const alert = [value.alert_type, value.alert_description].filter((part) => typeof part === "string").join(": ");
        if (alert) patch.alert = alert.slice(0, 200);
      } else if (change.field === "message_template_status_update") {
        const status = String(value.event ?? "").toUpperCase();
        if (!status) continue;
        for (const template of await matchTemplates(ctx, channel.workspaceId, value)) {
          if (template.metaStatus === "CHANGED") continue;
          await ctx.db.patch(
            "marketingTemplates",
            template._id,
            status === "FLAGGED"
              ? { qualityScore: "YELLOW", updatedAt: now }
              : {
                  metaStatus: status,
                  metaRejectedReason:
                    status === "REJECTED" && typeof value.reason === "string" ? value.reason : undefined,
                  updatedAt: now,
                }
          );
        }
      } else if (change.field === "message_template_quality_update") {
        const score = normaliseQuality(value.new_quality_score);
        for (const template of await matchTemplates(ctx, channel.workspaceId, value)) {
          await ctx.db.patch("marketingTemplates", template._id, { qualityScore: score, updatedAt: now });
        }
      }
    }

    if (Object.keys(patch).length === 0) return;
    const row = await healthRow(ctx, channel._id);
    if (row) await ctx.db.patch("channelHealth", row._id, { ...patch, source: "webhook", checkedAt: now });
    else {
      await ctx.db.insert("channelHealth", {
        workspaceId: channel.workspaceId,
        channelId: channel._id,
        quality: patch.quality ?? "UNKNOWN",
        limitTier: patch.limitTier,
        alert: patch.alert,
        source: "webhook",
        checkedAt: now,
      });
    }
  },
});
