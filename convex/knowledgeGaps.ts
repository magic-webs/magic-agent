import { ConvexError, v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAgent, requireWorkspace } from "./lib/auth";
import { CORRECTION_TAG, queueSource, setMessageReview } from "./knowledge";
import { hasReplyWindow, WHATSAPP_FREE_FORM_WINDOW_HOURS } from "./lib/shared";

const MAX_CONVERSATIONS = 5;
const MAX_LIST = 200;

const statusValidator = v.union(
  v.literal("open"),
  v.literal("answered"),
  v.literal("dismissed")
);

const kindValidator = v.union(v.literal("unanswered"), v.literal("wrong_answer"));

const kindOf = (gap: Doc<"knowledgeGaps">) => gap.kind ?? "unanswered";

async function requireGap(ctx: Parameters<typeof requireWorkspace>[0], gapId: Id<"knowledgeGaps">) {
  const gap = await ctx.db.get("knowledgeGaps", gapId);
  if (!gap) throw new ConvexError("Knowledge gap not found");
  await requireWorkspace(ctx, gap.workspaceId);
  return gap;
}

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: statusValidator,
    kind: v.optional(kindValidator),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const gaps = (
      await ctx.db
        .query("knowledgeGaps")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("status", args.status)
        )
        .order("desc")
        .take(MAX_LIST)
    ).filter((gap) => !args.kind || kindOf(gap) === args.kind);

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const agentNames = new Map(agents.map((a) => [a._id, a.botName]));

    const rows = await Promise.all(
      gaps.map(async (gap) => {
        const source = gap.sourceId
          ? await ctx.db.get("knowledgeSources", gap.sourceId)
          : null;
        return {
          _id: gap._id,
          kind: kindOf(gap),
          question: gap.question,
          customerMessage: gap.customerMessage,
          wrongReply: gap.wrongReply,
          note: gap.note,
          askCount: gap.askCount,
          firstAskedAt: gap.firstAskedAt,
          lastAskedAt: gap.lastAskedAt,
          conversationIds: gap.conversationIds,
          status: gap.status,
          resolvedAt: gap.resolvedAt,
          agentName: gap.agentId ? agentNames.get(gap.agentId) : undefined,
          sourceId: source?._id,
          sourceTitle: source?.title,
        };
      })
    );

    if (args.status === "open") {
      rows.sort((a, b) => b.askCount - a.askCount || b.lastAskedAt - a.lastAskedAt);
    }
    return rows;
  },
});

export const openCount = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const open = await ctx.db
      .query("knowledgeGaps")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("status", "open")
      )
      .take(100);
    return open.length;
  },
});

/** Everything the fix-it dialog shows for one gap. */
export const get = query({
  args: { gapId: v.id("knowledgeGaps") },
  handler: async (ctx, args) => {
    const gap = await requireGap(ctx, args.gapId);

    const usedSources = [];
    for (const sourceId of gap.usedSourceIds ?? []) {
      const source = await ctx.db.get("knowledgeSources", sourceId);
      if (source) {
        usedSources.push({
          _id: source._id,
          title: source.title,
          kind: source.kind,
          status: source.status,
          correction: source.tags.includes(CORRECTION_TAG),
        });
      }
    }

    const conversationId = gap.conversationIds[0];
    const conversation = conversationId
      ? await ctx.db.get("conversations", conversationId)
      : null;
    let canSendCorrection = false;
    if (conversation) {
      const recent = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
        .order("desc")
        .take(100);
      const lastInboundAt = recent.find((m) => m.role === "user")?.createdAt ?? null;
      canSendCorrection =
        !hasReplyWindow(conversation.channelType) ||
        (lastInboundAt !== null &&
          Date.now() - lastInboundAt <= WHATSAPP_FREE_FORM_WINDOW_HOURS * 60 * 60_000);
    }

    const source = gap.sourceId ? await ctx.db.get("knowledgeSources", gap.sourceId) : null;

    return {
      _id: gap._id,
      kind: kindOf(gap),
      status: gap.status,
      question: gap.question,
      customerMessage: gap.customerMessage,
      wrongReply: gap.wrongReply,
      note: gap.note,
      messageId: gap.messageId,
      usedSources,
      sourceId: source?._id,
      sourceTitle: source?.title,
      conversationId: conversation?._id,
      channelType: conversation?.channelType,
      canSendCorrection,
    };
  },
});

/**
 * Flags an agent's reply as wrong. The question is the customer message it
 * was answering, and the sources are the ones the turn retrieved.
 */
export const markWrong = mutation({
  args: { messageId: v.id("messages"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (!message) throw new ConvexError("Message not found");
    await requireWorkspace(ctx, message.workspaceId);
    if (message.role !== "assistant" || message.sentByHuman) {
      throw new ConvexError("Only an agent's reply can be marked as wrong");
    }

    const note = args.note?.trim() || undefined;
    const existing = message.knowledgeGapId
      ? await ctx.db.get("knowledgeGaps", message.knowledgeGapId)
      : null;
    if (existing) {
      if (existing.status === "dismissed") {
        await ctx.db.patch(existing._id, { status: "open", resolvedAt: undefined });
        await ctx.db.patch(message._id, { review: "wrong" });
      }
      if (note) await ctx.db.patch(existing._id, { note });
      return existing._id;
    }

    const earlier = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", message.conversationId).lt("_creationTime", message._creationTime)
      )
      .order("desc")
      .take(30);
    const asked = earlier.find((m) => m.role === "user" && m.text?.trim())?.text?.trim();

    const now = Date.now();
    const gapId = await ctx.db.insert("knowledgeGaps", {
      workspaceId: message.workspaceId,
      agentId: message.agentId,
      kind: "wrong_answer",
      question: asked ? asked.slice(0, 500) : "",
      customerMessage: asked?.slice(0, 1000),
      askCount: 1,
      firstAskedAt: now,
      lastAskedAt: now,
      conversationIds: [message.conversationId],
      status: "open",
      messageId: message._id,
      wrongReply: message.text?.slice(0, 2000),
      usedSourceIds: message.knowledgeSourceIds,
      note,
    });
    await ctx.db.patch(message._id, { review: "wrong", knowledgeGapId: gapId });
    return gapId;
  },
});

export const answer = mutation({
  args: {
    gapId: v.id("knowledgeGaps"),
    answer: v.string(),
    question: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const gap = await requireGap(ctx, args.gapId);
    const question = (args.question ?? gap.question).trim();
    const answer = args.answer.trim();
    if (!question) throw new ConvexError("A question is required");
    if (!answer) throw new ConvexError("Write the answer first");
    if (args.agentId) {
      const agent = await requireAgent(ctx, args.agentId);
      if (agent.workspaceId !== gap.workspaceId) {
        throw new ConvexError("That agent is in another workspace");
      }
    }

    const sourceId = await queueSource(ctx, {
      workspaceId: gap.workspaceId,
      agentId: args.agentId,
      title: question.length > 80 ? `${question.slice(0, 79)}…` : question,
      kind: "faq",
      rawText: `Q: ${question}\nA: ${answer}`,
      tags: kindOf(gap) === "wrong_answer" ? [CORRECTION_TAG] : ["knowledge gap"],
    });

    await ctx.db.patch(gap._id, {
      question,
      status: "answered",
      sourceId,
      resolvedAt: Date.now(),
      ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    });
    await setMessageReview(ctx, gap.messageId, "corrected");
    return { sourceId };
  },
});

/** Closes a gap that was fixed by editing an existing source in place. */
export const markFixed = mutation({
  args: {
    gapId: v.id("knowledgeGaps"),
    sourceId: v.id("knowledgeSources"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const gap = await requireGap(ctx, args.gapId);
    const source = await ctx.db.get("knowledgeSources", args.sourceId);
    if (!source || source.workspaceId !== gap.workspaceId) {
      throw new ConvexError("Knowledge source not found");
    }
    await ctx.db.patch(gap._id, {
      status: "answered",
      sourceId: source._id,
      resolvedAt: Date.now(),
      ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    });
    await setMessageReview(ctx, gap.messageId, "corrected");
    return { success: true };
  },
});

export const dismiss = mutation({
  args: { gapId: v.id("knowledgeGaps") },
  handler: async (ctx, args) => {
    const gap = await requireGap(ctx, args.gapId);
    await ctx.db.patch(gap._id, { status: "dismissed", resolvedAt: Date.now() });
    await setMessageReview(ctx, gap.messageId, undefined);
    return { success: true };
  },
});

export const reopen = mutation({
  args: { gapId: v.id("knowledgeGaps") },
  handler: async (ctx, args) => {
    const gap = await requireGap(ctx, args.gapId);
    await ctx.db.patch(gap._id, {
      status: "open",
      sourceId: undefined,
      resolvedAt: undefined,
    });
    await setMessageReview(ctx, gap.messageId, "wrong");
    return { success: true };
  },
});

/**
 * One customer question the agent could not answer. A close match to an
 * existing gap counts as another ask of it rather than a new row.
 */
export const record = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    conversationId: v.id("conversations"),
    question: v.string(),
    customerMessage: v.optional(v.string()),
    embedding: v.array(v.float64()),
    matchId: v.optional(v.id("knowledgeGaps")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    gapId: Id<"knowledgeGaps">;
    outcome: "new" | "repeat" | "reopened" | "dismissed";
    askCount: number;
  }> => {
    const now = Date.now();
    const match = args.matchId
      ? await ctx.db.get("knowledgeGaps", args.matchId)
      : null;

    if (match && match.workspaceId === args.workspaceId) {
      const reopen = match.status === "answered" && (await answerIsLive(ctx, match));
      const askCount = match.askCount + 1;
      await ctx.db.patch(match._id, {
        askCount,
        lastAskedAt: now,
        customerMessage: args.customerMessage ?? match.customerMessage,
        conversationIds: [
          args.conversationId,
          ...match.conversationIds.filter((id) => id !== args.conversationId),
        ].slice(0, MAX_CONVERSATIONS),
        ...(reopen
          ? { status: "open" as const, sourceId: undefined, resolvedAt: undefined }
          : {}),
      });
      return {
        gapId: match._id,
        outcome: reopen
          ? "reopened"
          : match.status === "dismissed"
            ? "dismissed"
            : "repeat",
        askCount,
      };
    }

    const gapId = await ctx.db.insert("knowledgeGaps", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      kind: "unanswered",
      question: args.question.trim(),
      customerMessage: args.customerMessage,
      askCount: 1,
      firstAskedAt: now,
      lastAskedAt: now,
      conversationIds: [args.conversationId],
      status: "open",
      embedding: args.embedding,
    });
    return { gapId, outcome: "new", askCount: 1 };
  },
});

// An answer still being embedded cannot have been retrieved yet, so a repeat
// ask in that window says nothing about whether the answer works.
async function answerIsLive(
  ctx: MutationCtx,
  gap: Doc<"knowledgeGaps">
) {
  if (!gap.sourceId) return true;
  const source = await ctx.db.get("knowledgeSources", gap.sourceId);
  return !source || source.status === "ready" || source.status === "failed";
}
