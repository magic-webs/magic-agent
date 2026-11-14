import { ConvexError, v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { requireWorkspace } from "./lib/auth";
import { voiceIdFor } from "./lib/voices";

export const messageForSpeech = internalQuery({
  args: { messageId: v.id("messages"), checkAccess: v.boolean() },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (!message) throw new ConvexError("Message not found");
    if (args.checkAccess) await requireWorkspace(ctx, message.workspaceId);
    if (message.role !== "assistant" || message.kind !== "text" || !message.text) {
      throw new ConvexError("Only the agent's replies can be played.");
    }
    const conversation = await ctx.db.get("conversations", message.conversationId);
    const agentId = message.agentId ?? conversation?.agentId;
    const agent = agentId ? await ctx.db.get("agents", agentId) : null;
    return {
      workspaceId: message.workspaceId,
      text: message.text,
      audioKey: message.audioKey ?? null,
      voiceId: voiceIdFor(agent ?? {}),
    };
  },
});

export const saveAudio = internalMutation({
  args: { messageId: v.id("messages"), audioKey: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch("messages", args.messageId, { audioKey: args.audioKey });
  },
});
