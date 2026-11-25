"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { hear, toSpeech } from "./lib/speech";
import { GENIE_VOICE_ID, spokenText } from "./lib/voices";

const MP3_BYTES_PER_SECOND = 16_000;
const MAX_TURN_SECONDS = 60;
const FIRST_PART_CHARS = 140;
const PART_CHARS = 420;

export const transcribe = action({
  args: { workspaceId: v.id("workspaces"), audio: v.bytes(), seconds: v.number() },
  handler: async (ctx, args): Promise<{ text: string }> => {
    const [, heard] = await Promise.all([
      ctx.runQuery(internal.genieVoiceDb.check, { workspaceId: args.workspaceId }),
      hear(args.audio),
    ]);
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

function split(text: string): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [text];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const limit = parts.length ? PART_CHARS : FIRST_PART_CHARS;
    if (current.trim() && current.length + sentence.length > limit) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export const speak = action({
  args: {
    itemId: v.id("genieItems"),
    waiting: v.optional(v.number()),
    part: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ audio: ArrayBuffer; parts: string[] }> => {
    const reply = await ctx.runQuery(internal.genie.replyForSpeech, { itemId: args.itemId });
    const text = spokenText(
      reply.kind === "action" ? approvalLine(reply.text, args.waiting ?? 1) : reply.text
    );
    const parts = split(text);
    const part = parts[args.part ?? 0];
    if (!part) throw new ConvexError("There is nothing to read out.");
    const [, speech] = await Promise.all([
      ctx.runQuery(internal.genieVoiceDb.check, { workspaceId: reply.workspaceId }),
      toSpeech(part, GENIE_VOICE_ID),
    ]);
    await ctx.runMutation(internal.genieVoiceDb.spend, {
      workspaceId: reply.workspaceId,
      seconds: speech.bytes.byteLength / MP3_BYTES_PER_SECOND,
    });
    const { bytes } = speech;
    const audio = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { audio, parts };
  },
});
