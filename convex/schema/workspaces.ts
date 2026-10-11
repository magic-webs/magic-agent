import { defineTable } from "convex/server";
import { v } from "convex/values";
import { kvPair } from "./validators";

export const workspacesTables = {
  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerName: v.optional(v.string()),
    tagline: v.optional(v.string()),
    description: v.optional(v.string()),
    industry: v.optional(v.string()),
    website: v.optional(v.string()),
    supportEmail: v.optional(v.string()),
    supportPhone: v.optional(v.string()),
    address: v.optional(v.string()),
    locale: v.string(),
    timezone: v.string(),
    currency: v.string(),
    theme: v.optional(v.string()),
    logoKey: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    logoUrl: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
    maxMessagesPerConversation: v.optional(v.number()),
    facts: v.array(kvPair),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  teamMembers: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    role: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    photoKey: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("away"),
      v.literal("inactive")
    ),
    messageCount: v.number(),
    lastActiveAt: v.optional(v.number()),
    lastReplyText: v.optional(v.string()),
    lastReplyAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  activityLogs: defineTable({
    workspaceId: v.id("workspaces"),
    actorRole: v.union(
      v.literal("admin"),
      v.literal("workspace"),
      v.literal("member"),
      v.literal("user")
    ),
    actorId: v.string(),
    actorLabel: v.string(),
    table: v.string(),
    entity: v.string(),
    operation: v.union(v.literal("insert"), v.literal("update"), v.literal("delete")),
    docId: v.string(),
    name: v.optional(v.string()),
    fields: v.optional(v.array(v.string())),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_actorId", ["actorId"])
    .index("by_workspace_and_actorId", ["workspaceId", "actorId"]),
};
