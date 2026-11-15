import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { homeMarket, quote } from "../lib/billing";
import { walletFor } from "../lib/wallet";
import { normalisePhone } from "../lib/notifications";
import { takesHandoffs } from "../lib/shared";
import { signature } from "../marketingSync";
import { healthQuality } from "../schema/marketing";

const RECORD_PAGE = 500;
const MAX_ATTEMPTS = 8;
const category = v.union(v.literal("marketing"), v.literal("utility"), v.literal("authentication"));

export const recordPage = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    bookId: v.id("recordBooks"),
    stage: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const book = await ctx.db.get("recordBooks", args.bookId);
    if (!book || book.workspaceId !== args.workspaceId) {
      return { contactIds: [], phones: [], read: 0, cursor: "", isDone: true };
    }
    const stage = args.stage;
    const page = stage
      ? await ctx.db
          .query("records")
          .withIndex("by_book_stage", (q) => q.eq("bookId", args.bookId).eq("stage", stage))
          .paginate({ numItems: RECORD_PAGE, cursor: args.cursor })
      : await ctx.db
          .query("records")
          .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
          .paginate({ numItems: RECORD_PAGE, cursor: args.cursor });
    const contactIds: string[] = [];
    const phones: string[] = [];
    for (const row of page.page) {
      if (row.contactId) contactIds.push(row.contactId);
      const digits = row.person?.phone ? normalisePhone(row.person.phone, "91") : null;
      if (digits) phones.push(digits);
    }
    return { contactIds, phones, read: page.page.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const checkSave = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    bookIds: v.array(v.id("recordBooks")),
    replyAgentId: v.optional(v.id("agents")),
  },
  handler: async (ctx, args) => {
    for (const bookId of args.bookIds) {
      const book = await ctx.db.get("recordBooks", bookId);
      if (!book || book.workspaceId !== args.workspaceId) throw new ConvexError("A record book was not found.");
    }
    if (args.replyAgentId) {
      const agent = await ctx.db.get("agents", args.replyAgentId);
      if (!agent || agent.workspaceId !== args.workspaceId) throw new ConvexError("That agent was not found.");
      if (!takesHandoffs(agent)) {
        throw new ConvexError(`${agent.name} cannot take conversations. Pick another agent, or the front desk.`);
      }
    }
    return null;
  },
});

export const agentName = internalQuery({
  args: { workspaceId: v.id("workspaces"), agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    return agent && agent.workspaceId === args.workspaceId ? agent.name : null;
  },
});

export const price = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    category: v.union(category, v.null()),
    byMarket: v.record(v.string(), v.number()),
  },
  handler: async (ctx, args) => {
    let currency: string | null = null;
    let costMicros = 0;
    if (args.category) {
      for (const [market, count] of Object.entries(args.byMarket)) {
        const priced = await quote(ctx, { workspaceId: args.workspaceId, market, category: args.category });
        currency ??= priced.currency;
        costMicros += priced.amountMicros * count;
      }
    }
    const wallet = await walletFor(ctx, args.workspaceId);
    return { currency, costMicros, balanceMicros: wallet?.balanceMicros ?? null };
  },
});

export const homeQuote = internalQuery({
  args: { workspaceId: v.id("workspaces"), category },
  handler: async (ctx, args) => {
    const priced = await quote(ctx, {
      workspaceId: args.workspaceId,
      market: await homeMarket(ctx, args.workspaceId),
      category: args.category,
    });
    return { currency: priced.currency, amountMicros: priced.amountMicros };
  },
});

export const notify = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    event: v.union(
      v.literal("campaign_wave"),
      v.literal("campaign_hold"),
      v.literal("campaign_paused"),
      v.literal("campaign_done")
    ),
    data: v.object({ title: v.string(), message: v.string(), eventId: v.string() }),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.push.notify, args);
    return null;
  },
});

/** Meta's account health webhook, handed to the marketing service for a workspace it sends for. */
export const forwardHealth = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    patch: v.object({
      quality: v.optional(healthQuality),
      limitTier: v.optional(v.string()),
      alert: v.optional(v.string()),
    }),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const url = process.env.MARKETING_SERVICE_URL;
    const secret = process.env.MARKETING_SERVICE_SECRET;
    if (!url || !secret) return null;
    const body = JSON.stringify({ workspaceId: args.workspaceId, channelId: args.channelId, patch: args.patch });
    let error: string | null = null;
    try {
      const res = await fetch(`${url}/internal/rollout/health`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": await signature(secret, body) },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (!error || args.attempt + 1 >= MAX_ATTEMPTS) {
      if (error) console.error(`marketing health forward gave up: ${error}`);
      return null;
    }
    await ctx.scheduler.runAfter(Math.min(60 * 60 * 1000, 2 ** args.attempt * 5_000), internal.marketingVm.broadcasts.forwardHealth, {
      ...args,
      attempt: args.attempt + 1,
    });
    return null;
  },
});
