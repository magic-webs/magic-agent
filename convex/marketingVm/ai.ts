import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { gatewayModelId } from "../lib/gateway";
import { supportsPromptCaching } from "../lib/shared";

export const model = internalAction({
  args: { model: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ model: string; caching: boolean }> => {
    const id = gatewayModelId(args.model);
    const caching =
      supportsPromptCaching(id) && (await ctx.runQuery(internal.models.promptCaching, { modelId: id }));
    return { model: id, caching };
  },
});

export const record = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.optional(v.id("agents")),
    source: v.union(v.literal("draft_marketing"), v.literal("sort_contacts")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.usage.record, { ...args, kind: "chat" });
  },
});
