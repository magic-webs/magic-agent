import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { threadAccess } from "./lib/auth";

export const STALE_DRAFT_MS = 60_000;

export async function clearDraft(ctx: MutationCtx, conversationId: Id<"conversations">) {
  const drafts = await ctx.db
    .query("replyDrafts")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .collect();
  for (const draft of drafts) await ctx.db.delete("replyDrafts", draft._id);
}

export const write = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    agentId: v.id("agents"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("replyDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .first();
    if (!args.text) {
      if (existing) await ctx.db.delete("replyDrafts", existing._id);
      return;
    }
    const fields = { agentId: args.agentId, text: args.text, updatedAt: Date.now() };
    if (existing) await ctx.db.patch("replyDrafts", existing._id, fields);
    else await ctx.db.insert("replyDrafts", { conversationId: args.conversationId, ...fields });
  },
});

export function liveDraft(draft: Doc<"replyDrafts"> | null) {
  if (!draft || Date.now() - draft.updatedAt > STALE_DRAFT_MS) return null;
  return { text: draft.text, agentId: draft.agentId, updatedAt: draft.updatedAt };
}

export const forConversation = query({
  args: { conversationId: v.optional(v.id("conversations")) },
  handler: async (ctx, args) => {
    if (!args.conversationId) return null;
    if (!(await threadAccess(ctx, args.conversationId))) return null;
    const draft = await ctx.db
      .query("replyDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId!))
      .first();
    return liveDraft(draft);
  },
});
