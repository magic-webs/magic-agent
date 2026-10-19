import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { Outbound } from "./whatsappSend";

export type ChannelSendResult = { ok: boolean; error?: string; wamid?: string };

/** One outbound on whichever provider the conversation is on. Web has nothing to post to. */
export async function sendOnChannel(
  ctx: ActionCtx,
  channelType: Doc<"channels">["type"],
  args: {
    channelId: Id<"channels">;
    to: string;
    message: Outbound;
    source?: "agent" | "human" | "follow_up" | "system";
    conversationId?: Id<"conversations">;
    replyTo?: string;
  }
): Promise<ChannelSendResult> {
  const { replyTo, ...rest } = args;
  switch (channelType) {
    case "whatsapp":
      return await ctx.runAction(internal.whatsapp.sendOutbound, {
        ...rest,
        ...(replyTo ? { replyTo } : {}),
      });
    case "instagram":
      return await ctx.runAction(internal.instagram.sendOutbound, rest);
    case "rcs":
      return await ctx.runAction(internal.rcs.sendOutbound, rest);
    case "telegram":
      return await ctx.runAction(internal.telegram.sendOutbound, rest);
    case "web":
      return { ok: true };
  }
}
