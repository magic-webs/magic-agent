import { defineTable } from "convex/server";
import { v } from "convex/values";

export const instagramPost = v.object({
  id: v.string(),
  caption: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  permalink: v.optional(v.string()),
});

export const instagramPublicReply = v.object({
  mode: v.union(v.literal("off"), v.literal("fixed"), v.literal("ai")),
  variants: v.array(v.string()),
});

export const instagramDm = v.object({
  text: v.string(),
  buttonTitle: v.optional(v.string()),
  buttonUrl: v.optional(v.string()),
});

export const instagramModeration = v.object({
  enabled: v.boolean(),
  action: v.union(v.literal("hide"), v.literal("delete")),
  blockLinks: v.boolean(),
  blockedWords: v.array(v.string()),
  screenWithAi: v.boolean(),
});

export const instagramStoryMention = v.object({
  enabled: v.boolean(),
  message: v.string(),
});

export const instagramIceBreaker = v.object({ question: v.string() });

export const instagramAction = v.union(
  v.literal("public_reply"),
  v.literal("dm"),
  v.literal("hidden"),
  v.literal("deleted")
);

export const instagramTables = {
  instagramRules: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    name: v.string(),
    enabled: v.boolean(),
    match: v.union(v.literal("any"), v.literal("keywords")),
    keywords: v.array(v.string()),
    posts: v.array(instagramPost),
    publicReply: instagramPublicReply,
    dm: v.optional(instagramDm),
    oncePerUser: v.boolean(),
    fired: v.number(),
    lastFiredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_channel", ["channelId"]),

  instagramSettings: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    moderation: instagramModeration,
    storyMention: instagramStoryMention,
    iceBreakers: v.array(instagramIceBreaker),
    iceBreakersSync: v.optional(
      v.object({ ok: v.boolean(), error: v.optional(v.string()), at: v.number() })
    ),
    updatedAt: v.number(),
  }).index("by_channel", ["channelId"]),

  instagramActivity: defineTable({
    workspaceId: v.id("workspaces"),
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
    createdAt: v.number(),
  })
    .index("by_workspace_and_createdAt", ["workspaceId", "createdAt"])
    .index("by_channel_and_fromId", ["channelId", "fromId"])
    .index("by_createdAt", ["createdAt"]),
};
