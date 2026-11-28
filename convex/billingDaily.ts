import { v } from "convex/values";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { localDay, rebuildDay, shiftDay } from "./lib/billingDaily";

const WORKSPACE_BATCH = 20;
const ROW_BUDGET = 8_000;
const DAY_BUDGET = 31;

export const rebuildAll = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });
    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(0, internal.billingDaily.rebuildWorkspace, {
        workspaceId: workspace._id,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.billingDaily.rebuildAll, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

export const rebuildWorkspace = internalMutation({
  args: { workspaceId: v.id("workspaces"), day: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    const timeZone = workspace.timezone;

    let day = args.day;
    if (!day) {
      const first = await ctx.db
        .query("billingEvents")
        .withIndex("by_workspace_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
        .first();
      if (!first) return null;
      day = shiftDay(localDay(first.createdAt, timeZone), -1);
    }

    const last = shiftDay(localDay(Date.now(), timeZone), 1);
    let read = 0;
    let days = 0;
    while (day <= last && read < ROW_BUDGET && days < DAY_BUDGET) {
      read += await rebuildDay(ctx.db, args.workspaceId, day, timeZone);
      day = shiftDay(day, 1);
      days += 1;
    }
    if (day <= last) {
      await ctx.scheduler.runAfter(0, internal.billingDaily.rebuildWorkspace, {
        workspaceId: args.workspaceId,
        day,
      });
    }
    return null;
  },
});
