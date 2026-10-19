import { ConvexError, v } from "convex/values";
import {
  query,
  internalQuery,
} from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { randomKey, maskSecret } from "./lib/shared";
import { widgetIntake } from "./schema";
import {
  requireChannel,
  requireWorkspace,
} from "./lib/auth";

const whatsappInput = v.object({
  apiBaseUrl: v.optional(v.string()),
  apiVersion: v.optional(v.string()),
  phoneNumberId: v.string(),
  wabaId: v.optional(v.string()),
  businessId: v.optional(v.string()),
  displayPhoneNumber: v.optional(v.string()),
  // Omit on update to keep the stored token
  accessToken: v.optional(v.string()),
});

const rcsInput = v.object({
  apiBaseUrl: v.optional(v.string()),
  displayPhoneNumber: v.optional(v.string()),
  accessToken: v.optional(v.string()),
});

const telegramInput = v.object({ botToken: v.optional(v.string()) });

const DEFAULT_RCS_BASE = "https://crmapi.com.bot/api/v1";

const DEFAULT_NAME = {
  whatsapp: "WhatsApp",
  web: "Web chat",
  rcs: "RCS",
  telegram: "Telegram",
} as const;

function keepSecret(incoming: string | undefined, stored: string | undefined) {
  const token = incoming?.trim();
  return !token || token.startsWith("••") ? stored : token;
}

// Never return a live access token to the browser.
function redact(channel: Doc<"channels">) {
  return {
    ...channel,
    whatsapp: channel.whatsapp
      ? {
          ...channel.whatsapp,
          accessToken: maskSecret(channel.whatsapp.accessToken) ?? "",
        }
      : undefined,
    instagram: channel.instagram
      ? { ...channel.instagram, accessToken: maskSecret(channel.instagram.accessToken) ?? "" }
      : undefined,
    rcs: channel.rcs
      ? { ...channel.rcs, accessToken: maskSecret(channel.rcs.accessToken) ?? "" }
      : undefined,
    telegram: channel.telegram
      ? {
          botId: channel.telegram.botId,
          botUsername: channel.telegram.botUsername,
          botToken: maskSecret(channel.telegram.botToken) ?? "",
          secretToken: "",
        }
      : undefined,
    hasAccessToken: Boolean(
      channel.whatsapp?.accessToken ??
        channel.instagram?.accessToken ??
        channel.rcs?.accessToken ??
        channel.telegram?.botToken
    ),
  };
}

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const agentNames = new Map(agents.map((a) => [a._id, a.name]));

    /* How much has actually come through each one. Counted here in one pass
       over the workspace's conversations rather than per card from the client:
       a workspace has a handful of channels and the page wants every count at
       once, so one read beats N round trips. `channelId` is optional — a
       conversation from before channels were recorded on them counts towards
       nothing, which is right. */
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const messages = new Map<string, number>();
    const people = new Map<string, Set<string>>();
    for (const conversation of conversations) {
      if (!conversation.channelId) continue;
      const key = conversation.channelId;
      messages.set(key, (messages.get(key) ?? 0) + conversation.messageCount);
      const seen = people.get(key) ?? new Set<string>();
      seen.add(conversation.contactId);
      people.set(key, seen);
    }

    return channels.map((channel) => ({
      ...redact(channel),
      agentName: agentNames.get(channel.agentId) ?? "— deleted agent —",
      messageCount: messages.get(channel._id) ?? 0,
      contactCount: people.get(channel._id)?.size ?? 0,
    }));
  },
});

/** Just enough to tell one number from another, for the inbox. */
export const inboxChannels = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(100);
    return channels
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((channel) => ({
        _id: channel._id,
        name: channel.name,
        type: channel.type,
        status: channel.status,
        phone:
          channel.whatsapp?.displayPhoneNumber ??
          channel.rcs?.displayPhoneNumber ??
          (channel.instagram ? `@${channel.instagram.username}` : null) ??
          (channel.telegram?.botUsername ? `@${channel.telegram.botUsername}` : null),
      }));
  },
});

export const get = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    const channel = await ctx.db.get("channels", args.channelId);
    return channel ? redact(channel) : null;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    type: v.union(
      v.literal("whatsapp"),
      v.literal("web"),
      v.literal("rcs"),
      v.literal("telegram")
    ),
    name: v.string(),
    intake: v.optional(widgetIntake),
    whatsapp: v.optional(whatsappInput),
    rcs: v.optional(rcsInput),
    telegram: v.optional(telegramInput),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.type === "web" && !args.intake) {
      throw new ConvexError(
        "Choose how the widget asks for the visitor's name and number"
      );
    }
    if (args.type === "whatsapp") {
      if (!args.whatsapp?.phoneNumberId?.trim()) {
        throw new ConvexError("A WhatsApp phone number ID is required");
      }
      if (!args.whatsapp.accessToken?.trim()) {
        throw new ConvexError("A WhatsApp access token is required");
      }
    }
    const rcsToken = args.rcs?.accessToken?.trim();
    if (args.type === "rcs" && !rcsToken) {
      throw new ConvexError("An RCS access token is required");
    }
    const botToken = args.telegram?.botToken?.trim();
    if (args.type === "telegram" && !botToken) {
      throw new ConvexError("A Telegram bot token is required");
    }

    const now = Date.now();
    const channelId = await ctx.db.insert("channels", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      type: args.type,
      name: args.name.trim() || DEFAULT_NAME[args.type],
      channelKey: randomKey(28),
      externalId: args.whatsapp?.phoneNumberId,
      intake: args.type === "web" ? args.intake : undefined,
      whatsapp:
        args.type === "whatsapp" && args.whatsapp
          ? {
              apiBaseUrl:
                args.whatsapp.apiBaseUrl?.replace(/\/$/, "") ||
                "https://graph.facebook.com",
              apiVersion: args.whatsapp.apiVersion || "v23.0",
              phoneNumberId: args.whatsapp.phoneNumberId.trim(),
              wabaId: args.whatsapp.wabaId?.trim() || undefined,
              businessId: args.whatsapp.businessId?.trim() || undefined,
              displayPhoneNumber:
                args.whatsapp.displayPhoneNumber?.trim() || undefined,
              accessToken: args.whatsapp.accessToken!.trim(),
            }
          : undefined,
      rcs:
        args.type === "rcs" && rcsToken
          ? {
              apiBaseUrl:
                args.rcs?.apiBaseUrl?.trim().replace(/\/$/, "") || DEFAULT_RCS_BASE,
              accessToken: rcsToken,
              displayPhoneNumber: args.rcs?.displayPhoneNumber?.trim() || undefined,
            }
          : undefined,
      telegram:
        args.type === "telegram" && botToken
          ? { botToken, secretToken: randomKey(32) }
          : undefined,
      status:
        args.type === "whatsapp" || args.type === "telegram" ? "paused" : "active",
      createdAt: now,
      updatedAt: now,
    });
    if (args.type === "telegram") {
      await ctx.scheduler.runAfter(0, internal.telegram.register, { channelId });
    }
    return channelId;
  },
});

export const update = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
    intake: v.optional(widgetIntake),
    whatsapp: v.optional(whatsappInput),
    rcs: v.optional(rcsInput),
    telegram: v.optional(telegramInput),
    status: v.optional(
      v.union(v.literal("active"), v.literal("paused"), v.literal("error"))
    ),
  },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    const existing = await ctx.db.get("channels", args.channelId);
    if (!existing) throw new ConvexError("Channel not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.agentId !== undefined) patch.agentId = args.agentId;
    if (args.status !== undefined) patch.status = args.status;
    if (args.intake !== undefined) {
      if (existing.type !== "web") {
        throw new ConvexError("Only a web widget collects visitor details");
      }
      patch.intake = args.intake;
    }

    if (args.whatsapp) {
      const incomingToken = args.whatsapp.accessToken?.trim();
      // A blank or masked token means "leave the stored one alone".
      const keepExisting =
        !incomingToken || incomingToken.startsWith("••");
      const accessToken = keepExisting
        ? existing.whatsapp?.accessToken
        : incomingToken;

      if (!accessToken) {
        throw new ConvexError("A WhatsApp access token is required");
      }

      patch.whatsapp = {
        apiBaseUrl:
          args.whatsapp.apiBaseUrl?.replace(/\/$/, "") ||
          existing.whatsapp?.apiBaseUrl ||
          "https://graph.facebook.com",
        apiVersion:
          args.whatsapp.apiVersion ||
          existing.whatsapp?.apiVersion ||
          "v23.0",
        phoneNumberId:
          args.whatsapp.phoneNumberId.trim() ||
          existing.whatsapp?.phoneNumberId ||
          "",
        wabaId: args.whatsapp.wabaId?.trim() || undefined,
        businessId: args.whatsapp.businessId?.trim() || undefined,
        displayPhoneNumber:
          args.whatsapp.displayPhoneNumber?.trim() || undefined,
        accessToken,
      };
      patch.externalId = args.whatsapp.phoneNumberId.trim();
    }

    if (args.rcs) {
      if (existing.type !== "rcs") throw new ConvexError("This is not an RCS channel");
      const accessToken = keepSecret(args.rcs.accessToken, existing.rcs?.accessToken);
      if (!accessToken) throw new ConvexError("An RCS access token is required");
      patch.rcs = {
        apiBaseUrl:
          args.rcs.apiBaseUrl?.trim().replace(/\/$/, "") ||
          existing.rcs?.apiBaseUrl ||
          DEFAULT_RCS_BASE,
        accessToken,
        displayPhoneNumber: args.rcs.displayPhoneNumber?.trim() || undefined,
      };
    }

    let registerTelegram = false;
    if (args.telegram) {
      if (existing.type !== "telegram") {
        throw new ConvexError("This is not a Telegram channel");
      }
      const botToken = keepSecret(args.telegram.botToken, existing.telegram?.botToken);
      if (!botToken) throw new ConvexError("A Telegram bot token is required");
      if (botToken !== existing.telegram?.botToken) {
        patch.telegram = { botToken, secretToken: randomKey(32) };
        registerTelegram = true;
      }
    }

    await ctx.db.patch(args.channelId, patch);
    if (registerTelegram) {
      await ctx.scheduler.runAfter(0, internal.telegram.register, {
        channelId: args.channelId,
      });
    }
    return { success: true };
  },
});

export const rotateKeys = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    const channelKey = randomKey(28);
    await ctx.db.patch(args.channelId, {
      channelKey,
      updatedAt: Date.now(),
    });
    const channel = await ctx.db.get("channels", args.channelId);
    if (channel?.type === "telegram") {
      await ctx.scheduler.runAfter(0, internal.telegram.register, {
        channelId: args.channelId,
      });
    }
    return { channelKey };
  },
});

export const remove = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireChannel(ctx, args.channelId);
    const channel = await ctx.db.get("channels", args.channelId);
    if (channel?.instagram?.accessToken) {
      await ctx.scheduler.runAfter(0, internal.instagram.unsubscribe, {
        accessToken: channel.instagram.accessToken,
      });
    }
    if (channel?.telegram?.botToken) {
      await ctx.scheduler.runAfter(0, internal.telegram.unregister, {
        botToken: channel.telegram.botToken,
      });
    }
    await ctx.db.delete(args.channelId);
    return { success: true };
  },
});

// ---------------------------------------------------------------------------
// Internal — used by the inbound WhatsApp webhook route
// ---------------------------------------------------------------------------

// Returns the FULL config including the access token. Internal only.
export const resolveByKey = internalQuery({
  args: { channelKey: v.string() },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_channelKey", (q) => q.eq("channelKey", args.channelKey))
      .unique();
    if (!channel) return null;

    const agent = await ctx.db.get("agents", channel.agentId);
    const workspace = await ctx.db.get("workspaces", channel.workspaceId);
    if (!agent || !workspace) return null;

    return { channel, agentId: agent._id, agentStatus: agent.status };
  },
});

// Same, by id — the outbound sender knows the channel it is answering on but
// not its key. Internal only: this carries the live access token.
export const resolveById = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel) return null;
    return { channel };
  },
});

export const setTelegramBot = internalMutation({
  args: {
    channelId: v.id("channels"),
    botId: v.optional(v.string()),
    botUsername: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel?.telegram) return;
    await ctx.db.patch(args.channelId, {
      telegram: {
        ...channel.telegram,
        botId: args.botId ?? channel.telegram.botId,
        botUsername: args.botUsername ?? channel.telegram.botUsername,
      },
      externalId: args.botId ?? channel.externalId,
      status: args.error ? "error" : "active",
      lastError: args.error?.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

export const touchInbound = internalMutation({
  args: {
    channelId: v.id("channels"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.channelId, {
      lastInboundAt: Date.now(),
      lastError: args.error?.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});
