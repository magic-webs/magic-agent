import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";

const byKey = { workspaceId: v.id("workspaces"), panelKey: v.string(), mediaKey: v.string() };

export const get = internalQuery({
  args: byKey,
  handler: async (ctx, args) =>
    await ctx.db
      .query("templateMediaHandles")
      .withIndex("by_workspace_and_panelKey_and_mediaKey", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("panelKey", args.panelKey).eq("mediaKey", args.mediaKey)
      )
      .unique(),
});

export const save = internalMutation({
  args: { ...byKey, handle: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("templateMediaHandles")
      .withIndex("by_workspace_and_panelKey_and_mediaKey", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("panelKey", args.panelKey).eq("mediaKey", args.mediaKey)
      )
      .unique();
    const uploadedAt = Date.now();
    if (existing) {
      await ctx.db.patch("templateMediaHandles", existing._id, { handle: args.handle, uploadedAt });
    } else {
      await ctx.db.insert("templateMediaHandles", { ...args, uploadedAt });
    }
    return null;
  },
});
