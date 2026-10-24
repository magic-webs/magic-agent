import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Delivery } from "./delivery";
import { noteContactActivity, noteContactRead } from "./contactActivity";
import { zonedParts } from "./marketing";
import { failureClass } from "./metaErrors";
import { pauseRollout } from "./rolloutPause";

// Receipts for one send land within seconds of each other, so the counters are
// spread over shards to keep them from contending on a single document.
const SHARDS = 8;
const REPLY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const OPT_OUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CONVERSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type MarketingCounts = {
  sent: number;
  failed: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  optedOut: number;
  converted: number;
  heldBack: number;
  blocked: number;
  unreachable: number;
};

export const EMPTY_COUNTS: MarketingCounts = {
  sent: 0,
  failed: 0,
  delivered: 0,
  read: 0,
  replied: 0,
  clicked: 0,
  optedOut: 0,
  converted: 0,
  heldBack: 0,
  blocked: 0,
  unreachable: 0,
};

export async function bumpStats(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  key: string,
  delta: Partial<MarketingCounts>,
  options: { rollup?: boolean } = {}
) {
  const shard = Math.floor(Math.random() * SHARDS);
  const add = (row: Partial<MarketingCounts>) => {
    const patch: Partial<MarketingCounts> = {};
    for (const [field, value] of Object.entries(delta) as Array<[keyof MarketingCounts, number]>) {
      patch[field] = (row[field] ?? 0) + value;
    }
    return patch;
  };

  const row = await ctx.db
    .query("marketingStats")
    .withIndex("by_key_and_shard", (q) => q.eq("key", key).eq("shard", shard))
    .unique();
  if (row) await ctx.db.patch("marketingStats", row._id, add(row));
  else await ctx.db.insert("marketingStats", { workspaceId, key, shard, ...EMPTY_COUNTS, ...delta });
  if (options.rollup === false) return;

  if (delta.sent) {
    const hour = Math.floor(Date.now() / HOUR_MS);
    const hourly = await ctx.db
      .query("marketingHourly")
      .withIndex("by_workspaceId_and_hour_and_shard", (q) =>
        q.eq("workspaceId", workspaceId).eq("hour", hour).eq("shard", shard)
      )
      .unique();
    if (hourly) await ctx.db.patch("marketingHourly", hourly._id, { sent: hourly.sent + delta.sent });
    else await ctx.db.insert("marketingHourly", { workspaceId, hour, shard, sent: delta.sent });
  }

  const workspace = await ctx.db.get("workspaces", workspaceId);
  const day = zonedParts(Date.now(), workspace?.timezone ?? "UTC").date;
  const daily = await ctx.db
    .query("marketingDaily")
    .withIndex("by_workspaceId_and_day_and_shard", (q) =>
      q.eq("workspaceId", workspaceId).eq("day", day).eq("shard", shard)
    )
    .unique();
  if (daily) await ctx.db.patch("marketingDaily", daily._id, add(daily));
  else await ctx.db.insert("marketingDaily", { workspaceId, day, shard, ...EMPTY_COUNTS, ...delta });
}

export async function dailyStats(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  from: string,
  to: string
) {
  const span = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const rows = await ctx.db
    .query("marketingDaily")
    .withIndex("by_workspaceId_and_day_and_shard", (q) =>
      q.eq("workspaceId", workspaceId).gte("day", from).lte("day", to)
    )
    .order("desc")
    .take(SHARDS * span);
  const days = new Map<string, MarketingCounts>();
  for (const row of rows) {
    const total = days.get(row.day) ?? { ...EMPTY_COUNTS };
    for (const field of Object.keys(total) as Array<keyof MarketingCounts>) {
      total[field] += row[field] ?? 0;
    }
    days.set(row.day, total);
  }
  return days;
}

export async function statsFor(ctx: QueryCtx, key: string): Promise<MarketingCounts> {
  const rows = await ctx.db
    .query("marketingStats")
    .withIndex("by_key_and_shard", (q) => q.eq("key", key))
    .take(SHARDS);
  const total = { ...EMPTY_COUNTS };
  for (const row of rows) {
    for (const field of Object.keys(total) as Array<keyof MarketingCounts>) {
      total[field] += row[field] ?? 0;
    }
  }
  return total;
}

export function eventKey(eventId: Id<"marketingEvents">) {
  return `event:${eventId}`;
}

export function waveKey(key: string, wave: number) {
  return `${key}#w${wave}`;
}

export async function hourlySent(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  now: number
): Promise<Array<{ hour: number; sent: number }>> {
  const from = Math.floor(now / HOUR_MS) - 23;
  const rows = await ctx.db
    .query("marketingHourly")
    .withIndex("by_workspaceId_and_hour_and_shard", (q) =>
      q.eq("workspaceId", workspaceId).gte("hour", from)
    )
    .take(SHARDS * 26);
  const hours = new Map<number, number>();
  for (const row of rows) hours.set(row.hour, (hours.get(row.hour) ?? 0) + row.sent);
  return [...hours.entries()].map(([hour, sent]) => ({ hour, sent }));
}

async function bumpSend(
  ctx: MutationCtx,
  send: Doc<"marketingSends">,
  delta: Partial<MarketingCounts>
) {
  await bumpStats(ctx, send.workspaceId, send.key, delta);
  if (send.wave !== undefined) {
    await bumpStats(ctx, send.workspaceId, waveKey(send.key, send.wave), delta, { rollup: false });
  }
}

export async function noteSendDelivery(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  delivery: Delivery,
  at: number,
  error?: string
) {
  const send = await ctx.db
    .query("marketingSends")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .first();
  if (send) await noteDelivery(ctx, send, delivery, at, error);
}

/** A receipt for a send no thread holds, or for the message that does. */
export async function noteDelivery(
  ctx: MutationCtx,
  send: Doc<"marketingSends">,
  delivery: Delivery,
  at: number,
  error?: string
) {
  if (send.status !== "sent") return;

  const patch: Partial<Doc<"marketingSends">> = { delivery };
  const delta: Partial<MarketingCounts> = {};
  const kind = delivery === "failed" ? failureClass(error) : null;
  if (delivery === "failed") {
    delta.failed = 1;
    delta.sent = -1;
    patch.error = error?.slice(0, 300);
    if (kind) delta[kind] = 1;
  }
  if ((delivery === "delivered" || delivery === "read") && !send.deliveredAt) {
    patch.deliveredAt = at;
    delta.delivered = 1;
  }
  if (delivery === "read" && !send.readAt) {
    patch.readAt = at;
    delta.read = 1;
  }
  await ctx.db.patch("marketingSends", send._id, patch);
  if (patch.readAt) await noteContactRead(ctx, send.contactId, at);
  if (Object.keys(delta).length > 0) await bumpSend(ctx, send, delta);
  if (kind === "blocked" && send.eventId && send.wave !== undefined) {
    await pauseRollout(
      ctx,
      send.eventId,
      "WhatsApp refused a message for spam or policy. Paused to protect your number."
    );
  }
}

async function latestSend(ctx: MutationCtx, contactId: Id<"contacts">, since: number) {
  return await ctx.db
    .query("marketingSends")
    .withIndex("by_contactId_and_createdAt", (q) =>
      q.eq("contactId", contactId).gte("createdAt", since)
    )
    .order("desc")
    .filter((q) => q.eq(q.field("status"), "sent"))
    .first();
}

export async function noteReply(ctx: MutationCtx, contactId: Id<"contacts">, at: number) {
  const send = await latestSend(ctx, contactId, at - REPLY_WINDOW_MS);
  if (!send) return null;
  if (send.repliedAt) return send;
  const delta: Partial<MarketingCounts> = { replied: 1 };
  const patch: Partial<Doc<"marketingSends">> = { repliedAt: at };
  if (!send.readAt) {
    patch.readAt = at;
    delta.read = 1;
  }
  if (!send.deliveredAt) {
    patch.deliveredAt = at;
    delta.delivered = 1;
  }
  await ctx.db.patch("marketingSends", send._id, patch);
  await bumpSend(ctx, send, delta);
  await noteContactActivity(ctx, contactId, "lastRepliedAt", at);
  if (patch.readAt) await noteContactRead(ctx, contactId, at);
  return send;
}

export async function noteOptOut(ctx: MutationCtx, contactId: Id<"contacts">, at: number) {
  const send = await latestSend(ctx, contactId, at - OPT_OUT_WINDOW_MS);
  if (!send || send.optedOutAt) return;
  await ctx.db.patch("marketingSends", send._id, { optedOutAt: at });
  await bumpSend(ctx, send, { optedOut: 1 });
}

export async function noteConversion(ctx: MutationCtx, contactId: Id<"contacts">, at: number) {
  const send = await latestSend(ctx, contactId, at - CONVERSION_WINDOW_MS);
  if (!send || send.convertedAt) return;
  await ctx.db.patch("marketingSends", send._id, { convertedAt: at });
  await bumpSend(ctx, send, { converted: 1 });
}

export async function noteClick(ctx: MutationCtx, sendId: Id<"marketingSends">, at: number) {
  const send = await ctx.db.get("marketingSends", sendId);
  if (!send || send.clickedAt) return send;
  await ctx.db.patch("marketingSends", send._id, { clickedAt: at });
  await bumpSend(ctx, send, { clicked: 1 });
  return send;
}

export async function sentRecently(
  ctx: QueryCtx,
  contactId: Id<"contacts">,
  since: number
): Promise<number> {
  const rows = await ctx.db
    .query("marketingSends")
    .withIndex("by_contactId_and_createdAt", (q) =>
      q.eq("contactId", contactId).gte("createdAt", since)
    )
    .take(50);
  return rows.filter((row) => row.status === "sent" && !row.key.startsWith("birthday:"))
    .length;
}
