import { defineTable } from "convex/server";
import { v } from "convex/values";

export const paymentLinkStatus = v.union(
  v.literal("created"),
  v.literal("partially_paid"),
  v.literal("paid"),
  v.literal("expired"),
  v.literal("cancelled")
);

export const paymentsTables = {
  paymentConnections: defineTable({
    workspaceId: v.id("workspaces"),
    provider: v.literal("razorpay"),
    keyId: v.string(),
    keySecret: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    inboundKey: v.string(),
    webhookSecret: v.string(),
    currency: v.string(),
    notifySms: v.boolean(),
    notifyEmail: v.boolean(),
    expiryHours: v.number(),
    paidStage: v.optional(v.string()),
    status: v.union(v.literal("connected"), v.literal("error")),
    lastError: v.optional(v.string()),
    lastWebhookAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_inboundKey", ["inboundKey"]),

  paymentLinks: defineTable({
    workspaceId: v.id("workspaces"),
    connectionId: v.id("paymentConnections"),
    razorpayLinkId: v.string(),
    referenceId: v.string(),
    shortUrl: v.string(),
    amountPaise: v.number(),
    amountPaidPaise: v.number(),
    currency: v.string(),
    description: v.string(),
    status: paymentLinkStatus,
    customer: v.object({
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
    }),
    recordId: v.optional(v.id("records")),
    recordReference: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
    agentId: v.optional(v.id("agents")),
    source: v.union(v.literal("agent"), v.literal("team")),
    razorpayPaymentId: v.optional(v.string()),
    method: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_razorpay_link", ["razorpayLinkId"])
    .index("by_record", ["recordId"])
    .index("by_conversation", ["conversationId"]),
};
