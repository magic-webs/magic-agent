import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const info = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    return {
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
      locale: workspace.locale ?? null,
    };
  },
});
