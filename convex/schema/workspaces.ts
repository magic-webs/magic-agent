import { defineTable } from "convex/server";
import { v } from "convex/values";
import { escalationDepartment, kvPair, storedWorkspaceStage } from "./validators";

export const welcomeMenuShape = v.object({
  enabled: v.boolean(),
  body: v.string(),
  header: v.optional(v.string()),
  footer: v.optional(v.string()),
  buttonText: v.optional(v.string()),
  headerImageKey: v.optional(v.string()),
  options: v.array(
    v.object({
      title: v.string(),
      description: v.optional(v.string()),
      imageKey: v.optional(v.string()),
    })
  ),
});

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
    welcomeMenu: v.optional(welcomeMenuShape),
    status: v.union(v.literal("active"), v.literal("archived")),
    stage: v.optional(storedWorkspaceStage),
    stageLabel: v.optional(v.string()),
    /** Set when the company signed itself up on the website. */
    source: v.optional(v.literal("signup")),
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
    isOwner: v.optional(v.boolean()),
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

  // Who an escalated thread goes to. The first enabled rule that matches the
  // escalating agent and department wins; several members take turns.
  handoverRules: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    agentId: v.optional(v.id("agents")),
    department: v.optional(escalationDepartment),
    memberIds: v.array(v.id("teamMembers")),
    nextIndex: v.optional(v.number()),
    pauseAgent: v.boolean(),
    pauseMinutes: v.optional(v.number()),
    enabled: v.boolean(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace_and_order", ["workspaceId", "order"]),

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
