import { ConvexError, v, type Infer } from "convex/values";
import { filter as filterRows } from "convex-helpers/server/filter";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalAction,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { deleteFile, fileUrl, newFileKey, r2 } from "./lib/files";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireArea, requireChannel } from "./lib/auth";
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
import { canManagePageComments, facebookUrl } from "./lib/messenger";
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

function isSocial(channel: Doc<"channels">) {
  return (
    (channel.type === "instagram" && Boolean(channel.instagram)) ||
    (channel.type === "messenger" && Boolean(channel.messenger))
  );
}

async function socialChannels(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const channels = await ctx.db
    .query("channels")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(100);
  return channels.filter(isSocial);
}

function channelSummary(channel: Doc<"channels">) {
  const facebook = channel.type === "messenger";
  const username = facebook
    ? (channel.messenger?.pageName ?? "")
    : (channel.instagram?.username ?? "");
  return {
    _id: channel._id,
    type: facebook ? ("messenger" as const) : ("instagram" as const),
    name: channel.name,
    status: channel.status,
    lastError: channel.lastError,
    agentId: channel.agentId,
    username,
    label: facebook ? username : `@${username}`,
    profilePictureUrl: channel.pictureKey
      ? fileUrl(channel.pictureKey)
      : facebook
        ? channel.messenger?.pictureUrl
        : channel.instagram?.profilePictureUrl,
    canManageComments: facebook
      ? canManagePageComments(channel.messenger?.permissions)
      : canManageComments(channel.instagram?.permissions),
  };
}

async function requireSocialChannel(ctx: QueryCtx, channelId: Id<"channels">) {
  const channel = await requireChannel(ctx, channelId);
  if (!isSocial(channel)) {
    throw new ConvexError("That is not an Instagram account or a Facebook Page.");
  }
  return channel;
}

export const overview = query({
  args: { workspaceId: v.id("workspaces"), since: v.number() },
  handler: async (ctx, args) => {
    await requireArea(ctx, args.workspaceId, "social");
    const channels = await socialChannels(ctx, args.workspaceId);
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
      channels: channels.map((channel) => {
        const own = rules.filter((rule) => rule.channelId === channel._id);
        return {
          ...channelSummary(channel),
          rules: { total: own.length, live: own.filter((rule) => rule.enabled).length },
        };
      }),
      rules: { total: rules.length, live: rules.filter((rule) => rule.enabled).length },
      totals,
      capped: recent.length === 2000,
    };
  },
});

export const listRules = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireArea(ctx, args.workspaceId, "social");
    const rules = await ctx.db
      .query("instagramRules")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(200);
    return rules
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((rule) => ({
        ...rule,
        posts: rule.posts.map((post) =>
          post.thumbnailKey ? { ...post, thumbnailUrl: fileUrl(post.thumbnailKey) } : post
        ),
      }));
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
    await requireArea(ctx, args.workspaceId, "social", "edit");
    const channel = await requireSocialChannel(ctx, args.channelId);
    if (channel.workspaceId !== args.workspaceId) {
      throw new ConvexError("That account belongs to another workspace.");
    }
    const clean = cleanRule(args);
    const now = Date.now();

    if (args.ruleId) {
      const existing = await ctx.db.get("instagramRules", args.ruleId);
      if (!existing || existing.workspaceId !== args.workspaceId) {
        throw new ConvexError("That rule no longer exists.");
      }
      const sameChannel = existing.channelId === args.channelId;
      const keys = new Map(
        sameChannel ? existing.posts.map((post) => [post.id, post.thumbnailKey]) : []
      );
      const posts = clean.posts.map((post) => ({ ...post, thumbnailKey: keys.get(post.id) }));
      const kept = new Set(posts.map((post) => post.thumbnailKey));
      for (const post of existing.posts) {
        if (post.thumbnailKey && !kept.has(post.thumbnailKey)) {
          await deleteFile(ctx, post.thumbnailKey);
        }
      }
      await ctx.db.patch(existing._id, {
        ...clean,
        posts,
        channelId: args.channelId,
        enabled: args.enabled,
        oncePerUser: args.oncePerUser,
        updatedAt: now,
      });
      await scheduleThumbnails(ctx, existing._id, posts);
      return existing._id;
    }

    const ruleId = await ctx.db.insert("instagramRules", {
      ...clean,
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      enabled: args.enabled,
      oncePerUser: args.oncePerUser,
      fired: 0,
      createdAt: now,
      updatedAt: now,
    });
    await scheduleThumbnails(ctx, ruleId, clean.posts);
    return ruleId;
  },
});

async function scheduleThumbnails(
  ctx: MutationCtx,
  ruleId: Id<"instagramRules">,
  posts: Doc<"instagramRules">["posts"]
) {
  if (posts.some((post) => !post.thumbnailKey)) {
    await ctx.scheduler.runAfter(0, internal.instagramAutomation.cacheThumbnails, { ruleId });
  }
}

export const thumbnailTarget = internalQuery({
  args: { ruleId: v.id("instagramRules") },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get("instagramRules", args.ruleId);
    if (!rule) return null;
    const channel = await ctx.db.get("channels", rule.channelId);
    if (!channel) return null;
    return {
      workspaceId: rule.workspaceId,
      posts: rule.posts.filter((post) => !post.thumbnailKey),
      instagramToken: channel.instagram?.accessToken,
      pageToken: channel.messenger?.accessToken,
    };
  },
});

const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

async function freshPost(
  target: { instagramToken?: string; pageToken?: string },
  postId: string
): Promise<{ image?: string; caption?: string; permalink?: string } | null> {
  const request = target.pageToken
    ? fetch(facebookUrl(postId, { fields: "full_picture,message,permalink_url" }), {
        headers: { Authorization: `Bearer ${target.pageToken}` },
      })
    : target.instagramToken
      ? fetch(
          graphUrl(`${postId}?fields=media_type,media_url,thumbnail_url,caption,permalink`),
          { headers: { Authorization: `Bearer ${target.instagramToken}` } }
        )
      : null;
  const response = await request?.catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json()) as {
    media_type?: string;
    media_url?: string;
    thumbnail_url?: string;
    caption?: string;
    permalink?: string;
    full_picture?: string;
    message?: string;
    permalink_url?: string;
  };
  return {
    image:
      body.full_picture ??
      body.thumbnail_url ??
      (body.media_type === "VIDEO" ? undefined : body.media_url),
    caption: (body.caption ?? body.message)?.slice(0, 200),
    permalink: body.permalink ?? body.permalink_url,
  };
}

async function downloadImage(url: string) {
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > THUMBNAIL_MAX_BYTES) return null;
  return { bytes, type };
}

export const cacheThumbnails = internalAction({
  args: { ruleId: v.id("instagramRules") },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.instagramAutomation.thumbnailTarget, args);
    if (!target || target.posts.length === 0) return;

    const found: Array<{
      id: string;
      thumbnailKey?: string;
      caption?: string;
      permalink?: string;
    }> = [];
    for (const post of target.posts) {
      const fresh = await freshPost(target, post.id);
      const image =
        (fresh?.image && (await downloadImage(fresh.image))) ||
        (post.thumbnailUrl && (await downloadImage(post.thumbnailUrl))) ||
        null;
      const thumbnailKey = image
        ? await r2.store(ctx, image.bytes, {
            key: newFileKey("social", target.workspaceId),
            type: image.type,
          })
        : undefined;
      if (thumbnailKey || fresh) {
        found.push({
          id: post.id,
          thumbnailKey,
          caption: fresh?.caption,
          permalink: fresh?.permalink,
        });
      }
    }
    if (found.length) {
      await ctx.runMutation(internal.instagramAutomation.attachThumbnails, {
        ruleId: args.ruleId,
        posts: found,
      });
    }
  },
});

export const attachThumbnails = internalMutation({
  args: {
    ruleId: v.id("instagramRules"),
    posts: v.array(
      v.object({
        id: v.string(),
        thumbnailKey: v.optional(v.string()),
        caption: v.optional(v.string()),
        permalink: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const rule = await ctx.db.get("instagramRules", args.ruleId);
    const used = new Set<string>();
    if (rule) {
      const byId = new Map(args.posts.map((post) => [post.id, post]));
      const posts = rule.posts.map((post) => {
        const found = byId.get(post.id);
        if (!found) return post;
        const thumbnailKey = post.thumbnailKey ?? found.thumbnailKey;
        if (!post.thumbnailKey && found.thumbnailKey) used.add(found.thumbnailKey);
        return {
          ...post,
          thumbnailKey,
          caption: post.caption ?? found.caption,
          permalink: post.permalink ?? found.permalink,
        };
      });
      await ctx.db.patch(rule._id, { posts });
    }
    for (const post of args.posts) {
      if (post.thumbnailKey && !used.has(post.thumbnailKey)) {
        await deleteFile(ctx, post.thumbnailKey);
      }
    }
  },
});

export const pictureTarget = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel || !isSocial(channel)) return null;
    return {
      workspaceId: channel.workspaceId,
      pageId: channel.messenger?.pageId,
      pageToken: channel.messenger?.accessToken,
      instagramToken: channel.instagram?.accessToken,
      fallback: channel.messenger?.pictureUrl ?? channel.instagram?.profilePictureUrl,
    };
  },
});

export const cacheChannelPicture = internalAction({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.instagramAutomation.pictureTarget, args);
    if (!target) return;
    const response = await (target.pageId && target.pageToken
      ? fetch(facebookUrl(target.pageId, { fields: "picture.type(large)" }), {
          headers: { Authorization: `Bearer ${target.pageToken}` },
        })
      : target.instagramToken
        ? fetch(graphUrl("me?fields=profile_picture_url"), {
            headers: { Authorization: `Bearer ${target.instagramToken}` },
          })
        : Promise.resolve(null)
    ).catch(() => null);
    const body = response?.ok
      ? ((await response.json()) as {
          profile_picture_url?: string;
          picture?: { data?: { url?: string } };
        })
      : null;
    const fresh = body?.profile_picture_url ?? body?.picture?.data?.url;
    const image =
      (fresh && (await downloadImage(fresh))) ||
      (target.fallback && (await downloadImage(target.fallback))) ||
      null;
    if (!image) return;
    const pictureKey = await r2.store(ctx, image.bytes, {
      key: newFileKey("social", target.workspaceId),
      type: image.type,
    });
    await ctx.runMutation(internal.instagramAutomation.setChannelPicture, {
      channelId: args.channelId,
      pictureKey,
    });
  },
});

export const setChannelPicture = internalMutation({
  args: { channelId: v.id("channels"), pictureKey: v.string() },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel) {
      await deleteFile(ctx, args.pictureKey);
      return;
    }
    if (channel.pictureKey) await deleteFile(ctx, channel.pictureKey);
    await ctx.db.patch(channel._id, { pictureKey: args.pictureKey });
  },
});

export const cacheAllChannelPictures = internalMutation({
  args: {},
  handler: async (ctx) => {
    const channels = await ctx.db.query("channels").take(2000);
    const social = channels.filter((channel) => isSocial(channel) && !channel.pictureKey);
    for (const [index, channel] of social.entries()) {
      await ctx.scheduler.runAfter(index * 500, internal.instagramAutomation.cacheChannelPicture, {
        channelId: channel._id,
      });
    }
    return { scheduled: social.length };
  },
});

export const cacheAllThumbnails = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rules = await ctx.db.query("instagramRules").take(1000);
    let scheduled = 0;
    for (const rule of rules) {
      if (rule.posts.some((post) => !post.thumbnailKey)) {
        await ctx.scheduler.runAfter(scheduled * 500, internal.instagramAutomation.cacheThumbnails, {
          ruleId: rule._id,
        });
        scheduled++;
      }
    }
    return { scheduled };
  },
});

async function requireRule(ctx: QueryCtx, ruleId: Id<"instagramRules">) {
  const rule = await ctx.db.get("instagramRules", ruleId);
  if (!rule) throw new ConvexError("That rule no longer exists.");
  await requireArea(ctx, rule.workspaceId, "social", "edit");
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
    for (const post of rule.posts) {
      if (post.thumbnailKey) await deleteFile(ctx, post.thumbnailKey);
    }
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

const DAY_MS = 24 * 60 * 60 * 1000;
const STATS_DAYS = 7;
const STATS_CAP = 4000;

type Totals = {
  comments: number;
  answered: number;
  publicReplies: number;
  dms: number;
  moderated: number;
  storyMentions: number;
  failed: number;
};

function emptyTotals(): Totals {
  return { comments: 0, answered: 0, publicReplies: 0, dms: 0, moderated: 0, storyMentions: 0, failed: 0 };
}

function count(totals: Totals, row: Doc<"instagramActivity">) {
  if (row.kind === "story_mention") totals.storyMentions++;
  else totals.comments++;
  const replied = row.actions.includes("public_reply");
  const dm = row.actions.includes("dm");
  if (replied) totals.publicReplies++;
  if (dm) totals.dms++;
  if (row.kind === "comment" && (replied || dm)) totals.answered++;
  if (row.actions.includes("hidden") || row.actions.includes("deleted")) totals.moderated++;
  if (row.error) totals.failed++;
}

function top(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

export const channelStats = query({
  args: { channelId: v.id("channels"), now: v.number() },
  handler: async (ctx, args) => {
    const channel = await requireSocialChannel(ctx, args.channelId);
    const today = Math.floor(args.now / DAY_MS) * DAY_MS;
    const start = today - (STATS_DAYS - 1) * DAY_MS;
    const previousStart = start - STATS_DAYS * DAY_MS;

    const rows = await ctx.db
      .query("instagramActivity")
      .withIndex("by_channel_and_createdAt", (q) =>
        q.eq("channelId", channel._id).gte("createdAt", previousStart)
      )
      .order("desc")
      .take(STATS_CAP);

    const current = emptyTotals();
    const previous = emptyTotals();
    const daily = Array.from({ length: STATS_DAYS }, (_, index) => ({
      date: new Date(start + index * DAY_MS).toISOString().slice(0, 10),
      comments: 0,
      answered: 0,
      moderated: 0,
    }));
    const rulesFired = new Map<string, number>();
    const people = new Map<string, number>();

    for (const row of rows) {
      if (row.createdAt < start) {
        count(previous, row);
        continue;
      }
      count(current, row);
      const day = daily[Math.floor((row.createdAt - start) / DAY_MS)];
      if (day && row.kind === "comment") {
        day.comments++;
        if (row.actions.includes("public_reply") || row.actions.includes("dm")) day.answered++;
        if (row.actions.includes("hidden") || row.actions.includes("deleted")) day.moderated++;
      }
      if (row.ruleName && row.actions.length) {
        rulesFired.set(row.ruleName, (rulesFired.get(row.ruleName) ?? 0) + 1);
      }
      const person = row.fromUsername ? `@${row.fromUsername}` : row.fromName;
      if (person && row.kind === "comment") people.set(person, (people.get(person) ?? 0) + 1);
    }

    const rules = await ctx.db
      .query("instagramRules")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .take(200);
    const settings = withDefaults(await settingsRow(ctx, channel._id));
    const summary = channelSummary(channel);

    return {
      days: STATS_DAYS,
      capped: rows.length === STATS_CAP,
      current,
      previous,
      daily,
      topRules: top(rulesFired, 5),
      topPeople: top(people, 5),
      setup: {
        liveRules: rules.filter((rule) => rule.enabled).length,
        totalRules: rules.length,
        moderation: settings.moderation.enabled,
        storyMention: settings.storyMention.enabled,
        iceBreakers: settings.iceBreakers.length,
        canManageComments: summary.canManageComments,
      },
    };
  },
});

export const getSettings = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    await requireSocialChannel(ctx, args.channelId);
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
    const channel = await requireSocialChannel(ctx, args.channelId);
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
    if (iceBreakersChanged && channel.type === "instagram") {
      await ctx.scheduler.runAfter(0, internal.instagramAutomation.syncIceBreakers, {
        channelId: channel._id,
      });
    }
  },
});

const activityFilter = v.union(
  v.literal("all"),
  v.literal("answered"),
  v.literal("moderated"),
  v.literal("skipped"),
  v.literal("stories"),
  v.literal("failed")
);

function fitsFilter(row: Doc<"instagramActivity">, filter: Infer<typeof activityFilter>) {
  const moderated = row.actions.includes("hidden") || row.actions.includes("deleted");
  switch (filter) {
    case "answered":
      return row.actions.includes("public_reply") || row.actions.includes("dm");
    case "moderated":
      return moderated;
    case "skipped":
      return row.actions.length === 0 && !row.error;
    case "stories":
      return row.kind === "story_mention";
    case "failed":
      return Boolean(row.error);
    default:
      return true;
  }
}

export const listActivity = query({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.optional(v.id("channels")),
    filter: v.optional(activityFilter),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireArea(ctx, args.workspaceId, "social");
    const channelId = args.channelId;
    if (channelId) {
      const channel = await ctx.db.get("channels", channelId);
      if (!channel || channel.workspaceId !== args.workspaceId) {
        throw new ConvexError("That account belongs to another workspace.");
      }
    }
    const rows = channelId
      ? ctx.db
          .query("instagramActivity")
          .withIndex("by_channel_and_createdAt", (q) => q.eq("channelId", channelId))
          .order("desc")
      : ctx.db
          .query("instagramActivity")
          .withIndex("by_workspace_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
          .order("desc");
    const filter = args.filter ?? "all";
    return await (
      filter === "all" ? rows : filterRows(rows, (row) => fitsFilter(row, filter))
    ).paginate(args.paginationOpts);
  },
});

export const knownPosts = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await requireSocialChannel(ctx, args.channelId);
    const rules = await ctx.db
      .query("instagramRules")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .take(200);
    const posts: Record<string, { thumbnailUrl?: string; permalink?: string }> = {};
    for (const rule of rules) {
      for (const post of rule.posts) {
        const thumbnailUrl = post.thumbnailKey ? fileUrl(post.thumbnailKey) : undefined;
        if (!posts[post.id]?.thumbnailUrl) {
          posts[post.id] = { thumbnailUrl, permalink: post.permalink };
        }
      }
    }
    return posts;
  },
});

export const recentModerated = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await requireSocialChannel(ctx, args.channelId);
    const recent = await ctx.db
      .query("instagramActivity")
      .withIndex("by_workspace_and_createdAt", (q) => q.eq("workspaceId", channel.workspaceId))
      .order("desc")
      .take(300);
    return recent
      .filter(
        (row) =>
          row.channelId === channel._id &&
          (row.actions.includes("hidden") || row.actions.includes("deleted"))
      )
      .slice(0, 6)
      .map((row) => ({
        _id: row._id,
        from: row.fromName ?? (row.fromUsername ? `@${row.fromUsername}` : "Someone"),
        text: row.text,
        action: row.actions.includes("deleted") ? ("deleted" as const) : ("hidden" as const),
        reason: row.reason,
        createdAt: row.createdAt,
      }));
  },
});

export const channelForViewer = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => await requireSocialChannel(ctx, args.channelId),
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
    if (channel.messenger) return await pagePosts(channel.messenger);
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

async function pagePosts(
  config: NonNullable<Doc<"channels">["messenger"]>
): Promise<InstagramPost[]> {
  const response = await fetch(
    facebookUrl(`${config.pageId}/posts`, {
      fields: "id,message,full_picture,permalink_url,created_time",
      limit: "36",
    }),
    { headers: { Authorization: `Bearer ${config.accessToken}` } }
  ).catch(() => null);
  if (!response?.ok) {
    console.error("[messenger] post list failed", response ? await graphError(response) : "network");
    throw new ConvexError("Facebook would not list the Page's posts. Try again.");
  }
  const body = (await response.json()) as {
    data?: Array<{
      id: string;
      message?: string;
      full_picture?: string;
      permalink_url?: string;
      created_time?: string;
    }>;
  };
  return (body.data ?? []).map((post) => ({
    id: post.id,
    caption: post.message?.slice(0, 200),
    thumbnailUrl: post.full_picture,
    permalink: post.permalink_url,
    timestamp: post.created_time,
  }));
}

export const automationContext = internalQuery({
  args: {
    externalId: v.string(),
    type: v.union(v.literal("instagram"), v.literal("messenger")),
    fromId: v.string(),
  },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .take(10);
    const channel = channels.find((row) => row.type === args.type && isSocial(row));
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
    if (!channel || !isSocial(channel)) return null;
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
  fromName: v.optional(v.string()),
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
    name: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel) return;
    const now = Date.now();
    const type = channel.type === "messenger" ? "messenger" : "instagram";

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
        channelType: type,
        name: args.name ?? (args.username ? `@${args.username}` : undefined),
        attributes: [],
        source: type,
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
        channelType: type,
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

export function dmMessage(dm: NonNullable<Doc<"instagramRules">["dm"]>, text: string) {
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
      externalId: args.userId,
      type: "instagram",
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
