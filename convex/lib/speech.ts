import { ConvexError } from "convex/values";
import { generateSpeech, transcribe } from "ai";
import { aiGateway } from "./gateway";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const VOICE_BYTES_PER_SECOND = 4_000;
import {
  MAX_VOICE_NOTE_BYTES,
  VOICE_SPEECH_MODEL,
  VOICE_TRANSCRIPTION_MODEL,
  spokenText,
} from "./voices";

export type HearingFor = {
  workspaceId: Id<"workspaces">;
  agentId?: Id<"agents">;
  channelType?: Doc<"usageEvents">["channelType"];
};

export async function toText(
  ctx: ActionCtx,
  audio: ArrayBuffer,
  heardFor: HearingFor
): Promise<string> {
  const heard = await hear(audio);
  await logHearing(ctx, heardFor, heard.seconds, audio.byteLength);
  return heard.text;
}

export async function logHearing(
  ctx: ActionCtx,
  heardFor: HearingFor,
  seconds: number | null | undefined,
  bytes: number
): Promise<void> {
  await ctx
    .runMutation(internal.usage.recordTranscription, {
      ...heardFor,
      model: VOICE_TRANSCRIPTION_MODEL,
      seconds: seconds ?? bytes / VOICE_BYTES_PER_SECOND,
    })
    .catch((error: unknown) => console.error("[voice] usage not recorded", error));
}

export async function hear(
  audio: ArrayBuffer
): Promise<{ text: string; seconds: number | null }> {
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
  return { text: result.text.trim(), seconds: result.durationInSeconds ?? null };
}

export async function toSpeech(
  text: string,
  voiceId: string
): Promise<{ bytes: Uint8Array; mediaType: string }> {
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
  return {
    bytes: new Uint8Array(result.audio.uint8Array),
    mediaType: result.audio.mediaType || "audio/mpeg",
  };
}
