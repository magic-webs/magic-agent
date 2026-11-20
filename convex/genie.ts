import { ConvexError, v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./functions";
import type { MutationCtx } from "./_generated/server";
import {
  AuthError,
  getPrincipal,
  principalKey,
  requireWorkspace,
} from "./lib/auth";
import { fileUrl, requireOwnKey } from "./lib/files";
import { genieActionState, genieAttachment, genieStatus } from "./schema/genie";

const THREAD_LIST = 30;
const ITEM_LIMIT = 300;
const MAX_ATTACHMENTS = 5;
const MAX_TEXT = 8_000;

type ModelMessage = Record<string, unknown>;

async function ownThread(ctx: QueryCtx, threadId: Id<"genieThreads">) {
  const principal = await getPrincipal(ctx);
  if (!principal) throw new AuthError("Sign in to continue.");
  const thread = await ctx.db.get("genieThreads", threadId);
  if (!thread) return null;
  await requireWorkspace(ctx, thread.workspaceId);
  if (thread.owner !== principalKey(principal)) return null;
  return thread;
}

async function requireThread(ctx: QueryCtx, threadId: Id<"genieThreads">) {
  const thread = await ownThread(ctx, threadId);
  if (!thread) throw new ConvexError("That Genie chat no longer exists.");
  return thread;
}

async function readMemory(ctx: QueryCtx, threadId: Id<"genieThreads">) {
  const row = await ctx.db
    .query("genieMemory")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
  return { row, messages: row ? (JSON.parse(row.messages) as ModelMessage[]) : [] };
}

async function writeMemory(
  ctx: MutationCtx,
  threadId: Id<"genieThreads">,
  row: Doc<"genieMemory"> | null,
  messages: ModelMessage[]
) {
  const text = JSON.stringify(messages);
  if (row) await ctx.db.patch("genieMemory", row._id, { messages: text });
  else await ctx.db.insert("genieMemory", { threadId, messages: text });
}

async function pendingActions(ctx: QueryCtx, threadId: Id<"genieThreads">) {
  const items = await ctx.db
    .query("genieItems")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .order("desc")
    .take(60);
  return items.filter((item) => item.approvalId !== undefined);
}

/** Answers every decided approval in one tool message, which is what the model expects back. */
async function answerApprovals(
  ctx: MutationCtx,
  items: Doc<"genieItems">[],
  messages: ModelMessage[],
  reason?: string
) {
  const content = [];
  for (const item of items) {
    if (!item.approvalId) continue;
    const approved = item.state === "approved";
    content.push({
      type: "tool-approval-response",
      approvalId: item.approvalId,
      approved,
      ...(!approved && reason ? { reason } : {}),
    });
    await ctx.db.patch("genieItems", item._id, {
      approvalId: undefined,
      ...(approved ? {} : { state: "declined" as const }),
    });
  }
  if (content.length > 0) messages.push({ role: "tool", content });
}

async function startRun(
  ctx: MutationCtx,
  thread: Doc<"genieThreads">,
  patch: Partial<Doc<"genieThreads">> = {}
) {
  const run = thread.run + 1;
  await ctx.db.patch("genieThreads", thread._id, {
    ...patch,
    status: "working",
    run,
    error: undefined,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.genieRun.run, {
    threadId: thread._id,
    run,
  });
}

export const threads = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const principal = await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("genieThreads")
      .withIndex("by_owner", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("owner", principalKey(principal))
      )
      .order("desc")
      .take(THREAD_LIST);
    return rows.map((row) => ({
      _id: row._id,
      title: row.title,
      status: row.status,
      updatedAt: row.updatedAt,
    }));
  },
});

export const thread = query({
  args: { threadId: v.id("genieThreads") },
  handler: async (ctx, args) => {
    const thread = await ownThread(ctx, args.threadId);
    if (!thread) return null;
    const items = await ctx.db
      .query("genieItems")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(ITEM_LIMIT);
    return {
      _id: thread._id,
      title: thread.title,
      status: thread.status,
      autoApprove: thread.autoApprove,
      error: thread.error ?? null,
      items: items.reverse().map((item) => ({
        _id: item._id,
        kind: item.kind,
        text: item.text,
        attachments: item.attachments ?? [],
        tool: item.tool ?? null,
        input: item.input ?? null,
        output: item.output ?? null,
        state: item.state ?? null,
        readOnly: item.readOnly ?? false,
        createdAt: item.createdAt,
      })),
    };
  },
});

export const send = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    threadId: v.optional(v.id("genieThreads")),
    text: v.string(),
    attachments: v.optional(v.array(genieAttachment)),
    autoApprove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const principal = await requireWorkspace(ctx, args.workspaceId);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new AuthError("Sign in to continue.");

    const text = args.text.trim().slice(0, MAX_TEXT);
    const attachments = (args.attachments ?? []).slice(0, MAX_ATTACHMENTS);
    if (!text && attachments.length === 0) {
      throw new ConvexError("Ask Genie something first.");
    }
    for (const file of attachments) {
      requireOwnKey(file.key, "knowledge", args.workspaceId);
    }

    let thread: Doc<"genieThreads">;
    if (args.threadId) {
      thread = await requireThread(ctx, args.threadId);
      if (thread.workspaceId !== args.workspaceId) {
        throw new ConvexError("That Genie chat belongs to another workspace.");
      }
      if (thread.status === "working") {
        throw new ConvexError("Genie is still working on your last request.");
      }
    } else {
      const now = Date.now();
      const title = (text || attachments[0]?.name || "New chat").replace(/\s+/g, " ");
      const id = await ctx.db.insert("genieThreads", {
        workspaceId: args.workspaceId,
        owner: principalKey(principal),
        subject: identity.subject,
        title: title.length > 60 ? `${title.slice(0, 59)}…` : title,
        status: "idle",
        autoApprove: args.autoApprove ?? false,
        run: 0,
        updatedAt: now,
      });
      thread = (await ctx.db.get("genieThreads", id))!;
    }

    const memory = await readMemory(ctx, thread._id);
    if (thread.status === "waiting") {
      const waiting = await pendingActions(ctx, thread._id);
      for (const item of waiting) {
        if (item.state === "pending") {
          await ctx.db.patch("genieItems", item._id, { state: "declined" });
          item.state = "declined";
        }
      }
      await answerApprovals(
        ctx,
        waiting,
        memory.messages,
        "The user moved on without approving this."
      );
    }

    const files = attachments.map(
      (file) => `- ${file.name} (${file.mime}) — fileKey: ${file.key}`
    );
    const body = files.length
      ? `${text}\n\nAttached files, already uploaded to the knowledge folder:\n${files.join("\n")}`
      : text;
    const images = attachments.filter((file) => file.mime.startsWith("image/"));
    memory.messages.push({
      role: "user",
      content: images.length
        ? [
            { type: "text", text: body },
            ...images.map((file) => ({
              type: "image",
              image: fileUrl(file.key),
              mediaType: file.mime,
            })),
          ]
        : body,
    });
    await writeMemory(ctx, thread._id, memory.row, memory.messages);

    await ctx.db.insert("genieItems", {
      threadId: thread._id,
      kind: "user",
      text,
      ...(attachments.length ? { attachments } : {}),
      createdAt: Date.now(),
    });

    await startRun(ctx, thread, { subject: identity.subject });
    return thread._id;
  },
});

export const decide = mutation({
  args: {
    threadId: v.id("genieThreads"),
    itemId: v.optional(v.id("genieItems")),
    approve: v.boolean(),
  },
  handler: async (ctx, args) => {
    const thread = await requireThread(ctx, args.threadId);
    if (thread.status !== "waiting") return null;

    const waiting = await pendingActions(ctx, thread._id);
    for (const item of waiting) {
      if (item.state !== "pending") continue;
      if (args.itemId && item._id !== args.itemId) continue;
      const state = args.approve ? ("approved" as const) : ("declined" as const);
      await ctx.db.patch("genieItems", item._id, { state });
      item.state = state;
    }
    if (waiting.some((item) => item.state === "pending")) return null;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new AuthError("Sign in to continue.");
    const memory = await readMemory(ctx, thread._id);
    await answerApprovals(ctx, waiting, memory.messages, "The user declined this.");
    await writeMemory(ctx, thread._id, memory.row, memory.messages);
    await startRun(ctx, thread, { subject: identity.subject });
    return null;
  },
});

export const stop = mutation({
  args: { threadId: v.id("genieThreads") },
  handler: async (ctx, args) => {
    const thread = await requireThread(ctx, args.threadId);
    if (thread.status !== "working" && thread.status !== "waiting") return null;

    const memory = await readMemory(ctx, thread._id);
    const waiting = await pendingActions(ctx, thread._id);
    for (const item of waiting) {
      if (item.state === "pending") item.state = "declined";
    }
    await answerApprovals(ctx, waiting, memory.messages, "The user stopped Genie.");
    await writeMemory(ctx, thread._id, memory.row, memory.messages);

    await ctx.db.patch("genieThreads", thread._id, {
      status: "idle",
      run: thread.run + 1,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const setAutoApprove = mutation({
  args: { threadId: v.id("genieThreads"), autoApprove: v.boolean() },
  handler: async (ctx, args) => {
    const thread = await requireThread(ctx, args.threadId);
    await ctx.db.patch("genieThreads", thread._id, { autoApprove: args.autoApprove });
    return null;
  },
});

export const remove = mutation({
  args: { threadId: v.id("genieThreads") },
  handler: async (ctx, args) => {
    const thread = await requireThread(ctx, args.threadId);
    const items = await ctx.db
      .query("genieItems")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .collect();
    for (const item of items) await ctx.db.delete("genieItems", item._id);
    const memory = await readMemory(ctx, thread._id);
    if (memory.row) await ctx.db.delete("genieMemory", memory.row._id);
    await ctx.db.delete("genieThreads", thread._id);
    return null;
  },
});

export const context = internalQuery({
  args: { threadId: v.id("genieThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("genieThreads", args.threadId);
    if (!thread) return null;
    const workspace = await ctx.db.get("workspaces", thread.workspaceId);
    if (!workspace) return null;
    const memory = await readMemory(ctx, thread._id);
    return {
      run: thread.run,
      subject: thread.subject,
      autoApprove: thread.autoApprove,
      messages: memory.row?.messages ?? "[]",
      workspace: {
        _id: workspace._id,
        slug: workspace.slug,
        name: workspace.name,
        ownerName: workspace.ownerName ?? null,
        timezone: workspace.timezone,
        currency: workspace.currency,
      },
    };
  },
});

const actionRow = v.object({
  toolCallId: v.string(),
  tool: v.string(),
  title: v.optional(v.string()),
  input: v.optional(v.string()),
  output: v.optional(v.string()),
  readOnly: v.optional(v.boolean()),
  state: v.optional(genieActionState),
  approvalId: v.optional(v.string()),
});

export const recordActions = internalMutation({
  args: {
    threadId: v.id("genieThreads"),
    run: v.number(),
    actions: v.array(actionRow),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("genieThreads", args.threadId);
    if (!thread || thread.run !== args.run) return null;

    for (const action of args.actions) {
      const existing = await ctx.db
        .query("genieItems")
        .withIndex("by_tool_call", (q) =>
          q.eq("threadId", thread._id).eq("toolCallId", action.toolCallId)
        )
        .first();
      const fields = {
        ...(action.input !== undefined ? { input: action.input } : {}),
        ...(action.output !== undefined ? { output: action.output } : {}),
        ...(action.state !== undefined ? { state: action.state } : {}),
        ...(action.approvalId !== undefined ? { approvalId: action.approvalId } : {}),
        ...(action.readOnly !== undefined ? { readOnly: action.readOnly } : {}),
      };
      if (existing) {
        // A declined call stays declined whatever the model reports back.
        if (existing.state === "declined") continue;
        await ctx.db.patch("genieItems", existing._id, fields);
      } else {
        await ctx.db.insert("genieItems", {
          threadId: thread._id,
          kind: "action",
          text: action.title ?? action.tool,
          tool: action.tool,
          toolCallId: action.toolCallId,
          ...fields,
          createdAt: Date.now(),
        });
      }
    }
    return null;
  },
});

export const finish = internalMutation({
  args: {
    threadId: v.id("genieThreads"),
    run: v.number(),
    messages: v.optional(v.string()),
    reply: v.optional(v.string()),
    status: genieStatus,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("genieThreads", args.threadId);
    if (!thread || thread.run !== args.run) return null;

    if (args.messages !== undefined) {
      const memory = await readMemory(ctx, thread._id);
      await writeMemory(ctx, thread._id, memory.row, JSON.parse(args.messages));
    }
    const recent = await ctx.db
      .query("genieItems")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(60);
    for (const item of recent) {
      if (item.state === "approved") {
        await ctx.db.patch("genieItems", item._id, { state: "failed" });
      }
    }
    if (args.reply) {
      await ctx.db.insert("genieItems", {
        threadId: thread._id,
        kind: "reply",
        text: args.reply,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch("genieThreads", thread._id, {
      status: args.status,
      error: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});
