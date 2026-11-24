"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { fileUrl, newFileKey, r2 } from "./lib/files";
import { hear, toSpeech } from "./lib/speech";
import { GENIE_VOICE_ID } from "./lib/voices";

const MP3_BYTES_PER_SECOND = 16_000;
const MAX_TURN_SECONDS = 60;

export const transcribe = action({
  args: { workspaceId: v.id("workspaces"), audio: v.bytes(), seconds: v.number() },
  handler: async (ctx, args): Promise<{ text: string }> => {
    await ctx.runQuery(internal.genieVoiceDb.check, { workspaceId: args.workspaceId });
    const heard = await hear(args.audio);
    const spoken = heard.seconds ?? Math.min(Math.max(args.seconds, 0), MAX_TURN_SECONDS);
    await ctx.runMutation(internal.genieVoiceDb.spend, {
      workspaceId: args.workspaceId,
      seconds: spoken,
    });
    return { text: heard.text };
  },
});

function approvalLine(change: string, waiting: number): string {
  const more = waiting > 1 ? ` and ${waiting - 1} more ${waiting === 2 ? "change" : "changes"}` : "";
  const what = change.replace(/[.\s]+$/, "");
  return `I need your go-ahead to ${what.charAt(0).toLowerCase()}${what.slice(1)}${more}. Say yes to go ahead, or no to skip.`;
}

export const speak = action({
  args: { itemId: v.id("genieItems"), waiting: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const reply = await ctx.runQuery(internal.genie.replyForSpeech, { itemId: args.itemId });
    const asking = reply.kind === "action";
    if (reply.audioKey && !asking) return { url: fileUrl(reply.audioKey) };
    await ctx.runQuery(internal.genieVoiceDb.check, { workspaceId: reply.workspaceId });
    const text = asking ? approvalLine(reply.text, args.waiting ?? 1) : reply.text;
    const { bytes, mediaType } = await toSpeech(text, GENIE_VOICE_ID);
    const key = await r2.store(ctx, bytes, {
      key: newFileKey("speech", reply.workspaceId),
      type: mediaType,
    });
    if (!asking) {
      await ctx.runMutation(internal.genie.saveReplyAudio, { itemId: args.itemId, audioKey: key });
    }
    await ctx.runMutation(internal.genieVoiceDb.spend, {
      workspaceId: reply.workspaceId,
      seconds: bytes.byteLength / MP3_BYTES_PER_SECOND,
    });
    return { url: fileUrl(key) };
  },
});
