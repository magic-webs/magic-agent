import { defineTable } from "convex/server";
import { v } from "convex/values";

export const genieStatus = v.union(
  v.literal("idle"),
  v.literal("working"),
  v.literal("waiting"),
  v.literal("failed")
);

export const genieActionState = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("done"),
  v.literal("failed")
);

export const genieAttachment = v.object({
  key: v.string(),
  name: v.string(),
  mime: v.string(),
});

export const genieTables = {
  genieThreads: defineTable({
    workspaceId: v.id("workspaces"),
    owner: v.string(),
    subject: v.string(),
    title: v.string(),
    status: genieStatus,
    autoApprove: v.boolean(),
    voice: v.optional(v.boolean()),
    pinned: v.optional(v.boolean()),
    run: v.number(),
    error: v.optional(v.string()),
    wishEventId: v.optional(v.id("billingEvents")),
    updatedAt: v.number(),
  }).index("by_owner", ["workspaceId", "owner", "updatedAt"]),

  genieItems: defineTable({
    threadId: v.id("genieThreads"),
    kind: v.union(v.literal("user"), v.literal("reply"), v.literal("action")),
    text: v.string(),
    attachments: v.optional(v.array(genieAttachment)),
    tool: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    approvalId: v.optional(v.string()),
    input: v.optional(v.string()),
    output: v.optional(v.string()),
    state: v.optional(genieActionState),
    readOnly: v.optional(v.boolean()),
    audioKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_tool_call", ["threadId", "toolCallId"]),

  genieVoiceUsage: defineTable({
    workspaceId: v.id("workspaces"),
    seconds: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  genieMemory: defineTable({
    threadId: v.id("genieThreads"),
    messages: v.string(),
  }).index("by_thread", ["threadId"]),
};
