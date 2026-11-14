"use node";

import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fileUrl, newFileKey, r2 } from "./lib/files";
import { isVoiceId } from "./lib/voices";
import { toSpeech, toText } from "./lib/speech";

type Spoken = { url: string; mediaType: string };
type Stored = Spoken & { key: string };

async function synthesise(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  text: string,
  voiceId: string
): Promise<Stored> {
  const { bytes, mediaType } = await toSpeech(text, voiceId);
  const key = await r2.store(ctx, bytes, {
    key: newFileKey("speech", workspaceId),
    type: mediaType,
  });
  return { url: fileUrl(key), mediaType, key };
}

async function speakMessage(
  ctx: ActionCtx,
  messageId: Id<"messages">,
  checkAccess: boolean
): Promise<Spoken> {
  const message = await ctx.runQuery(internal.voiceDb.messageForSpeech, {
    messageId,
    checkAccess,
  });
  if (message.audioKey) return { url: fileUrl(message.audioKey), mediaType: "audio/mpeg" };
  const spoken = await synthesise(ctx, message.workspaceId, message.text, message.voiceId);
  await ctx.runMutation(internal.voiceDb.saveAudio, { messageId, audioKey: spoken.key });
  return { url: spoken.url, mediaType: spoken.mediaType };
}

export const transcribeAsUser = action({
  args: { agentId: v.id("agents"), audio: v.bytes() },
  handler: async (ctx, args): Promise<{ text: string }> => {
    await ctx.runQuery(internal.authDb.assertAgent, { agentId: args.agentId });
    return { text: await toText(args.audio) };
  },
});

export const speakAsUser = action({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<Spoken> => speakMessage(ctx, args.messageId, true),
});

export const previewVoice = action({
  args: { agentId: v.id("agents"), voiceId: v.string() },
  handler: async (ctx, args): Promise<Spoken> => {
    if (!isVoiceId(args.voiceId)) throw new ConvexError("Pick a voice from the list.");
    const found = await ctx.runQuery(internal.agents.getInternal, { agentId: args.agentId });
    if (!found) throw new ConvexError("Agent not found");
    await ctx.runQuery(internal.authDb.assertAgent, { agentId: args.agentId });
    const { agent, workspace } = found;
    const spoken = await synthesise(
      ctx,
      workspace._id,
      `Hi, I'm ${agent.botName} from ${workspace.name}. How can I help you today?`,
      args.voiceId
    );
    return { url: spoken.url, mediaType: spoken.mediaType };
  },
});

export const transcribeFromWidget = action({
  args: { channelKey: v.string(), sessionId: v.string(), audio: v.bytes() },
  handler: async (ctx, args): Promise<{ text: string }> => {
    const ok = await ctx.runQuery(internal.widget.resolveForVoice, {
      channelKey: args.channelKey,
      sessionId: args.sessionId,
    });
    if (!ok) throw new ConvexError("Voice is not available in this chat.");
    return { text: await toText(args.audio) };
  },
});

export const speakFromWidget = action({
  args: { channelKey: v.string(), sessionId: v.string(), messageId: v.id("messages") },
  handler: async (ctx, args): Promise<Spoken> => {
    const ok = await ctx.runQuery(internal.widget.resolveForVoice, args);
    if (!ok) throw new ConvexError("Voice is not available in this chat.");
    return speakMessage(ctx, args.messageId, false);
  },
});
