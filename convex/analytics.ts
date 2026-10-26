import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspace } from "./lib/auth";
import { dayKey } from "./lib/dailyStats";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the workspace dashboard plots, in one read.
 *
 * `now` is an argument rather than a `Date.now()` call: Convex queries are not
 * re-run just because time passed, so a wall-clock read inside one would go
 * stale and would also poison the query cache. The client passes a value
 * rounded to the hour, which keeps the cache key stable.
 */
export const dashboard = query({
  args: {
    workspaceId: v.id("workspaces"),
    days: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);

    const days = Math.max(1, Math.min(Math.floor(args.days), 90));
    // Bucket boundaries are UTC midnights; `now` decides which day is "today".
    const todayStart = Date.UTC(
      new Date(args.now).getUTCFullYear(),
      new Date(args.now).getUTCMonth(),
      new Date(args.now).getUTCDate()
    );
    const windowStart = todayStart - (days - 1) * DAY_MS;
    const previousStart = windowStart - days * DAY_MS;

    const [allConversations, dailyRows] = await Promise.all([
      ctx.db
        .query("conversations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect(),
      ctx.db
        .query("dailyStats")
        .withIndex("by_workspace_day", (q) =>
          q.eq("workspaceId", args.workspaceId).gte("day", dayKey(previousStart))
        )
        .collect(),
    ]);

    // A thread the marketing desk opened, that the customer has not answered,
    // is a message sent rather than a conversation had — counting them would
    // turn one campaign into thousands of "conversations".
    const conversations = allConversations.filter((row) => !row.marketingOnly);

    // --- daily series -----------------------------------------------------
    const buckets = new Map<
      string,
      {
        date: string;
        conversations: number;
        messages: number;
        /** Mean assistant reply time that day, in seconds. Null on quiet days. */
        replySeconds: number | null;
      }
    >();
    for (let i = 0; i < days; i++) {
      const key = dayKey(windowStart + i * DAY_MS);
      buckets.set(key, {
        date: key,
        conversations: 0,
        messages: 0,
        replySeconds: null,
      });
    }

    for (const row of conversations) {
      const bucket = buckets.get(dayKey(row.createdAt));
      if (bucket) bucket.conversations += 1;
    }
    for (const row of dailyRows) {
      const bucket = buckets.get(row.day);
      if (!bucket) continue;
      bucket.messages = row.messages;
      if (row.latencyCount > 0) {
        bucket.replySeconds =
          Math.round((row.latencyTotalMs / row.latencyCount / 1000) * 10) / 10;
      }
    }

    // --- window vs the window before it, for the stat deltas --------------
    const inWindow = (timestamp: number) => timestamp >= windowStart;
    const inPrevious = (timestamp: number) =>
      timestamp >= previousStart && timestamp < windowStart;

    const count = <T extends { createdAt: number }>(
      rows: T[],
      predicate: (timestamp: number) => boolean
    ) => rows.filter((row) => predicate(row.createdAt)).length;

    const windowDay = dayKey(windowStart);
    const sumDays = (inRange: (day: string) => boolean) => {
      const rows = dailyRows.filter((row) => inRange(row.day));
      const latencyCount = rows.reduce((sum, row) => sum + row.latencyCount, 0);
      return {
        messages: rows.reduce((sum, row) => sum + row.messages, 0),
        avgLatencyMs: latencyCount
          ? Math.round(
              rows.reduce((sum, row) => sum + row.latencyTotalMs, 0) / latencyCount
            )
          : null,
      };
    };
    const current = sumDays((day) => day >= windowDay);
    const before = sumDays((day) => day < windowDay);

    // --- breakdowns -------------------------------------------------------
    let whatsapp = 0;
    let instagram = 0;
    let rcs = 0;
    let telegram = 0;
    let web = 0;
    for (const conversation of conversations) {
      if (conversation.channelType === "whatsapp") whatsapp += 1;
      else if (conversation.channelType === "instagram") instagram += 1;
      else if (conversation.channelType === "rcs") rcs += 1;
      else if (conversation.channelType === "telegram") telegram += 1;
      else web += 1;
    }

    return {
      windowDays: days,
      daily: [...buckets.values()],
      totals: {
        conversations: count(conversations, inWindow),
        messages: current.messages,
        escalated: conversations.filter(
          (c) => c.status === "escalated" && inWindow(c.createdAt)
        ).length,
        avgLatencyMs: current.avgLatencyMs,
      },
      previous: {
        conversations: count(conversations, inPrevious),
        messages: before.messages,
        escalated: conversations.filter(
          (c) => c.status === "escalated" && inPrevious(c.createdAt)
        ).length,
        avgLatencyMs: before.avgLatencyMs,
      },
      channels: { whatsapp, instagram, rcs, telegram, web },
    };
  },
});
