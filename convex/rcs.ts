import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { providerError } from "./lib/panel";
import { friendlySendError } from "./lib/sendErrors";
import { parseRcsInbound, rcsMessageId, rcsMessages, rcsMessagesUrl, splitForRcs } from "./lib/rcs";
import type { Outbound } from "./lib/whatsappSend";

const UNSUPPORTED =
  "RCS cannot show that kind of message. Write it out as plain text instead.";

type RcsConfig = NonNullable<Doc<"channels">["rcs"]>;
type SendResult = { ok: boolean; error?: string; wamid?: string };

async function post(config: RcsConfig, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const response = await fetch(rcsMessagesUrl(config.apiBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const refused = (parsed as { success?: unknown; status?: unknown } | null);
    if (!response.ok || refused?.success === false || refused?.status === "error") {
      return { ok: false, error: providerError(response.status, parsed, text) };
    }
    return { ok: true, wamid: rcsMessageId(parsed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function send(config: RcsConfig, to: string, message: Outbound): Promise<SendResult> {
  const bodies = rcsMessages(to, message);
  if (!bodies) return { ok: false, error: UNSUPPORTED };
  let last: SendResult = { ok: false, error: "Nothing to send." };
  for (const body of bodies) {
    last = await post(config, body);
    if (!last.ok) return last;
  }
  return last;
}

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
    if (!channel || channel.type !== "rcs" || !channel.rcs) {
      return { ok: false, error: "This conversation is not on an RCS channel." };
    }
    const result = await send(channel.rcs, args.to, args.message as Outbound);
    if (!result.ok && result.error !== UNSUPPORTED) {
      console.error("[rcs] outbound failed", result.error);
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error: friendlySendError("rcs", result.error),
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
  config: RcsConfig,
  to: string,
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
  for (const part of splitForRcs(result.text)) {
    const sent = await post(config, { to, type: "text", text: { body: part } });
    if (!sent.ok) {
      error = friendlySendError("rcs", sent.error);
      console.error("[rcs] send failed", sent.error);
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

export const handleInbound = internalAction({
  args: { channelKey: v.string(), payload: v.any() },
  handler: async (
    ctx,
    args
  ): Promise<{ handled: boolean; reason?: string; toolCalls?: string[] }> => {
    const resolved = await ctx.runQuery(internal.channels.resolveByKey, {
      channelKey: args.channelKey,
    });
    const channel = resolved?.channel;
    if (!channel || channel.type !== "rcs" || !channel.rcs) {
      return { handled: false, reason: "unknown_channel" };
    }

    const inbound = parseRcsInbound(args.payload);
    if (!inbound) {
      console.log("[rcs] unread payload", JSON.stringify(args.payload).slice(0, 1500));
      return { handled: false, reason: "no_message" };
    }
    if (
      inbound.messageId &&
      !(await ctx.runMutation(internal.instagram.claimEvent, {
        mid: `rcs:${channel._id}:${inbound.messageId}`,
      }))
    ) {
      return { handled: false, reason: "duplicate" };
    }

    await ctx.runMutation(internal.channels.touchInbound, { channelId: channel._id });
    if (channel.status !== "active") {
      return { handled: false, reason: "channel_paused" };
    }

    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: channel.agentId,
      channelType: "rcs",
      channelId: channel._id,
      externalId: inbound.from,
      contactName: inbound.contactName,
      contactPhone: inbound.from,
      text: inbound.text,
      inbound: {
        ...(inbound.payload ? { payload: JSON.stringify(inbound.payload) } : {}),
        preview: inbound.preview,
        ...(inbound.messageId ? { wamid: inbound.messageId } : {}),
      },
    });

    return await deliverReply(ctx, channel, channel.rcs, inbound.from, result);
  },
});

/** A Magic app's result on an RCS thread. See `whatsapp.respondToEvent`. */
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
    if (!channel || channel.type !== "rcs" || !channel.rcs || channel.status !== "active") {
      return await fileOnly("channel_unavailable");
    }

    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: context.agentId,
      channelType: "rcs",
      channelId: channel._id,
      externalId: context.externalId,
      contactName: context.contactName ?? undefined,
      contactPhone: context.contactPhone ?? context.externalId,
      text: args.text,
    });
    if (!result.conversationId) return await fileOnly(result.error ?? "turn_not_started");
    return await deliverReply(ctx, channel, channel.rcs, context.externalId, result);
  },
});
