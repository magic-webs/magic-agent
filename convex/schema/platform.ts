import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  broadcastAudience,
  broadcastCategory,
  broadcastChannel,
  broadcastChannelStats,
  broadcastChannels,
  broadcastStatus,
} from "./validators";

export const platformTables = {
  platformBroadcasts: defineTable({
    title: v.string(),
    body: v.string(),
    category: broadcastCategory,
    channels: broadcastChannels,
    emailSubject: v.optional(v.string()),
    emailBody: v.optional(v.string()),
    smsText: v.optional(v.string()),
    smsTemplateId: v.optional(v.string()),
    imageKey: v.optional(v.string()),
    link: v.optional(v.string()),
    linkLabel: v.optional(v.string()),
    audience: broadcastAudience,
    /** The workspaces the author's role covers, or absent for every workspace. */
    reach: v.optional(v.array(v.id("workspaces"))),
    status: broadcastStatus,
    scheduledAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    cursor: v.optional(v.string()),
    workspaces: v.number(),
    push: broadcastChannelStats,
    email: broadcastChannelStats,
    sms: broadcastChannelStats,
    error: v.optional(v.string()),
    createdBy: v.id("admins"),
    createdByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_and_scheduledAt", ["status", "scheduledAt"])
    .index("by_createdAt", ["createdAt"]),

  platformDeliveries: defineTable({
    broadcastId: v.id("platformBroadcasts"),
    workspaceId: v.id("workspaces"),
    channel: broadcastChannel,
    recipient: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    detail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_broadcast_and_channel_and_recipient", ["broadcastId", "channel", "recipient"])
    .index("by_broadcast_and_status", ["broadcastId", "status"]),

  platformOptOuts: defineTable({
    channel: v.union(v.literal("email"), v.literal("sms")),
    address: v.string(),
    token: v.string(),
    optedOutAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_channel_and_address", ["channel", "address"]),
};
