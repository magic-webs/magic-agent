import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalAction,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireChannel, requireWorkspace } from "./lib/auth";
import { insertConversation, noteMessage } from "./lib/inbox";
import { recordAgentReply } from "./lib/agentStats";
import { friendlySendError } from "./lib/sendErrors";
import {
  INSTAGRAM_TEXT_LIMIT,
  MAX_ICE_BREAKERS,
  MAX_RULE_POSTS,
  PUBLIC_REPLY_LIMIT,
  canManageComments,
  fillUsername,
  graphUrl,
  moderationReason,
  pickRule,
  tidyWords,
} from "./lib/instagram";
import { graphError, sendOne, type InstagramConfig } from "./instagram";
import {
  instagramAction,
  instagramDm,
  instagramIceBreaker,
  instagramModeration,
  instagramPost,
  instagramPublicReply,
  instagramStoryMention,
} from "./schema";

const DEFAULT_SETTINGS = {
  moderation: {
    enabled: false,
    action: "hide" as const,
    blockLinks: true,
    blockedWords: [] as string[],
    screenWithAi: false,
  },
  storyMention: {
    enabled: false,
    message: "Thank you for the mention, {{username}}! 💛",
  },
  iceBreakers: [] as Array<{ question: string }>,
};

const BUTTON_TEXT_LIMIT = 640;
const BUTTON_TITLE_LIMIT = 20;

async function instagramChannels(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const channels = await ctx.db
    .query("channels")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(100);
  return channels.filter((channel) => channel.type === "instagram" && channel.instagram);
}

function channelSummary(channel: Doc<"channels">) {
  return {
    _id: channel._id,
    name: channel.name,
    status: channel.status,
    lastError: channel.lastError,
    agentId: channel.agentId,
    username: channel.instagram?.username ?? "",
    profilePictureUrl: channel.instagram?.profilePictureUrl,
    canManageComments: canManageComments(channel.instagram?.permissions),
  };
}

async function requireInstagramChannel(ctx: QueryCtx, channelId: Id<"channels">) {
  const channel = await requireChannel(ctx, channelId);
  if (channel.type !== "instagram" || !channel.instagram) {
    throw new ConvexError("That is not an Instagram channel.");
  }
  return channel;
}

export const overview = query({
  args: { workspaceId: v.id("workspaces"), since: v.number() },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const channels = await instagramChannels(ctx, args.workspaceId);
    const rules = await ctx.db
      .query("instagramRules")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(200);
    const recent = await ctx.db
      .query("instagramActivity")
      .withIndex("by_workspace_and_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId).gte("createdAt", args.since)
      )
      .order("desc")
      .take(2000);

    const totals = { comments: 0, publicReplies: 0, dms: 0, moderated: 0, storyMentions: 0 };
    for (const row of recent) {
      if (row.kind === "story_mention") totals.storyMentions++;
      else totals.comments++;
      if (row.actions.includes("public_reply")) totals.publicReplies++;
      if (row.actions.includes("dm")) totals.dms++;
      if (row.actions.includes("hidden") || row.actions.includes("deleted")) {
        totals.moderated++;
      }
    }

    return {
      channels: channels.map(channelSummary),
      rules: { total: rules.length, live: rules.filter((rule) => rule.enabled).length },
      totals,
      capped: recent.length === 2000,
    };
  },
});

export const listRules = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rules = await ctx.db
      .query("instagramRules")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(200);
    return rules.sort((a, b) => b.createdAt - a.createdAt);
  },
});

const ruleFields = {
  channelId: v.id("channels"),
  name: v.string(),
  enabled: v.boolean(),
  match: v.union(v.literal("any"), v.literal("keywords")),
  keywords: v.array(v.string()),
  posts: v.array(instagramPost),
  publicReply: instagramPublicReply,
  dm: v.optional(instagramDm),
  oncePerUser: v.boolean(),
};

function cleanRule(args: {
  name: string;
  match: "any" | "keywords";
  keywords: string[];
  posts: Doc<"instagramRules">["posts"];
  publicReply: Doc<"instagramRules">["publicReply"];
  dm?: Doc<"instagramRules">["dm"];
}) {
  const name = args.name.trim().slice(0, 80);
  if (!name) throw new ConvexError("Give the rule a name.");

  const keywords = tidyWords(args.keywords);
  if (args.match === "keywords" && keywords.length === 0) {
    throw new ConvexError("Add at least one keyword, or answer every comment.");
  }
  if (args.posts.length > MAX_RULE_POSTS) {
    throw new ConvexError(`Pick at most ${MAX_RULE_POSTS} posts.`);
  }

  const variants = args.publicReply.variants
    .map((variant) => variant.trim().slice(0, PUBLIC_REPLY_LIMIT))
    .filter(Boolean)
    .slice(0, 10);
  if (args.publicReply.mode === "fixed" && variants.length === 0) {
    throw new ConvexError("Write at least one public reply.");
  }

  let dm = args.dm;
  if (dm) {
    const text = dm.text.trim();
    if (!text) throw new ConvexError("Write the DM, or turn it off.");
    const buttonTitle = dm.buttonTitle?.trim().slice(0, BUTTON_TITLE_LIMIT) || undefined;
    const buttonUrl = dm.buttonUrl?.trim() || undefined;
    if (Boolean(buttonTitle) !== Boolean(buttonUrl)) {
      throw new ConvexError("A DM button needs both a label and a link.");
    }
    if (buttonUrl && !/^https:\/\/\S+$/i.test(buttonUrl)) {
      throw new ConvexError("The button link must start with https://");
    }
    dm = {
      text: text.slice(0, buttonUrl ? BUTTON_TEXT_LIMIT : INSTAGRAM_TEXT_LIMIT),
      buttonTitle,
      buttonUrl,
    };
  }

  if (args.publicReply.mode === "off" && !dm) {
    throw new ConvexError("Turn on a public reply, a DM, or both.");
  }

  return {
    name,
    match: args.match,
    keywords: args.match === "keywords" ? keywords : [],
    posts: args.posts.map((post) => ({
      id: post.id,
      caption: post.caption?.slice(0, 200),
      thumbnailUrl: post.thumbnailUrl,
      permalink: post.permalink,
    })),
    publicReply: { mode: args.publicReply.mode, variants },
    dm,
  };
}

export const saveRule = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    ruleId: v.optional(v.id("instagramRules")),
    ...ruleFields,
  },
  handler: async (ctx, args): Promise<Id<"instagramRules">> => {
    await requireWorkspace(ctx, args.workspaceId);
    const channel = await requireInstagramChannel(ctx, args.channelId);
    if (channel.workspaceId !== args.workspaceId) {
      throw new ConvexError("That Instagram account belongs to another workspace.");
    }
    const clean = cleanRule(args);
    const now = Date.now();

    if (args.ruleId) {
      const existing = await ctx.db.get("instagramRules", args.ruleId);
      if (!existing || existing.workspaceId !== args.workspaceId) {
        throw new ConvexError("That rule no longer exists.");
      }
      await ctx.db.patch(existing._id, {
        ...clean,
        channelId: args.channelId,
        enabled: args.enabled,
        oncePerUser: args.oncePerUser,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("instagramRules", {
      ...clean,
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      enabled: args.enabled,
      oncePerUser: args.oncePerUser,
      fired: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function requireRule(ctx: QueryCtx, ruleId: Id<"instagramRules">) {
  const rule = await ctx.db.get("instagramRules", ruleId);
  if (!rule) throw new ConvexError("That rule no longer exists.");
  await requireWorkspace(ctx, rule.workspaceId);
  return rule;
}

export const setRuleEnabled = mutation({
  args: { ruleId: v.id("instagramRules"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const rule = await requireRule(ctx, args.ruleId);
    await ctx.db.patch(rule._id, { enabled: args.enabled, updatedAt: Date.now() });
  },
});

export const removeRule = mutation({
  args: { ruleId: v.id("instagramRules") },
  handler: async (ctx, args) => {
    const rule = await requireRule(ctx, args.ruleId);
    await ctx.db.delete(rule._id);
  },
});

async function settingsRow(ctx: QueryCtx, channelId: Id<"channels">) {
  return await ctx.db
    .query("instagramSettings")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .unique();
}

function withDefaults(row: Doc<"instagramSettings"> | null) {
  return {
    moderation: row?.moderation ?? DEFAULT_SETTINGS.moderation,
    storyMention: row?.storyMention ?? DEFAULT_SETTINGS.storyMention,
    iceBreakers: row?.iceBreakers ?? DEFAULT_SETTINGS.iceBreakers,
    iceBreakersSync: row?.iceBreakersSync,
  };
}

export const getSettings = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireInstagramChannel(ctx, args.channelId);
    return withDefaults(await settingsRow(ctx, args.channelId));
  },
});

export const saveSettings = mutation({
  args: {
    channelId: v.id("channels"),
    moderation: v.optional(instagramModeration),
    storyMention: v.optional(instagramStoryMention),
    iceBreakers: v.optional(v.array(instagramIceBreaker)),
  },
  handler: async (ctx, args) => {
    const channel = await requireInstagramChannel(ctx, args.channelId);
    const row = await settingsRow(ctx, args.channelId);
    const current = withDefaults(row);

    const moderation = args.moderation
      ? { ...args.moderation, blockedWords: tidyWords(args.moderation.blockedWords) }
      : current.moderation;

    const storyMention = args.storyMention
      ? { enabled: args.storyMention.enabled, message: args.storyMention.message.trim().slice(0, INSTAGRAM_TEXT_LIMIT) }
      : current.storyMention;
    if (storyMention.enabled && !storyMention.message) {
      throw new ConvexError("Write the reply to a story mention, or turn it off.");
    }

    const iceBreakers = args.iceBreakers
      ? args.iceBreakers
          .map((item) => ({ question: item.question.trim().slice(0, 80) }))
          .filter((item) => item.question)
      : current.iceBreakers;
    if (iceBreakers.length > MAX_ICE_BREAKERS) {
      throw new ConvexError(`Instagram shows at most ${MAX_ICE_BREAKERS} questions.`);
    }
    const iceBreakersChanged =
      args.iceBreakers !== undefined &&
      JSON.stringify(iceBreakers) !== JSON.stringify(current.iceBreakers);

    const fields = { moderation, storyMention, iceBreakers, updatedAt: Date.now() };
    if (row) {
      await ctx.db.patch(row._id, fields);
    } else {
      await ctx.db.insert("instagramSettings", {
        ...fields,
        workspaceId: channel.workspaceId,
        channelId: channel._id,
      });
    }
    if (iceBreakersChanged) {
      await ctx.scheduler.runAfter(0, internal.instagramAutomation.syncIceBreakers, {
        channelId: channel._id,
      });
    }
  },
});

export const listActivity = query({
  args: { workspaceId: v.id("workspaces"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await ctx.db
      .query("instagramActivity")
      .withIndex("by_workspace_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const channelForViewer = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => await requireInstagramChannel(ctx, args.channelId),
});

export type InstagramPost = {
  id: string;
  caption?: string;
  thumbnailUrl?: string;
  permalink?: string;
  mediaType?: string;
  timestamp?: string;
};

export const listMedia = action({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args): Promise<InstagramPost[]> => {
    const channel: Doc<"channels"> = await ctx.runQuery(
      internal.instagramAutomation.channelForViewer,
      { channelId: args.channelId }
    );
    const response = await fetch(
      graphUrl(
        "me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=36"
      ),
      { headers: { Authorization: `Bearer ${channel.instagram!.accessToken}` } }
    );
    if (!response.ok) {
      console.error("[instagram] media list failed", await graphError(response));
      throw new ConvexError("Instagram would not list the account's posts. Try again.");
    }
    const body = (await response.json()) as {
      data?: Array<{
        id: string;
        caption?: string;
        media_type?: string;
        media_url?: string;
        thumbnail_url?: string;
        permalink?: string;
        timestamp?: string;
      }>;
    };
    return (body.data ?? []).map((post) => ({
      id: post.id,
      caption: post.caption?.slice(0, 200),
      thumbnailUrl:
        post.thumbnail_url ?? (post.media_type === "VIDEO" ? undefined : post.media_url),
      permalink: post.permalink,
      mediaType: post.media_type,
      timestamp: post.timestamp,
    }));
  },
});

export const automationContext = internalQuery({
  args: { userId: v.string(), fromId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.userId))
      .take(10);
    const channel = channels.find((row) => row.type === "instagram" && row.instagram);
    if (!channel) return null;

    const rules = await ctx.db
      .query("instagramRules")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .take(100);
    const prior = await ctx.db
      .query("instagramActivity")
      .withIndex("by_channel_and_fromId", (q) =>
        q.eq("channelId", channel._id).eq("fromId", args.fromId)
      )
      .order("desc")
      .take(50);

    return {
      channel,
      settings: withDefaults(await settingsRow(ctx, channel._id)),
      rules,
      answeredRuleIds: prior
        .filter((row) => row.ruleId && row.actions.length > 0)
        .map((row) => row.ruleId!),
    };
  },
});

export const settingsForChannel = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel?.instagram) return null;
    return { channel, settings: withDefaults(await settingsRow(ctx, args.channelId)) };
  },
});

const activityFields = {
  channelId: v.id("channels"),
  kind: v.union(v.literal("comment"), v.literal("story_mention")),
  externalId: v.string(),
  mediaId: v.optional(v.string()),
  fromId: v.string(),
  fromUsername: v.optional(v.string()),
  text: v.string(),
  actions: v.array(instagramAction),
  ruleId: v.optional(v.id("instagramRules")),
  ruleName: v.optional(v.string()),
  publicReply: v.optional(v.string()),
  dmText: v.optional(v.string()),
  reason: v.optional(v.string()),
  error: v.optional(v.string()),
};

export const logActivity = internalMutation({
  args: activityFields,
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel) return;
    const now = Date.now();
    await ctx.db.insert("instagramActivity", {
      ...args,
      text: args.text.slice(0, 2000),
      error: args.error?.slice(0, 500),
      workspaceId: channel.workspaceId,
      createdAt: now,
    });
    if (args.ruleId && args.actions.length > 0) {
      const rule = await ctx.db.get("instagramRules", args.ruleId);
      if (rule) {
        await ctx.db.patch(rule._id, { fired: rule.fired + 1, lastFiredAt: now });
      }
    }
  },
});

/**
 * Puts a DM the automation sent into the person's thread, opening one for
 * somebody who has never written, so the inbox shows it and the agent reads it
 * in history when they answer.
 */
export const recordDm = internalMutation({
  args: {
    channelId: v.id("channels"),
    fromId: v.string(),
    username: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel) return;
    const now = Date.now();

    let contact = await ctx.db
      .query("contacts")
      .withIndex("by_workspace_external", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("externalId", args.fromId)
      )
      .unique();
    if (!contact) {
      const contactId = await ctx.db.insert("contacts", {
        workspaceId: channel.workspaceId,
        externalId: args.fromId,
        channelType: "instagram",
        name: args.username ? `@${args.username}` : undefined,
        attributes: [],
        source: "instagram",
        lastSeenAt: now,
        createdAt: now,
      });
      contact = (await ctx.db.get("contacts", contactId))!;
    }

    let thread = await ctx.db
      .query("conversations")
      .withIndex("by_contact_agent", (q) =>
        q.eq("contactId", contact._id).eq("agentId", channel.agentId)
      )
      .unique();
    if (!thread) {
      const conversationId = await insertConversation(ctx, {
        workspaceId: channel.workspaceId,
        agentId: channel.agentId,
        activeAgentId: channel.agentId,
        handoffCount: 0,
        contactId: contact._id,
        channelId: channel._id,
        channelType: "instagram",
        status: "open",
        messageCount: 0,
        lastMessageAt: now,
        marketingOnly: true,
        createdAt: now,
      });
      thread = (await ctx.db.get("conversations", conversationId))!;
    }

    await ctx.db.insert("messages", {
      workspaceId: channel.workspaceId,
      conversationId: thread._id,
      role: "assistant",
      kind: "text",
      text: args.text,
      agentId: channel.agentId,
      createdAt: now,
    });
    await recordAgentReply(ctx, channel.workspaceId, channel.agentId, {
      at: now,
      text: args.text,
    });
    const agent = await ctx.db.get("agents", channel.agentId);
    await noteMessage(ctx, thread, {
      from: "agent",
      sender: agent?.botName,
      preview: args.text,
      at: now,
    });
  },
});

export const noteIceBreakersSync = internalMutation({
  args: { channelId: v.id("channels"), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await settingsRow(ctx, args.channelId);
    if (!row) return;
    await ctx.db.patch(row._id, {
      iceBreakersSync: { ok: args.ok, error: args.error?.slice(0, 500), at: Date.now() },
    });
  },
});

type GraphResult = { ok: boolean; error?: string };

async function graphCall(
  config: InstagramConfig,
  path: string,
  init: { method: "POST" | "DELETE"; body?: Record<string, unknown> }
): Promise<GraphResult> {
  const response = await fetch(graphUrl(path), {
    method: init.method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  }).catch(() => null);
  if (!response) return { ok: false, error: "Instagram could not be reached." };
  if (!response.ok) return { ok: false, error: await graphError(response) };
  return { ok: true };
}

export const syncIceBreakers = internalAction({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const found = await ctx.runQuery(internal.instagramAutomation.settingsForChannel, {
      channelId: args.channelId,
    });
    if (!found?.channel.instagram?.accessToken) return;
    const config = found.channel.instagram;
    const questions = found.settings.iceBreakers;

    const result =
      questions.length > 0
        ? await graphCall(config, "me/messenger_profile", {
            method: "POST",
            body: {
              platform: "instagram",
              ice_breakers: [
                {
                  locale: "default",
                  call_to_actions: questions.map((item, index) => ({
                    question: item.question,
                    payload: `ICE_BREAKER_${index + 1}`,
                  })),
                },
              ],
            },
          })
        : await graphCall(config, "me/messenger_profile", {
            method: "DELETE",
            body: { fields: ["ice_breakers"] },
          });

    if (!result.ok) console.error("[instagram] ice breakers failed", result.error);
    await ctx.runMutation(internal.instagramAutomation.noteIceBreakersSync, {
      channelId: args.channelId,
      ok: result.ok,
      error: result.ok ? undefined : friendlySendError("instagram", result.error),
    });
  },
});

type CommentValue = {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
};

async function postCaption(config: InstagramConfig, mediaId: string | undefined) {
  if (!mediaId) return undefined;
  const response = await fetch(graphUrl(`${mediaId}?fields=caption`), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const body = (await response.json().catch(() => null)) as { caption?: string } | null;
  return body?.caption?.slice(0, 1000);
}

function dmMessage(dm: NonNullable<Doc<"instagramRules">["dm"]>, text: string) {
  if (!dm.buttonUrl || !dm.buttonTitle) return { text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, BUTTON_TEXT_LIMIT),
        buttons: [{ type: "web_url", url: dm.buttonUrl, title: dm.buttonTitle }],
      },
    },
  };
}

export const handleComment = internalAction({
  args: { userId: v.string(), comment: v.any() },
  handler: async (ctx, args): Promise<{ handled: boolean; reason?: string }> => {
    const value = (args.comment ?? {}) as CommentValue;
    const commentId = value.id;
    const fromId = value.from?.id;
    const text = (value.text ?? "").trim();
    if (!commentId || !fromId || !text) return { handled: false, reason: "incomplete" };
    if (fromId === args.userId) return { handled: false, reason: "own_comment" };

    const context = await ctx.runQuery(internal.instagramAutomation.automationContext, {
      userId: args.userId,
      fromId,
    });
    if (!context) return { handled: false, reason: "unknown_account" };
    const { channel, settings, rules, answeredRuleIds } = context;
    const config = channel.instagram!;
    if (channel.status !== "active" || !config.accessToken) {
      return { handled: false, reason: "channel_paused" };
    }
    if (value.from?.username && value.from.username === config.username) {
      return { handled: false, reason: "own_comment" };
    }
    if (!(await ctx.runMutation(internal.instagram.claimEvent, { mid: `comment:${commentId}` }))) {
      return { handled: false, reason: "duplicate" };
    }

    const username = value.from?.username;
    const mediaId = value.media?.id;
    const base = {
      channelId: channel._id,
      kind: "comment" as const,
      externalId: commentId,
      mediaId,
      fromId,
      fromUsername: username,
      text,
    };

    if (settings.moderation.enabled) {
      let reason = moderationReason(settings.moderation, text);
      if (!reason && settings.moderation.screenWithAi) {
        reason = await ctx.runAction(internal.instagramAi.screenComment, {
          workspaceId: channel.workspaceId,
          agentId: channel.agentId,
          text,
        });
      }
      if (reason) {
        const hide = settings.moderation.action === "hide";
        const result = hide
          ? await graphCall(config, `${commentId}?hide=true`, { method: "POST" })
          : await graphCall(config, commentId, { method: "DELETE" });
        await ctx.runMutation(internal.instagramAutomation.logActivity, {
          ...base,
          actions: result.ok ? [hide ? "hidden" : "deleted"] : [],
          reason,
          error: result.ok ? undefined : friendlySendError("instagram", result.error),
        });
        return { handled: true, reason: "moderated" };
      }
    }

    const rule = pickRule(rules, { text, mediaId });
    if (!rule) {
      await ctx.runMutation(internal.instagramAutomation.logActivity, {
        ...base,
        actions: [],
        reason: "No rule matched",
      });
      return { handled: false, reason: "no_rule" };
    }
    const ruleRef = { ruleId: rule._id, ruleName: rule.name };
    if (rule.oncePerUser && answeredRuleIds.includes(rule._id)) {
      await ctx.runMutation(internal.instagramAutomation.logActivity, {
        ...base,
        ...ruleRef,
        actions: [],
        reason: "Already answered this person",
      });
      return { handled: false, reason: "already_answered" };
    }

    const actions: Array<"public_reply" | "dm"> = [];
    const errors: string[] = [];

    let publicReply: string | undefined;
    if (rule.publicReply.mode !== "off") {
      const written =
        rule.publicReply.mode === "ai"
          ? await ctx.runAction(internal.instagramAi.writeReply, {
              workspaceId: channel.workspaceId,
              agentId: channel.agentId,
              comment: text,
              username,
              caption: await postCaption(config, mediaId),
              sendsDm: Boolean(rule.dm),
            })
          : rule.publicReply.variants[
              Math.floor(Math.random() * rule.publicReply.variants.length)
            ];
      publicReply = fillUsername(written ?? "", username).slice(0, PUBLIC_REPLY_LIMIT) || undefined;
      if (publicReply) {
        const sent = await graphCall(
          config,
          `${commentId}/replies?message=${encodeURIComponent(publicReply)}`,
          { method: "POST" }
        );
        if (sent.ok) actions.push("public_reply");
        else errors.push(`Reply: ${friendlySendError("instagram", sent.error)}`);
      }
    }

    let dmText: string | undefined;
    if (rule.dm) {
      dmText = fillUsername(rule.dm.text, username);
      const sent = await sendOne(
        config,
        { comment_id: commentId },
        { message: dmMessage(rule.dm, dmText) }
      );
      if (sent.ok) {
        actions.push("dm");
        await ctx.runMutation(internal.instagramAutomation.recordDm, {
          channelId: channel._id,
          fromId,
          username,
          text: rule.dm.buttonUrl ? `${dmText}\n\n${rule.dm.buttonTitle}: ${rule.dm.buttonUrl}` : dmText,
        });
      } else {
        errors.push(`DM: ${friendlySendError("instagram", sent.error)}`);
      }
    }

    await ctx.runMutation(internal.instagramAutomation.logActivity, {
      ...base,
      ...ruleRef,
      actions,
      publicReply,
      dmText,
      error: errors.length ? errors.join(" · ") : undefined,
    });
    return { handled: actions.length > 0, reason: errors.length ? "partial" : undefined };
  },
});

async function instagramUsername(config: InstagramConfig, userId: string) {
  const response = await fetch(graphUrl(`${userId}?fields=username`), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const body = (await response.json().catch(() => null)) as { username?: string } | null;
  return body?.username;
}

export const answerStoryMention = internalAction({
  args: { channelId: v.id("channels"), fromId: v.string(), mid: v.string() },
  handler: async (ctx, args): Promise<{ handled: boolean; reason?: string }> => {
    const found = await ctx.runQuery(internal.instagramAutomation.settingsForChannel, {
      channelId: args.channelId,
    });
    if (!found?.channel.instagram?.accessToken) {
      return { handled: false, reason: "unknown_account" };
    }
    const config = found.channel.instagram;
    const { storyMention } = found.settings;
    const username = await instagramUsername(config, args.fromId);
    const base = {
      channelId: args.channelId,
      kind: "story_mention" as const,
      externalId: args.mid,
      fromId: args.fromId,
      fromUsername: username,
      text: "Mentioned the account in their story",
    };

    if (!storyMention.enabled) {
      await ctx.runMutation(internal.instagramAutomation.logActivity, {
        ...base,
        actions: [],
        reason: "Story mention replies are off",
      });
      return { handled: false, reason: "story_mention" };
    }

    const dmText = fillUsername(storyMention.message, username);
    const sent = await sendOne(config, { id: args.fromId }, { message: { text: dmText } });
    if (sent.ok) {
      await ctx.runMutation(internal.instagramAutomation.recordDm, {
        channelId: args.channelId,
        fromId: args.fromId,
        username,
        text: dmText,
      });
    }
    await ctx.runMutation(internal.instagramAutomation.logActivity, {
      ...base,
      actions: sent.ok ? ["dm"] : [],
      dmText,
      error: sent.ok ? undefined : friendlySendError("instagram", sent.error),
    });
    return { handled: sent.ok, reason: "story_mention" };
  },
});

export const aiContext = internalQuery({
  args: { workspaceId: v.id("workspaces"), agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!agent || !workspace || agent.workspaceId !== args.workspaceId) return null;
    return {
      agent: {
        jobDescription: agent.jobDescription,
        guardrails: agent.guardrails,
        tone: agent.tone,
        model: agent.model,
        temperature: agent.temperature,
      },
      workspace: {
        name: workspace.name,
        industry: workspace.industry,
        description: workspace.description,
      },
    };
  },
});
