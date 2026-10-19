// Node runtime for Whisper, like convex/whatsapp.ts: every export is an action.
"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { transcribe as transcribeAudio } from "ai";
import { aiGateway, TRANSCRIPTION_MODEL } from "./lib/gateway";
import { publicSiteUrl } from "./lib/publicUrl";
import { friendlySendError } from "./lib/sendErrors";
import {
  botUrl,
  fileUrl,
  parseUpdate,
  splitForTelegram,
  telegramRequests,
  type TelegramInbound,
  type TelegramUpdate,
} from "./lib/telegram";
import type { Outbound } from "./lib/whatsappSend";

const UNSUPPORTED =
  "Telegram cannot show that kind of message. Write it out as plain text instead.";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type TelegramConfig = NonNullable<Doc<"channels">["telegram"]>;
type SendResult = { ok: boolean; error?: string; wamid?: string };
type BotResponse = {
  ok?: boolean;
  description?: string;
  error_code?: number;
  result?: unknown;
};

async function call(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<BotResponse> {
  try {
    const response = await fetch(botUrl(botToken, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as BotResponse | null;
    if (parsed) return parsed;
    return { ok: false, description: `HTTP ${response.status}: no response body` };
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : String(error),
    };
  }
}

function errorOf(response: BotResponse): string {
  const code = response.error_code ? `HTTP ${response.error_code}: ` : "";
  return `${code}${response.description ?? "no response body"}`;
}

async function send(config: TelegramConfig, chatId: string, message: Outbound): Promise<SendResult> {
  const requests = telegramRequests(chatId, message);
  if (!requests) return { ok: false, error: UNSUPPORTED };
  let last: SendResult = { ok: false, error: "Nothing to send." };
  for (const request of requests) {
    const response = await call(config.botToken, request.method, request.body);
    if (!response.ok) return { ok: false, error: errorOf(response) };
    const id = (response.result as { message_id?: number } | undefined)?.message_id;
    last = { ok: true, wamid: id === undefined ? undefined : `tg:${chatId}:${id}` };
  }
  return last;
}

export const register = internalAction({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const resolved = await ctx.runQuery(internal.channels.resolveById, {
      channelId: args.channelId,
    });
    const channel = resolved?.channel;
    if (!channel?.telegram) return;
    const { botToken, secretToken } = channel.telegram;

    const me = await call(botToken, "getMe", {});
    if (!me.ok) {
      await ctx.runMutation(internal.channels.setTelegramBot, {
        channelId: channel._id,
        error: friendlySendError("telegram", errorOf(me)),
      });
      return;
    }
    const bot = me.result as { id?: number; username?: string };

    const site = publicSiteUrl();
    const hooked = site
      ? await call(botToken, "setWebhook", {
          url: `${site}/telegram/${channel.channelKey}`,
          secret_token: secretToken,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: true,
        })
      : { ok: false, description: "PUBLIC_SITE_URL is not set on the deployment" };

    await ctx.runMutation(internal.channels.setTelegramBot, {
      channelId: channel._id,
      botId: bot.id === undefined ? undefined : String(bot.id),
      botUsername: bot.username,
      error: hooked.ok ? undefined : `Telegram webhook could not be set: ${errorOf(hooked)}`,
    });
  },
});

export const unregister = internalAction({
  args: { botToken: v.string() },
  handler: async (_ctx, args) => {
    await call(args.botToken, "deleteWebhook", {});
  },
});

export const sendOutbound = internalAction({
  args: {
    channelId: v.id("channels"),
    to: v.string(),
    message: v.any(),
    source: v.optional(
      v.union(
        v.literal("agent"),
        v.literal("human"),
        v.literal("follow_up"),
        v.literal("system")
      )
    ),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args): Promise<SendResult> => {
    const resolved = await ctx.runQuery(internal.channels.resolveById, {
      channelId: args.channelId,
    });
    const channel = resolved?.channel;
    if (!channel || channel.type !== "telegram" || !channel.telegram) {
      return { ok: false, error: "This conversation is not on a connected Telegram bot." };
    }
    const result = await send(channel.telegram, args.to, args.message as Outbound);
    if (!result.ok && result.error !== UNSUPPORTED) {
      console.error("[telegram] outbound failed", result.error);
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error: friendlySendError("telegram", result.error),
      });
    }
    return result;
  },
});

type TurnOutcome = {
  ok: boolean;
  text: string | null;
  conversationId: Id<"conversations"> | null;
  replyMessageId?: Id<"messages">;
  toolCalls: string[];
  heldForHuman?: boolean;
  answeredWithControl?: boolean;
  error?: string;
};

async function deliverReply(
  ctx: ActionCtx,
  channel: Doc<"channels">,
  config: TelegramConfig,
  chatId: string,
  result: TurnOutcome
): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> {
  if (result.heldForHuman) return { handled: true, reason: "human_handling" };
  if (result.answeredWithControl) {
    return { handled: true, reason: "answered_with_control" };
  }
  if (!result.text) {
    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
      error: result.error ?? "The agent produced no reply.",
    });
    return { handled: false, reason: result.error ?? "no_reply" };
  }

  const ids: string[] = [];
  let error: string | undefined;
  for (const part of splitForTelegram(result.text)) {
    const sent = await send(config, chatId, { kind: "text", body: part });
    if (!sent.ok) {
      error = friendlySendError("telegram", sent.error);
      console.error("[telegram] send failed", sent.error);
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error,
      });
      break;
    }
    if (sent.wamid) ids.push(sent.wamid);
  }
  if (result.replyMessageId) {
    await ctx.runMutation(internal.deliveries.markSent, {
      messageId: result.replyMessageId,
      wamids: ids,
      error,
    });
  }
  return { handled: true, toolCalls: result.toolCalls };
}

async function download(
  config: TelegramConfig,
  fileId: string
): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
  const found = await call(config.botToken, "getFile", { file_id: fileId });
  const file = found.result as { file_path?: string; file_size?: number } | undefined;
  if (!found.ok || !file?.file_path || (file.file_size ?? 0) > MAX_FILE_BYTES) return null;
  const response = await fetch(fileUrl(config.botToken, file.file_path)).catch(() => null);
  if (!response?.ok) return null;
  return {
    data: await response.arrayBuffer(),
    mimeType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function readMedia(
  ctx: ActionCtx,
  config: TelegramConfig,
  inbound: TelegramInbound
): Promise<{
  text: string;
  payload?: Outbound;
  image?: { data: ArrayBuffer; mediaType: string };
}> {
  const media = inbound.media!;
  const file = await download(config, media.fileId);
  if (!file) {
    return { text: inbound.text.replace(/\)/, ", which you cannot open)") };
  }
  const mimeType =
    media.mimeType ??
    (media.kind === "image" ? "image/jpeg" : file.mimeType);

  if (media.kind === "audio") {
    let transcript: string | undefined;
    try {
      const result = await transcribeAudio({
        model: aiGateway().transcription(TRANSCRIPTION_MODEL),
        audio: new Uint8Array(file.data),
      });
      transcript = result.text.trim() || undefined;
    } catch (error) {
      console.error(
        "[telegram] voice handling failed",
        error instanceof Error ? error.message : String(error)
      );
    }
    return { text: transcript ?? "(sent a voice note that could not be transcribed)" };
  }

  const storageId = await ctx.storage.store(new Blob([file.data], { type: mimeType }));
  const link = await ctx.storage.getUrl(storageId);
  const payload: Outbound | undefined = link
    ? {
        kind: "media",
        media: media.kind,
        source: { link },
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.filename ? { filename: media.filename } : {}),
        mimeType,
      }
    : undefined;

  const imageType = media.kind === "image" ? (IMAGE_TYPES[mimeType.split("/")[1] ?? ""] ?? mimeType) : null;
  const canSee =
    imageType !== null &&
    imageType.startsWith("image/") &&
    file.data.byteLength <= MAX_IMAGE_BYTES &&
    (await ctx.runQuery(internal.models.imageProcessingEnabled, {}));

  return {
    text: canSee ? inbound.text : inbound.text.replace(/\)/, ", which you cannot open)"),
    payload,
    ...(canSee ? { image: { data: file.data, mediaType: imageType! } } : {}),
  };
}

export const handleInbound = internalAction({
  args: { channelKey: v.string(), update: v.any() },
  handler: async (
    ctx,
    args
  ): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> => {
    const resolved = await ctx.runQuery(internal.channels.resolveByKey, {
      channelKey: args.channelKey,
    });
    const channel = resolved?.channel;
    if (!channel || channel.type !== "telegram" || !channel.telegram) {
      return { handled: false, reason: "unknown_channel" };
    }
    const config = channel.telegram;

    const inbound = parseUpdate(args.update as TelegramUpdate);
    if (!inbound) return { handled: false, reason: "no_message" };
    if (
      !(await ctx.runMutation(internal.instagram.claimEvent, {
        mid: `tg:${channel._id}:${inbound.updateId}`,
      }))
    ) {
      return { handled: false, reason: "duplicate" };
    }

    if (inbound.callbackId) {
      await call(config.botToken, "answerCallbackQuery", {
        callback_query_id: inbound.callbackId,
      });
    }

    await ctx.runMutation(internal.channels.touchInbound, { channelId: channel._id });
    if (channel.status !== "active") {
      return { handled: false, reason: "channel_paused" };
    }

    await call(config.botToken, "sendChatAction", {
      chat_id: inbound.chatId,
      action: "typing",
    });

    let text = inbound.text;
    let payload = inbound.payload;
    let image: { data: ArrayBuffer; mediaType: string } | undefined;
    if (inbound.media) {
      const read = await readMedia(ctx, config, inbound);
      text = read.text;
      payload = read.payload;
      image = read.image;
    }

    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: channel.agentId,
      channelType: "telegram",
      channelId: channel._id,
      externalId: inbound.chatId,
      contactName: inbound.contactName,
      contactPhone: inbound.contactPhone,
      text: text.trim(),
      inbound: {
        ...(payload ? { payload: JSON.stringify(payload) } : {}),
        preview: inbound.preview,
        ...(inbound.messageId ? { wamid: `tg:${inbound.chatId}:${inbound.messageId}` } : {}),
      },
      image,
    });

    return await deliverReply(ctx, channel, config, inbound.chatId, result);
  },
});

/** A Magic app's result on a Telegram chat. See `whatsapp.respondToEvent`. */
export const respondToEvent = internalAction({
  args: { conversationId: v.id("conversations"), text: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> => {
    const context = await ctx.runQuery(internal.conversations.eventContext, {
      conversationId: args.conversationId,
    });
    if (!context) return { handled: false, reason: "no_conversation" };

    const resolved = context.channelId
      ? await ctx.runQuery(internal.channels.resolveById, { channelId: context.channelId })
      : null;
    const channel = resolved?.channel;
    const fileOnly = async (reason: string) => {
      await ctx.runMutation(internal.conversations.recordCustomerEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
      return { handled: false, reason };
    };
    if (!channel || channel.type !== "telegram" || !channel.telegram || channel.status !== "active") {
      return await fileOnly("channel_unavailable");
    }

    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: context.agentId,
      channelType: "telegram",
      channelId: channel._id,
      externalId: context.externalId,
      contactName: context.contactName ?? undefined,
      contactPhone: context.contactPhone ?? undefined,
      text: args.text,
    });
    if (!result.conversationId) return await fileOnly(result.error ?? "turn_not_started");
    return await deliverReply(ctx, channel, channel.telegram, context.externalId, result);
  },
});
