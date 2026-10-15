import { ConvexError, v } from "convex/values";
import { internalAction, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOwner } from "./lib/auth";
import { insertConversation, patchConversation, searchTextFor } from "./lib/inbox";
import { normalisePhone } from "./lib/notifications";
import {
  listIn,
  normaliseBaseUrl,
  readChat,
  readMessage,
  type CrmChat,
  type CrmMessage,
} from "./lib/crm";

const CHATS_PER_PAGE = 25;
const MESSAGES_PER_PAGE = 50;
const MAX_MESSAGE_PAGES = 40;
const MAX_CHAT_PAGES = 4000;
const SAVE_CHUNK = 100;
const REQUEST_TIMEOUT_MS = 30_000;

const chatArg = v.object({ id: v.string(), phone: v.string(), name: v.optional(v.string()) });
const messageArg = v.object({ at: v.number(), fromCustomer: v.boolean(), text: v.string() });

function publicView(job: Doc<"crmImports">) {
  return {
    _id: job._id,
    channelId: job.channelId,
    baseUrl: job.baseUrl,
    status: job.status,
    chats: job.chats,
    messages: job.messages,
    skipped: job.skipped,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

async function latestJob(
  ctx: { db: QueryCtx["db"] },
  workspaceId: Id<"workspaces">
) {
  return await ctx.db
    .query("crmImports")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .first();
}

export const latest = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const job = await latestJob(ctx, args.workspaceId);
    return job ? publicView(job) : null;
  },
});

export const start = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    baseUrl: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel || channel.workspaceId !== args.workspaceId) {
      throw new ConvexError("That channel is not in this workspace.");
    }
    if (channel.type !== "whatsapp") {
      throw new ConvexError("Old chats can only be imported into a WhatsApp channel.");
    }
    const baseUrl = normaliseBaseUrl(args.baseUrl);
    if (!baseUrl) throw new ConvexError("Enter the CRM API URL, e.g. https://crm.example.com.");
    const apiKey = args.apiKey.trim();
    if (!apiKey) throw new ConvexError("Enter the CRM API key.");

    const running = await latestJob(ctx, args.workspaceId);
    if (running?.status === "running") throw new ConvexError("An import is already running.");

    const now = Date.now();
    const importId = await ctx.db.insert("crmImports", {
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      baseUrl,
      apiKey,
      status: "running",
      page: 1,
      chats: 0,
      messages: 0,
      skipped: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.crmImports.runPage, { importId });
    return importId;
  },
});

export const cancel = mutation({
  args: { importId: v.id("crmImports") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get("crmImports", args.importId);
    if (!job) return null;
    await requireOwner(ctx, job.workspaceId);
    if (job.status !== "running") return null;
    const now = Date.now();
    await ctx.db.patch("crmImports", job._id, {
      status: "cancelled",
      apiKey: undefined,
      updatedAt: now,
      finishedAt: now,
    });
    return null;
  },
});

export const job = internalQuery({
  args: { importId: v.id("crmImports") },
  handler: async (ctx, args) => await ctx.db.get("crmImports", args.importId),
});

async function findContact(
  ctx: { db: QueryCtx["db"] },
  workspaceId: Id<"workspaces">,
  digits: string
) {
  return await ctx.db
    .query("contacts")
    .withIndex("by_workspace_external", (q) =>
      q.eq("workspaceId", workspaceId).eq("externalId", digits)
    )
    .first();
}

async function findImported(
  ctx: { db: QueryCtx["db"] },
  workspaceId: Id<"workspaces">,
  chatId: string
) {
  return await ctx.db
    .query("crmImportedChats")
    .withIndex("by_workspace_chat", (q) => q.eq("workspaceId", workspaceId).eq("chatId", chatId))
    .unique();
}

/**
 * Whether a chat still has history to bring in, and from when. A thread that
 * already lives on the platform is left alone: the CRM sees the same number's
 * traffic, so what it holds from then on is already in the inbox.
 */
export const chatState = internalQuery({
  args: { importId: v.id("crmImports"), chatId: v.string(), phone: v.string() },
  handler: async (ctx, args): Promise<{ skip: true } | { skip: false; since: number }> => {
    const job = await ctx.db.get("crmImports", args.importId);
    const channel = job ? await ctx.db.get("channels", job.channelId) : null;
    const digits = normalisePhone(args.phone);
    if (!job || !channel || !digits) return { skip: true };

    const imported = await findImported(ctx, job.workspaceId, args.chatId);
    const thread = imported ? await ctx.db.get("conversations", imported.conversationId) : null;
    if (imported && thread) {
      return thread.lastMessageAt > imported.lastMessageAt
        ? { skip: true }
        : { skip: false, since: imported.lastMessageAt };
    }

    const contact = await findContact(ctx, job.workspaceId, digits);
    if (contact) {
      const existing = await ctx.db
        .query("conversations")
        .withIndex("by_contact_agent", (q) =>
          q.eq("contactId", contact._id).eq("agentId", channel.agentId)
        )
        .unique();
      if (existing) return { skip: true };
    }
    return { skip: false, since: 0 };
  },
});

/**
 * Writes one run of a chat's messages, oldest first. The thread lands closed
 * and already reviewed, so it neither fills Unread nor wakes the follow-up
 * desk, and its messages are history, not traffic: no daily stats, no usage.
 */
export const saveChunk = internalMutation({
  args: { importId: v.id("crmImports"), chat: chatArg, messages: v.array(messageArg) },
  handler: async (ctx, args): Promise<{ running: boolean }> => {
    const job = await ctx.db.get("crmImports", args.importId);
    if (!job || job.status !== "running") return { running: false };
    const channel = await ctx.db.get("channels", job.channelId);
    if (!channel) {
      await ctx.db.patch("crmImports", job._id, {
        status: "failed",
        error: "The WhatsApp channel was removed during the import.",
        apiKey: undefined,
        finishedAt: Date.now(),
      });
      return { running: false };
    }
    const digits = normalisePhone(args.chat.phone);
    const sorted = [...args.messages].sort((a, b) => a.at - b.at);
    if (!digits || sorted.length === 0) return { running: true };

    const now = Date.now();
    let contact = await findContact(ctx, job.workspaceId, digits);
    if (!contact) {
      const contactId = await ctx.db.insert("contacts", {
        workspaceId: job.workspaceId,
        externalId: digits,
        channelType: "whatsapp",
        name: args.chat.name,
        phone: digits,
        attributes: [],
        source: "import",
        lastSeenAt: now,
        createdAt: now,
      });
      contact = (await ctx.db.get("contacts", contactId))!;
    } else if (!contact.name && args.chat.name) {
      await ctx.db.patch("contacts", contact._id, { name: args.chat.name });
      contact = { ...contact, name: args.chat.name };
    }

    const imported = await findImported(ctx, job.workspaceId, args.chat.id);
    let thread = imported ? await ctx.db.get("conversations", imported.conversationId) : null;
    let since = imported?.lastMessageAt ?? 0;

    if (thread && imported && thread.lastMessageAt > imported.lastMessageAt) {
      return { running: true };
    }
    if (!thread) {
      const contactId = contact._id;
      const existing = await ctx.db
        .query("conversations")
        .withIndex("by_contact_agent", (q) =>
          q.eq("contactId", contactId).eq("agentId", channel.agentId)
        )
        .unique();
      if (existing) return { running: true };

      const first = sorted[0].at;
      const conversationId = await insertConversation(ctx, {
        workspaceId: job.workspaceId,
        agentId: channel.agentId,
        activeAgentId: channel.agentId,
        handoffCount: 0,
        contactId,
        channelId: channel._id,
        channelType: "whatsapp",
        status: "closed",
        messageCount: 0,
        lastMessageAt: first,
        reviewedAt: first,
        importedAt: now,
        createdAt: first,
      });
      thread = (await ctx.db.get("conversations", conversationId))!;
      since = 0;
      if (imported) {
        await ctx.db.patch("crmImportedChats", imported._id, { conversationId, lastMessageAt: 0 });
      } else {
        await ctx.db.insert("crmImportedChats", {
          workspaceId: job.workspaceId,
          chatId: args.chat.id,
          conversationId,
          lastMessageAt: 0,
        });
      }
    }

    const fresh = sorted.filter((message) => message.at > since);
    if (fresh.length === 0) return { running: true };
    for (const message of fresh) {
      await ctx.db.insert("messages", {
        workspaceId: job.workspaceId,
        conversationId: thread._id,
        role: message.fromCustomer ? "user" : "assistant",
        kind: "text",
        text: message.text,
        createdAt: message.at,
      });
    }

    const last = fresh[fresh.length - 1];
    const preview = last.text.slice(0, 140);
    await patchConversation(ctx, thread, {
      messageCount: thread.messageCount + fresh.length,
      lastMessageAt: last.at,
      lastMessagePreview: preview,
      lastMessageRole: last.fromCustomer ? "user" : "assistant",
      lastMessageFrom: last.fromCustomer ? "customer" : "team",
      lastMessageSender: undefined,
      unreadCount: 0,
      reviewedAt: last.at,
      searchText: searchTextFor(contact, preview),
    });
    const mapping = await findImported(ctx, job.workspaceId, args.chat.id);
    if (mapping) await ctx.db.patch("crmImportedChats", mapping._id, { lastMessageAt: last.at });
    await ctx.db.patch("crmImports", job._id, {
      messages: job.messages + fresh.length,
      updatedAt: now,
    });
    return { running: true };
  },
});

export const advance = internalMutation({
  args: {
    importId: v.id("crmImports"),
    chats: v.number(),
    skipped: v.number(),
    done: v.boolean(),
    error: v.optional(v.string()),
    firstChatId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const job = await ctx.db.get("crmImports", args.importId);
    if (!job || job.status !== "running") return false;
    const now = Date.now();
    const finished = args.done || !!args.error;
    await ctx.db.patch("crmImports", job._id, {
      page: job.page + 1,
      lastFirstChatId: args.firstChatId,
      chats: job.chats + args.chats,
      skipped: job.skipped + args.skipped,
      updatedAt: now,
      ...(finished
        ? {
            status: args.error ? ("failed" as const) : ("done" as const),
            error: args.error,
            apiKey: undefined,
            finishedAt: now,
          }
        : {}),
    });
    return !finished;
  },
});

async function crmGet(baseUrl: string, apiKey: string, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { "API-KEY": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach the CRM. Check the API URL.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("The CRM refused the API key.");
  }
  if (!response.ok) {
    throw new Error(`The CRM answered ${response.status} for ${path.split("?")[0]}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("The CRM did not answer with JSON. Check the API URL.");
  }
}

async function fetchMessages(
  job: Doc<"crmImports"> & { apiKey: string },
  chat: CrmChat,
  since: number
): Promise<CrmMessage[]> {
  const found = new Map<string, CrmMessage>();
  let previousFirst: string | undefined;
  for (let page = 1; page <= MAX_MESSAGE_PAGES; page++) {
    const body = await crmGet(
      job.baseUrl,
      job.apiKey,
      `/crm/chat/${encodeURIComponent(chat.id)}/messages?page=${page}&limit=${MESSAGES_PER_PAGE}&sort=newest`
    );
    const rows = listIn(body);
    if (rows.length === 0) break;
    const parsed = rows
      .map((row) => readMessage(row, chat.phone))
      .filter((message): message is CrmMessage => message !== null);
    const firstKey = parsed[0] ? `${parsed[0].id ?? ""}:${parsed[0].at}:${parsed[0].text}` : undefined;
    if (firstKey && firstKey === previousFirst) break;
    previousFirst = firstKey;
    for (const message of parsed) {
      if (message.at > since) found.set(message.id ?? `${message.at}:${message.text}`, message);
    }
    if (parsed.some((message) => message.at <= since)) break;
    if (rows.length < MESSAGES_PER_PAGE) break;
  }
  return [...found.values()].sort((a, b) => a.at - b.at);
}

export const runPage = internalAction({
  args: { importId: v.id("crmImports") },
  handler: async (ctx, args): Promise<null> => {
    const current: Doc<"crmImports"> | null = await ctx.runQuery(internal.crmImports.job, args);
    if (!current || current.status !== "running" || !current.apiKey) return null;
    const job = { ...current, apiKey: current.apiKey };

    const finish = async (fields: { chats?: number; skipped?: number; error?: string }) => {
      await ctx.runMutation(internal.crmImports.advance, {
        importId: args.importId,
        chats: fields.chats ?? 0,
        skipped: fields.skipped ?? 0,
        done: true,
        error: fields.error,
      });
      return null;
    };

    let rows;
    try {
      rows = listIn(
        await crmGet(job.baseUrl, job.apiKey, `/crm/chat?page=${job.page}&limit=${CHATS_PER_PAGE}`)
      );
    } catch (error) {
      return await finish({ error: error instanceof Error ? error.message : "The CRM request failed." });
    }
    if (rows.length === 0 || job.page > MAX_CHAT_PAGES) return await finish({});

    const chats = rows.map(readChat);
    if (job.page === 1 && chats.every((chat) => chat === null)) {
      return await finish({
        error: `Could not read the CRM's chats. The first one has: ${Object.keys(rows[0]).join(", ")}.`,
      });
    }
    const firstChatId = chats.find((chat) => chat !== null)?.id;
    if (firstChatId && firstChatId === current.lastFirstChatId) return await finish({});

    let imported = 0;
    let skipped = 0;
    for (const chat of chats) {
      if (!chat) {
        skipped++;
        continue;
      }
      const state = await ctx.runQuery(internal.crmImports.chatState, {
        importId: args.importId,
        chatId: chat.id,
        phone: chat.phone,
      });
      if (state.skip) {
        skipped++;
        continue;
      }
      let messages: CrmMessage[];
      try {
        messages = await fetchMessages(job, chat, state.since);
      } catch {
        skipped++;
        continue;
      }
      if (messages.length === 0) continue;
      const chatArgs = chat.name
        ? { id: chat.id, phone: chat.phone, name: chat.name }
        : { id: chat.id, phone: chat.phone };
      for (let i = 0; i < messages.length; i += SAVE_CHUNK) {
        const result = await ctx.runMutation(internal.crmImports.saveChunk, {
          importId: args.importId,
          chat: chatArgs,
          messages: messages.slice(i, i + SAVE_CHUNK).map(({ at, fromCustomer, text }) => ({
            at,
            fromCustomer,
            text,
          })),
        });
        if (!result.running) return null;
      }
      imported++;
    }

    const running: boolean = await ctx.runMutation(internal.crmImports.advance, {
      importId: args.importId,
      chats: imported,
      skipped,
      done: false,
      firstChatId,
    });
    if (running) await ctx.scheduler.runAfter(0, internal.crmImports.runPage, args);
    return null;
  },
});
