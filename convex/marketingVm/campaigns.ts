import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../functions";
import { ensureMarketingDesk } from "../agents";

export const writer = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    const { agentId } = await ensureMarketingDesk(ctx, args.workspaceId);
    const agent = await ctx.db.get("agents", agentId);
    if (!agent) return null;
    return {
      agent: {
        _id: agent._id,
        jobDescription: agent.jobDescription,
        guardrails: agent.guardrails,
        tone: agent.tone,
        model: agent.model ?? null,
        temperature: agent.temperature ?? null,
      },
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        locale: workspace.locale ?? null,
        industry: workspace.industry ?? null,
        description: workspace.description ?? null,
      },
    };
  },
});

export const booksExist = internalQuery({
  args: { workspaceId: v.id("workspaces"), bookIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const id of args.bookIds) {
      const bookId = ctx.db.normalizeId("recordBooks", id);
      const book = bookId ? await ctx.db.get("recordBooks", bookId) : null;
      if (!book || book.workspaceId !== args.workspaceId) return false;
    }
    return true;
  },
});

export const checkInContact = internalMutation({
  args: { workspaceId: v.id("workspaces"), phone: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) => q.eq("workspaceId", args.workspaceId).eq("externalId", args.phone))
      .unique();
    if (existing) return { contactId: existing._id, name: existing.name ?? null, created: false };
    const now = Date.now();
    const name = args.name?.trim() || undefined;
    const contactId = await ctx.db.insert("contacts", {
      workspaceId: args.workspaceId,
      externalId: args.phone,
      channelType: "whatsapp",
      phone: args.phone,
      name,
      attributes: [],
      source: "manual",
      audienceOnly: true,
      tags: ["walk-in"],
      lastSeenAt: now,
      createdAt: now,
    });
    return { contactId, name: name ?? null, created: true };
  },
});
