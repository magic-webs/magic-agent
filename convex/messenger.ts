import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { randomKey } from "./lib/shared";
import { publicSiteUrl } from "./lib/publicUrl";
import { friendlySendError } from "./lib/sendErrors";
import { splitMediaHeader, type Outbound } from "./lib/whatsappSend";
import {
  FACEBOOK_DIALOG,
  MESSENGER_WEBHOOK_FIELDS,
  facebookUrl,
  grantedFromPermissions,
  messengerMessage,
  messengerRedirectUri,
  splitForMessenger,
} from "./lib/messenger";
import { graphError } from "./instagram";

const STATE_TTL_MS = 15 * 60_000;
const UNSUPPORTED =
  "Messenger cannot show that kind of message. Write it out as plain text instead.";

export type MessengerConfig = NonNullable<Doc<"channels">["messenger"]>;
type SendResult = { ok: boolean; error?: string; wamid?: string };
type PageGrant = { id: string; name: string; pictureUrl?: string; accessToken: string };
type ConnectResult = {
  ok: boolean;
  error?: string;
  returnTo: string | null;
  pick?: string;
  pageName?: string;
};

function appCredentials() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.MESSENGER_APP_SECRET;
  const configId = process.env.MESSENGER_LOGIN_CONFIG_ID;
  return appId && appSecret && configId ? { appId, appSecret, configId } : null;
}

async function getJson<T>(url: string, token?: string): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).catch(() => null);
  if (!response) return { ok: false, error: "network error" };
  if (!response.ok) return { ok: false, error: await graphError(response) };
  return { ok: true, body: (await response.json()) as T };
}

export const startConnect = action({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    returnTo: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });

    const credentials = appCredentials();
    if (!credentials) {
      console.error(
        "messenger.startConnect: META_APP_ID, MESSENGER_APP_SECRET or MESSENGER_LOGIN_CONFIG_ID is not set"
      );
      throw new ConvexError("Messenger is not available right now.");
    }

    const state = `${randomKey(16)}${randomKey(16)}`;
    await ctx.runMutation(internal.messenger.putState, {
      state,
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      name: args.name.trim(),
      returnTo: args.returnTo,
    });

    const params = new URLSearchParams({
      client_id: credentials.appId,
      redirect_uri: messengerRedirectUri(publicSiteUrl()),
      config_id: credentials.configId,
      response_type: "code",
      override_default_response_type: "true",
      state,
    });
    return { url: `${FACEBOOK_DIALOG}?${params.toString()}` };
  },
});

export const putState = internalMutation({
  args: {
    state: v.string(),
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    returnTo: v.string(),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (!agent || agent.workspaceId !== args.workspaceId) {
      throw new ConvexError("Pick the agent that answers here");
    }
    await ctx.db.insert("messengerOAuthStates", { ...args, createdAt: Date.now() });
  },
});

const pageGrant = v.object({
  id: v.string(),
  name: v.string(),
  pictureUrl: v.optional(v.string()),
  accessToken: v.string(),
});

export const peekState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("messengerOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row || Date.now() - row.createdAt > STATE_TTL_MS) return null;
    return row;
  },
});

export const takeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("messengerOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > STATE_TTL_MS) return null;
    return row;
  },
});

export const holdPages = internalMutation({
  args: {
    state: v.string(),
    userId: v.optional(v.string()),
    permissions: v.optional(v.array(v.string())),
    pages: v.array(pageGrant),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("messengerOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      userId: args.userId,
      permissions: args.permissions,
      pages: args.pages,
      createdAt: Date.now(),
    });
  },
});

export const finishConnect = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<ConnectResult> => {
    const pending = await ctx.runQuery(internal.messenger.peekState, { state: args.state });
    if (!pending) {
      return {
        ok: false,
        returnTo: null,
        error: "This sign-in link has expired. Start again from Channels.",
      };
    }
    const fail = async (error: string): Promise<ConnectResult> => {
      await ctx.runMutation(internal.messenger.takeState, { state: args.state });
      return { ok: false, error, returnTo: pending.returnTo };
    };

    const credentials = appCredentials();
    if (!credentials) return await fail("Messenger is not available right now.");

    const short = await getJson<{ access_token?: string }>(
      facebookUrl("oauth/access_token", {
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
        redirect_uri: messengerRedirectUri(publicSiteUrl()),
        code: args.code,
      })
    );
    if (!short.ok || !short.body.access_token) {
      console.error("[messenger] code exchange failed", short.ok ? "no token" : short.error);
      return await fail("Facebook did not accept the sign-in. Try again.");
    }

    const long = await getJson<{ access_token?: string }>(
      facebookUrl("oauth/access_token", {
        grant_type: "fb_exchange_token",
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
        fb_exchange_token: short.body.access_token,
      })
    );
    if (!long.ok || !long.body.access_token) {
      console.error("[messenger] long-lived exchange failed", long.ok ? "no token" : long.error);
      return await fail("Facebook did not issue a long-lived token. Try again.");
    }
    const userToken = long.body.access_token;

    const [me, granted, accounts] = await Promise.all([
      getJson<{ id?: string }>(facebookUrl("me", { fields: "id" }), userToken),
      getJson<unknown>(facebookUrl("me/permissions"), userToken),
      getJson<{
        data?: Array<{
          id?: string;
          name?: string;
          access_token?: string;
          picture?: { data?: { url?: string } };
        }>;
      }>(
        facebookUrl("me/accounts", {
          fields: "id,name,access_token,picture{url}",
          limit: "100",
        }),
        userToken
      ),
    ]);
    const permissions = granted.ok ? grantedFromPermissions(granted.body) : undefined;
    if (permissions && !permissions.includes("pages_messaging")) {
      return await fail("Allow MagicAgent to manage your Page's messages, then try again.");
    }
    if (!accounts.ok) {
      console.error("[messenger] page list failed", accounts.error);
      return await fail("Could not read your Facebook Pages.");
    }

    const pages: PageGrant[] = (accounts.body.data ?? [])
      .filter((page) => page.id && page.access_token)
      .map((page) => ({
        id: String(page.id),
        name: page.name || "Facebook Page",
        pictureUrl: page.picture?.data?.url || undefined,
        accessToken: page.access_token as string,
      }));
    if (pages.length === 0) {
      return await fail("No Facebook Page was shared. Sign in again and choose a Page.");
    }

    const userId = me.ok && me.body.id ? String(me.body.id) : undefined;
    if (pages.length > 1) {
      await ctx.runMutation(internal.messenger.holdPages, {
        state: args.state,
        userId,
        permissions,
        pages,
      });
      return { ok: true, returnTo: pending.returnTo, pick: args.state };
    }

    await ctx.runMutation(internal.messenger.takeState, { state: args.state });
    const connected = await connectPage(ctx, {
      workspaceId: pending.workspaceId,
      agentId: pending.agentId,
      name: pending.name,
      page: pages[0],
      userId,
      permissions,
    });
    return connected.ok
      ? { ok: true, returnTo: pending.returnTo, pageName: pages[0].name }
      : { ok: false, error: connected.error, returnTo: pending.returnTo };
  },
});

async function connectPage(
  ctx: ActionCtx,
  args: {
    workspaceId: Id<"workspaces">;
    agentId: Id<"agents">;
    name: string;
    page: PageGrant;
    userId?: string;
    permissions?: string[];
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const subscribe = await fetch(
    facebookUrl(`${args.page.id}/subscribed_apps`, {
      subscribed_fields: MESSENGER_WEBHOOK_FIELDS.join(","),
    }),
    { method: "POST", headers: { Authorization: `Bearer ${args.page.accessToken}` } }
  ).catch(() => null);
  if (!subscribe?.ok) {
    const error = subscribe ? await graphError(subscribe) : "network error";
    console.error("[messenger] subscribe failed", error);
    return { ok: false, error: `Facebook would not send this Page's messages here: ${error}` };
  }

  return await ctx.runMutation(internal.messenger.savePage, {
    workspaceId: args.workspaceId,
    agentId: args.agentId,
    name: args.name || args.page.name,
    messenger: {
      pageId: args.page.id,
      pageName: args.page.name,
      userId: args.userId,
      pictureUrl: args.page.pictureUrl,
      accessToken: args.page.accessToken,
      permissions: args.permissions,
    },
  });
}

/** The Pages a sign-in shared, without their tokens, for the picker. */
export const pendingPages = action({
  args: { state: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<Array<{ id: string; name: string; pictureUrl?: string }>> => {
    const pending = await ctx.runQuery(internal.messenger.peekState, { state: args.state });
    if (!pending?.pages) {
      throw new ConvexError("This sign-in has expired. Connect Messenger again.");
    }
    await ctx.runQuery(internal.authDb.assertWorkspace, { workspaceId: pending.workspaceId });
    return pending.pages.map(({ id, name, pictureUrl }) => ({ id, name, pictureUrl }));
  },
});

export const choosePage = action({
  args: { state: v.string(), pageId: v.string() },
  handler: async (ctx, args): Promise<{ pageName: string }> => {
    const pending = await ctx.runQuery(internal.messenger.peekState, { state: args.state });
    if (!pending?.pages) {
      throw new ConvexError("This sign-in has expired. Connect Messenger again.");
    }
    await ctx.runQuery(internal.authDb.assertWorkspace, { workspaceId: pending.workspaceId });
    const page = pending.pages.find((candidate) => candidate.id === args.pageId);
    if (!page) throw new ConvexError("That Page was not shared in this sign-in.");

    await ctx.runMutation(internal.messenger.takeState, { state: args.state });
    const connected = await connectPage(ctx, {
      workspaceId: pending.workspaceId,
      agentId: pending.agentId,
      name: pending.name,
      page,
      userId: pending.userId,
      permissions: pending.permissions,
    });
    if (!connected.ok) throw new ConvexError(connected.error);
    return { pageName: page.name };
  },
});

const messengerConfig = v.object({
  pageId: v.string(),
  pageName: v.string(),
  userId: v.optional(v.string()),
  pictureUrl: v.optional(v.string()),
  accessToken: v.string(),
  permissions: v.optional(v.array(v.string())),
});

export const savePage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    name: v.string(),
    messenger: messengerConfig,
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; error: string }> => {
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.messenger.pageId))
      .take(10);
    const held = existing.filter((channel) => channel.type === "messenger");

    if (held.some((channel) => channel.workspaceId !== args.workspaceId)) {
      return {
        ok: false,
        error: `${args.messenger.pageName} is already connected to another workspace.`,
      };
    }

    const now = Date.now();
    const mine = held[0];
    if (mine) {
      await ctx.db.patch(mine._id, {
        messenger: args.messenger,
        status: "active",
        lastError: undefined,
        updatedAt: now,
      });
      return { ok: true };
    }

    await ctx.db.insert("channels", {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
      type: "messenger",
      name: args.name,
      channelKey: randomKey(28),
      externalId: args.messenger.pageId,
      messenger: args.messenger,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true };
  },
});

export const byPage = internalQuery({
  args: { pageId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.pageId))
      .take(10);
    return channels.find((channel) => channel.type === "messenger") ?? null;
  },
});

async function sendOne(
  config: MessengerConfig,
  to: string,
  body: Record<string, unknown>
): Promise<SendResult> {
  const response = await fetch(facebookUrl(`${config.pageId}/messages`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify({ recipient: { id: to }, ...body }),
  }).catch(() => null);
  if (!response) return { ok: false, error: "network error" };
  if (!response.ok) return { ok: false, error: await graphError(response) };
  const sent = (await response.json().catch(() => null)) as { message_id?: string } | null;
  return { ok: true, wamid: sent?.message_id };
}

async function send(config: MessengerConfig, to: string, message: Outbound): Promise<SendResult> {
  const payloads =
    message.kind === "text"
      ? splitForMessenger(message.body).map((text) => ({ text }))
      : splitMediaHeader(message, ["buttons", "list", "cta_url"]).map(messengerMessage);
  if (payloads.some((payload) => !payload)) return { ok: false, error: UNSUPPORTED };
  let last: SendResult = { ok: false, error: "Nothing to send." };
  for (const payload of payloads) {
    last = await sendOne(config, to, { messaging_type: "RESPONSE", message: payload });
    if (!last.ok) return last;
  }
  return last;
}

async function senderAction(
  config: MessengerConfig,
  to: string,
  action: "mark_seen" | "typing_on"
): Promise<void> {
  await sendOne(config, to, { sender_action: action }).catch(() => undefined);
}

async function senderName(config: MessengerConfig, psid: string): Promise<string | undefined> {
  const profile = await getJson<{ first_name?: string; last_name?: string; name?: string }>(
    facebookUrl(psid, { fields: "first_name,last_name" }),
    config.accessToken
  );
  if (!profile.ok) return undefined;
  const full = [profile.body.first_name, profile.body.last_name].filter(Boolean).join(" ");
  return full || profile.body.name || undefined;
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
    if (!channel || channel.type !== "messenger" || !channel.messenger?.accessToken) {
      return { ok: false, error: "This conversation is not on a connected Facebook Page." };
    }

    const result = await send(channel.messenger, args.to, args.message as Outbound);
    if (!result.ok && result.error !== UNSUPPORTED) {
      console.error("[messenger] outbound failed", result.error);
      await ctx.runMutation(internal.channels.touchInbound, {
        channelId: channel._id,
        error: friendlySendError("messenger", result.error),
      });
    }
    return result;
  },
});

type InboundEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string }>;
  };
  postback?: { mid?: string; title?: string; payload?: string };
};

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

type Handled = { handled: boolean; reason?: string; toolCalls?: string[] };

async function deliverReply(
  ctx: ActionCtx,
  channel: Doc<"channels">,
  config: MessengerConfig,
  to: string,
  result: TurnOutcome
): Promise<Handled> {
  if (result.heldForHuman) return { handled: true, reason: "human_handling" };
  if (result.answeredWithControl) return { handled: true, reason: "answered_with_control" };
  if (!result.text) {
    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
      error: result.error ?? "The agent produced no reply.",
    });
    return { handled: false, reason: result.error ?? "no_reply" };
  }

  const sent = await send(config, to, { kind: "text", body: result.text });
  if (result.replyMessageId) {
    await ctx.runMutation(internal.deliveries.markSent, {
      messageId: result.replyMessageId,
      wamids: [],
      error: sent.ok ? undefined : friendlySendError("messenger", sent.error),
    });
  }
  if (!sent.ok) {
    console.error("[messenger] send failed", sent.error);
    await ctx.runMutation(internal.channels.touchInbound, {
      channelId: channel._id,
      error: friendlySendError("messenger", sent.error),
    });
  }
  return { handled: true, toolCalls: result.toolCalls };
}

export const handleInbound = internalAction({
  args: { pageId: v.string(), event: v.any() },
  handler: async (ctx, args): Promise<Handled> => {
    const channel = await ctx.runQuery(internal.messenger.byPage, { pageId: args.pageId });
    if (!channel?.messenger?.accessToken) {
      console.warn("[messenger] no connected channel for page", args.pageId);
      return { handled: false, reason: "unknown_page" };
    }
    const config = channel.messenger;

    const event = args.event as InboundEvent;
    const from = event.sender?.id;
    const message = event.message;
    if (!from || from === args.pageId || message?.is_echo) {
      return { handled: false, reason: "own_message" };
    }

    const mid =
      message?.mid ??
      event.postback?.mid ??
      (event.postback ? `postback:${from}:${event.timestamp ?? ""}` : undefined);
    if (!mid) return { handled: false, reason: "no_message" };
    if (!(await ctx.runMutation(internal.instagram.claimEvent, { mid }))) {
      return { handled: false, reason: "duplicate" };
    }

    await ctx.runMutation(internal.channels.touchInbound, { channelId: channel._id });
    if (channel.status !== "active") return { handled: false, reason: "channel_paused" };

    await senderAction(config, from, "mark_seen");

    const text = (message?.text ?? event.postback?.title ?? "").trim();
    if (!text) {
      await send(config, from, {
        kind: "text",
        body: "I can only read text messages here. Could you type your question?",
      });
      return { handled: true, reason: "unsupported_type" };
    }

    await senderAction(config, from, "typing_on");
    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: channel.agentId,
      channelType: "messenger",
      channelId: channel._id,
      externalId: from,
      contactName: await senderName(config, from),
      text,
    });

    return await deliverReply(ctx, channel, config, from, result);
  },
});

/** A Magic app's result on a Messenger thread. See `whatsapp.respondToEvent`. */
export const respondToEvent = internalAction({
  args: { conversationId: v.id("conversations"), text: v.string() },
  handler: async (ctx, args): Promise<Handled> => {
    const context = await ctx.runQuery(internal.conversations.eventContext, {
      conversationId: args.conversationId,
    });
    if (!context) return { handled: false, reason: "no_conversation" };

    const resolved = context.channelId
      ? await ctx.runQuery(internal.channels.resolveById, { channelId: context.channelId })
      : null;
    const channel = resolved?.channel;
    if (
      !channel ||
      channel.type !== "messenger" ||
      !channel.messenger?.accessToken ||
      channel.status !== "active"
    ) {
      await ctx.runMutation(internal.conversations.recordCustomerEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
      return { handled: false, reason: "channel_unavailable" };
    }

    const result: TurnOutcome = await ctx.runAction(internal.engine.respond, {
      agentId: context.agentId,
      channelType: "messenger",
      channelId: channel._id,
      externalId: context.externalId,
      contactName: context.contactName ?? undefined,
      text: args.text,
    });
    if (!result.conversationId) {
      await ctx.runMutation(internal.conversations.recordCustomerEvent, {
        conversationId: args.conversationId,
        text: args.text,
      });
      return { handled: false, reason: result.error ?? "turn_not_started" };
    }
    return await deliverReply(ctx, channel, channel.messenger, context.externalId, result);
  },
});

export const unsubscribe = internalAction({
  args: { pageId: v.string(), accessToken: v.string() },
  handler: async (_ctx, args) => {
    await fetch(facebookUrl(`${args.pageId}/subscribed_apps`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${args.accessToken}` },
    }).catch(() => undefined);
  },
});

/** Meta's deauthorize and data-deletion callbacks: the person took the app's access back. */
export const revokeUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_type", (q) => q.eq("type", "messenger"))
      .take(1000);
    for (const channel of channels) {
      if (!channel.messenger || channel.messenger.userId !== args.userId) continue;
      await ctx.db.patch(channel._id, {
        messenger: { ...channel.messenger, accessToken: "" },
        status: "error",
        lastError: "Access was removed on Facebook. Reconnect to resume.",
        updatedAt: Date.now(),
      });
    }
  },
});

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const states = await ctx.db.query("messengerOAuthStates").take(500);
    for (const state of states) {
      if (now - state.createdAt > STATE_TTL_MS) await ctx.db.delete(state._id);
    }
  },
});
