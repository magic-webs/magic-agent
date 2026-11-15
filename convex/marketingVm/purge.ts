import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";

const TABLES = [
  "audienceImportRows",
  "audienceImports",
  "audienceMembers",
  "audiences",
  "channelHealth",
  "eventGuests",
  "marketingCampaigns",
  "marketingDaily",
  "marketingEvents",
  "marketingHourly",
  "marketingSends",
  "marketingSettings",
  "marketingStats",
  "marketingTemplates",
  "rolloutChecks",
  "rolloutRecipients",
] as const;

const BATCH = 400;

// Deliberately the unwrapped mutation: the sync triggers would forward each
// delete to the marketing service and remove its copy too.
export const table = internalMutation({
  args: { table: v.union(...TABLES.map((name) => v.literal(name))) },
  handler: async (ctx, args): Promise<{ deleted: number; more: boolean }> => {
    const left = await ctx.db
      .query("workspaces")
      .filter((q) => q.neq(q.field("marketingOnVm"), true))
      .first();
    if (left) throw new ConvexError(`Workspace ${left.slug} still runs marketing here.`);

    const rows = await ctx.db.query(args.table).take(BATCH);
    for (const row of rows) await ctx.db.delete(args.table, row._id);
    const more = rows.length === BATCH;
    if (more) await ctx.scheduler.runAfter(0, internal.marketingVm.purge.table, { table: args.table });
    return { deleted: rows.length, more };
  },
});

export const remaining = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, number> = {};
    for (const name of TABLES) out[name] = (await ctx.db.query(name).take(BATCH)).length;
    return out;
  },
});
