"use node";

import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateSpeech, transcribe } from "ai";
import { aiGateway } from "./lib/gateway";
import { fileUrl, newFileKey, r2 } from "./lib/files";
import {
  MAX_VOICE_NOTE_BYTES,
  VOICE_SPEECH_MODEL,
  VOICE_TRANSCRIPTION_MODEL,
  isVoiceId,
  spokenText,
} from "./lib/voices";

type Spoken = { url: string; mediaType: string };
type Stored = Spoken & { key: string };

async function toText(audio: ArrayBuffer): Promise<string> {
  if (audio.byteLength === 0) throw new ConvexError("No audio was recorded.");
  if (audio.byteLength > MAX_VOICE_NOTE_BYTES) {
    throw new ConvexError("That recording is too long. Keep it under a minute.");
  }
  const result = await transcribe({
    model: aiGateway().transcription(VOICE_TRANSCRIPTION_MODEL),
    audio: new Uint8Array(audio),
  }).catch((error: unknown) => {
    console.error("[voice] transcription failed", error);
    throw new ConvexError("Could not hear that. Please try again.");
  });
  return result.text.trim();
}

async function synthesise(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  text: string,
  voiceId: string
): Promise<Stored> {
  const spoken = spokenText(text);
  if (!spoken) throw new ConvexError("There is nothing to read out.");
  const result = await generateSpeech({
    model: aiGateway().speech(VOICE_SPEECH_MODEL),
    text: spoken,
    voice: voiceId,
    outputFormat: "mp3",
  }).catch((error: unknown) => {
    console.error("[voice] speech failed", error);
    throw new ConvexError("The voice reply is not available right now.");
  });
  const mediaType = result.audio.mediaType || "audio/mpeg";
  const key = await r2.store(ctx, new Uint8Array(result.audio.uint8Array), {
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
