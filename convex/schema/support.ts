import { defineTable } from "convex/server";
import { v } from "convex/values";

export const supportType = v.union(
  v.literal("bug"),
  v.literal("feature"),
  v.literal("question"),
  v.literal("billing"),
  v.literal("channel"),
  v.literal("agent"),
  v.literal("access"),
  v.literal("other")
);

export const supportPriority = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent")
);

export const supportStatus = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("waiting_client"),
  v.literal("resolved"),
  v.literal("closed")
);

export const supportAttachment = v.object({
  key: v.string(),
  name: v.string(),
  type: v.string(),
  size: v.number(),
});

export const supportEventKind = v.union(
  v.literal("created"),
  v.literal("status"),
  v.literal("priority"),
  v.literal("assigned"),
  v.literal("reopened"),
  v.literal("rated"),
  v.literal("access_requested"),
  v.literal("access_declined"),
  v.literal("access_granted"),
  v.literal("access_revoked"),
  v.literal("access_expired"),
  v.literal("workspace_opened"),
  v.literal("vault_added"),
  v.literal("vault_revealed"),
  v.literal("vault_wiped"),
  v.literal("sla_breached")
);

const hoursByPriority = v.object({
  low: v.number(),
  normal: v.number(),
  high: v.number(),
  urgent: v.number(),
});

export const supportTables = {
  supportTickets: defineTable({
    workspaceId: v.id("workspaces"),
    number: v.number(),
    subject: v.string(),
    description: v.string(),
    type: supportType,
    priority: supportPriority,
    urgentReason: v.optional(v.string()),
    status: supportStatus,
    requesterKey: v.string(),
    requesterName: v.string(),
    requesterEmail: v.optional(v.string()),
    assigneeId: v.optional(v.id("admins")),
    assigneeName: v.optional(v.string()),
    link: v.optional(v.string()),
    linkLabel: v.optional(v.string()),
    diagnostics: v.optional(
      v.object({
        page: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        platform: v.optional(v.string()),
        appVersion: v.optional(v.string()),
        screen: v.optional(v.string()),
      })
    ),
    tags: v.array(v.string()),
    clientUnread: v.boolean(),
    staffUnread: v.boolean(),
    lastMessageAt: v.number(),
    lastMessagePreview: v.string(),
    lastReplyBy: v.union(v.literal("client"), v.literal("staff")),
    firstResponseAt: v.optional(v.number()),
    firstResponseDueAt: v.optional(v.number()),
    resolutionDueAt: v.optional(v.number()),
    slaBreached: v.optional(v.boolean()),
    resolvedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    accessUntil: v.optional(v.number()),
    accessGrantedAt: v.optional(v.number()),
    accessGrantedBy: v.optional(v.string()),
    accessRequestedAt: v.optional(v.number()),
    accessRequestNote: v.optional(v.string()),
    rating: v.optional(v.number()),
    ratingComment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_and_updatedAt", ["workspaceId", "updatedAt"])
    .index("by_workspace_and_status", ["workspaceId", "status"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_assigneeId_and_updatedAt", ["assigneeId", "updatedAt"])
    .index("by_assigneeId_and_accessUntil", ["assigneeId", "accessUntil"])
    .index("by_number", ["number"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_createdAt", ["createdAt"])
    .searchIndex("search_subject", {
      searchField: "subject",
      filterFields: ["workspaceId", "status"],
    }),

  supportMessages: defineTable({
    ticketId: v.id("supportTickets"),
    workspaceId: v.id("workspaces"),
    author: v.union(v.literal("client"), v.literal("staff")),
    authorKey: v.string(),
    authorName: v.string(),
    body: v.string(),
    internal: v.boolean(),
    attachments: v.array(supportAttachment),
    createdAt: v.number(),
  }).index("by_ticketId", ["ticketId"]),

  supportEvents: defineTable({
    ticketId: v.id("supportTickets"),
    workspaceId: v.id("workspaces"),
    kind: supportEventKind,
    actorName: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_ticketId", ["ticketId"])
    .index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"]),

  supportVault: defineTable({
    ticketId: v.id("supportTickets"),
    workspaceId: v.id("workspaces"),
    label: v.string(),
    username: v.optional(v.string()),
    sealed: v.string(),
    note: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_ticketId", ["ticketId"]),

  supportReplies: defineTable({
    title: v.string(),
    body: v.string(),
    createdBy: v.id("admins"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_title", ["title"]),

  supportSettings: defineTable({
    firstResponseHours: hoursByPriority,
    resolutionHours: hoursByPriority,
    autoResolveWaitingDays: v.number(),
    autoCloseResolvedDays: v.number(),
    reopenDays: v.number(),
    updatedAt: v.number(),
  }),

  supportViewers: defineTable({
    ticketId: v.id("supportTickets"),
    adminId: v.id("admins"),
    name: v.string(),
    typing: v.boolean(),
    seenAt: v.number(),
  })
    .index("by_ticketId_and_adminId", ["ticketId", "adminId"])
    .index("by_seenAt", ["seenAt"]),

  supportCounter: defineTable({ next: v.number() }),
};
