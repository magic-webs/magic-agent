import { ConvexError, v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./functions";
import { requireArea } from "./lib/auth";
import { GENIE_FREE_VOICE_SECONDS } from "./lib/voices";

async function usedSeconds(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const row = await ctx.db
    .query("genieVoiceUsage")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  return row?.seconds ?? 0;
}

function allowanceOf(used: number) {
  return {
    freeSeconds: GENIE_FREE_VOICE_SECONDS,
    usedSeconds: Math.min(used, GENIE_FREE_VOICE_SECONDS),
    remainingSeconds: Math.max(0, GENIE_FREE_VOICE_SECONDS - used),
  };
}

export const allowance = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireArea(ctx, args.workspaceId, "genie");
    return allowanceOf(await usedSeconds(ctx, args.workspaceId));
  },
});

export const check = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireArea(ctx, args.workspaceId, "genie", "edit");
    const { remainingSeconds } = allowanceOf(await usedSeconds(ctx, args.workspaceId));
    if (remainingSeconds <= 0) {
      throw new ConvexError("Your 30 free voice minutes with Genie are used up. You can keep typing to Genie.");
    }
    return remainingSeconds;
  },
});

export const spend = internalMutation({
  args: { workspaceId: v.id("workspaces"), seconds: v.number() },
  handler: async (ctx, args) => {
    const seconds = Math.max(0, Math.round(args.seconds));
    if (seconds === 0) return null;
    const row = await ctx.db
      .query("genieVoiceUsage")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (row) {
      await ctx.db.patch("genieVoiceUsage", row._id, {
        seconds: row.seconds + seconds,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("genieVoiceUsage", {
        workspaceId: args.workspaceId,
        seconds,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
