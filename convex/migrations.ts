// One-off data moves. Each is safe to run twice.
//
//   npx convex run migrations:ordersToRecords
//
// ---------------------------------------------------------------------------
// Orders → the Orders record book
//
// Orders stopped being their own thing: every workspace now keeps them in an
// ordinary record book (see convex/lib/ordersBook.ts). This moves what was
// there before, per workspace:
//
// - creates the book;
// - copies every order into it, the order number becoming the reference, so a
//   customer quoting an old number is still found by find_order;
// - takes create_order and lookup_orders off every agent that had them and
//   switches the book on for it instead, so nobody stops taking orders;
// - turns "New order" alerts into "Record filed" alerts on the book, with
//   their placeholders rewritten to the record's paths.
//
// The old `orders` rows are left where they are. Nothing reads them now, and
// deleting data is not something a migration should do on the way past.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { buildSearchBlob } from "./lib/shared";
import { REPLY_PREVIEW_CHARS } from "./lib/agentStats";
import { dayKey } from "./lib/dailyStats";
import { addToUsageDaily } from "./lib/usageDaily";
import {
  deliveryText,
  ensureOrdersBook,
  findOrdersBook,
  itemsText,
  stageForStatus,
} from "./lib/ordersBook";
import { bestHourOf } from "./lib/contactActivity";
import { zonedParts } from "./lib/marketing";
import { loginEmailOf, loginEmailTaken } from "./authDb";
import { claimSerial } from "./records";
import { ensureOwnerMember } from "./team";
import { newFileKey, r2, type FileFolder } from "./lib/files";
import { MEMBER_SCOPES } from "./lib/auth";
import { templateAsShown } from "./marketing";

const WORKSPACE_BATCH = 20;
const ORDER_BATCH = 100;

const RETIRED_TOOLS = new Set(["create_order", "lookup_orders"]);

export const ordersToRecords = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });

    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.ordersToRecordsForWorkspace,
        { workspaceId: workspace._id, cursor: null }
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.ordersToRecords, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

export const ordersToRecordsForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return;

    const bookId = await ensureOrdersBook(ctx, workspace._id);
    const book = await ctx.db.get("recordBooks", bookId);
    if (!book) return;

    // Agents and alerts are a handful of rows, so the first batch does them.
    if (args.cursor === null) {
      await moveAgents(ctx, workspace._id, bookId);
      await moveAlerts(ctx, workspace, bookId);
    }

    // Oldest first, so the records land in the order the orders were placed.
    const page = await ctx.db
      .query("orders")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .paginate({ numItems: ORDER_BATCH, cursor: args.cursor });
    for (const order of page.page) await copyOrder(ctx, book, order);

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.ordersToRecordsForWorkspace,
        { workspaceId: workspace._id, cursor: page.continueCursor }
      );
    }
  },
});

async function copyOrder(
  ctx: MutationCtx,
  book: Doc<"recordBooks">,
  order: Doc<"orders">
) {
  const already = await ctx.db
    .query("records")
    .withIndex("by_workspace_reference", (q) =>
      q.eq("workspaceId", order.workspaceId).eq("reference", order.orderNumber)
    )
    .first();
  if (already) return;

  const delivery = deliveryText(order.delivery);
  const values = [
    { key: "items", value: itemsText(order.items) },
    ...(delivery ? [{ key: "delivery", value: delivery }] : []),
    ...(order.total !== undefined
      ? [{ key: "total", value: String(order.total) }]
      : []),
  ].filter((pair) => pair.value.trim());

  const person = {
    name: order.customer.name,
    phone: order.customer.phone,
    email: order.customer.email,
    company: order.customer.company,
  };

  await ctx.db.insert("records", {
    workspaceId: order.workspaceId,
    bookId: book._id,
    reference: order.orderNumber,
    serialNumber: await claimSerial(ctx, book._id),
    agentId: order.agentId,
    conversationId: order.conversationId,
    contactId: order.contactId,
    person,
    values,
    stage: stageForStatus(order.status, book.stages),
    notes: order.notes,
    source: order.source,
    searchBlob: buildSearchBlob([
      order.orderNumber,
      person.name,
      person.phone,
      person.email,
      person.company,
      ...values.map((pair) => pair.value),
    ]),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
}

async function moveAgents(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  bookId: Id<"recordBooks">
) {
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  for (const agent of agents) {
    if (!agent.builtinTools.some((key) => RETIRED_TOOLS.has(key))) continue;
    const books = agent.recordBooks ?? [];
    await ctx.db.patch(agent._id, {
      builtinTools: agent.builtinTools.filter((key) => !RETIRED_TOOLS.has(key)),
      recordBooks: books.includes(bookId) ? books : [...books, bookId],
      updatedAt: Date.now(),
    });
  }
}

/**
 * Where each path an order alert could use lives on a filed record. Anything
 * not here — `contact.*`, `workspace.*` — is the same on both events.
 */
const ORDER_TO_RECORD_PATHS: Record<string, string> = {
  orderNumber: "record.reference",
  "customer.name": "record.person.name",
  "customer.phone": "record.person.phone",
  "customer.email": "record.person.email",
  "customer.company": "record.person.company",
  itemsSummary: "record.details.items",
  items: "record.details.items",
  total: "record.details.total",
  status: "record.stage",
  notes: "record.notes",
  "delivery.address": "record.details.delivery",
  "delivery.requiredDate": "record.details.delivery",
};

/** Rewrites each `{{a | b | "c"}}` alternative that names an order path. */
function rewritePlaceholders(text: string, currency: string): string {
  return text.replace(/\{\{([^}]*)\}\}/g, (_, expression: string) => {
    const options = expression.split("|").map((raw) => {
      const option = raw.trim();
      if (/^".*"$|^'.*'$/.test(option)) return option;
      // A record carries no currency; the workspace's own is what an order
      // was priced in.
      if (option === "currency") return `"${currency}"`;
      return ORDER_TO_RECORD_PATHS[option] ?? option;
    });
    return `{{${options.join(" | ")}}}`;
  });
}

async function moveAlerts(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  bookId: Id<"recordBooks">
) {
  const rules = await ctx.db
    .query("notificationRules")
    .withIndex("by_workspace_event", (q) =>
      q.eq("workspaceId", workspace._id).eq("event", "order_created")
    )
    .collect();

  for (const rule of rules) {
    await ctx.db.patch(rule._id, {
      event: "record_filed",
      bookId,
      params: rule.params.map((pair) => ({
        key: pair.key,
        value: rewritePlaceholders(pair.value, workspace.currency),
      })),
      recipients: rule.recipients.map((recipient) =>
        rewritePlaceholders(recipient, workspace.currency)
      ),
      updatedAt: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Reply stats
//
//   npx convex run migrations:backfillReplyStats
//
// Fills agentStats and each team member's last reply from the messages already
// there. Only messages from before the run are counted, so replies arriving
// meanwhile, which count themselves, are not counted twice.
// ---------------------------------------------------------------------------

const STATS_MESSAGE_BATCH = 100;

export const backfillReplyStats = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });

    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillReplyStatsForWorkspace,
        { workspaceId: workspace._id, cursor: null }
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillReplyStats, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

export const backfillReplyStatsForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    startedAt: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const startedAt = args.startedAt ?? Date.now();
    if (args.cursor === null) {
      const stale = await ctx.db
        .query("agentStats")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);
    }

    const page = await ctx.db
      .query("messages")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", args.workspaceId).lt("_creationTime", startedAt)
      )
      .paginate({ numItems: STATS_MESSAGE_BATCH, cursor: args.cursor });

    type Delta = {
      replies: number;
      latencyTotalMs: number;
      latencyCount: number;
      last?: { text: string; at: number };
    };
    const agents = new Map<Id<"agents">, Delta>();
    const members = new Map<Id<"teamMembers">, { text: string; at: number }>();

    for (const message of page.page) {
      const text = message.text?.trim();
      if (message.sentByHuman) {
        if (message.teamMemberId && text) {
          members.set(message.teamMemberId, {
            text: text.slice(0, REPLY_PREVIEW_CHARS),
            at: message.createdAt,
          });
        }
        continue;
      }
      if (!message.agentId || message.role !== "assistant") continue;
      if (message.kind !== "text" && message.kind !== "rich") continue;

      const delta = agents.get(message.agentId) ?? {
        replies: 0,
        latencyTotalMs: 0,
        latencyCount: 0,
      };
      delta.replies += 1;
      if (typeof message.latencyMs === "number") {
        delta.latencyTotalMs += message.latencyMs;
        delta.latencyCount += 1;
      }
      if (message.kind === "text" && text) {
        delta.last = { text: text.slice(0, REPLY_PREVIEW_CHARS), at: message.createdAt };
      }
      agents.set(message.agentId, delta);
    }

    for (const [agentId, delta] of agents) {
      if (!(await ctx.db.get("agents", agentId))) continue;
      const stats = await ctx.db
        .query("agentStats")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .unique();
      const newer = (at?: number) => delta.last && delta.last.at >= (at ?? 0);
      if (!stats) {
        await ctx.db.insert("agentStats", {
          workspaceId: args.workspaceId,
          agentId,
          replies: delta.replies,
          latencyTotalMs: delta.latencyTotalMs,
          latencyCount: delta.latencyCount,
          lastReplyText: delta.last?.text,
          lastReplyAt: delta.last?.at,
        });
        continue;
      }
      await ctx.db.patch(stats._id, {
        replies: stats.replies + delta.replies,
        latencyTotalMs: stats.latencyTotalMs + delta.latencyTotalMs,
        latencyCount: stats.latencyCount + delta.latencyCount,
        ...(newer(stats.lastReplyAt)
          ? { lastReplyText: delta.last!.text, lastReplyAt: delta.last!.at }
          : {}),
      });
    }

    for (const [memberId, last] of members) {
      const member = await ctx.db.get("teamMembers", memberId);
      if (!member || last.at < (member.lastReplyAt ?? 0)) continue;
      await ctx.db.patch(memberId, { lastReplyText: last.text, lastReplyAt: last.at });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillReplyStatsForWorkspace,
        { workspaceId: args.workspaceId, startedAt, cursor: page.continueCursor }
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Daily message totals
//
//   npx convex run migrations:backfillDailyStats
//
// Fills dailyStats from the messages already there, with the same cut-off as
// backfillReplyStats so a message is counted once.
// ---------------------------------------------------------------------------

export const backfillDailyStats = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });
    for (const workspace of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillDailyStatsForWorkspace,
        { workspaceId: workspace._id, cursor: null }
      );
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillDailyStats, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

export const backfillDailyStatsForWorkspace = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    startedAt: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const startedAt = args.startedAt ?? Date.now();
    if (args.cursor === null) {
      const stale = await ctx.db
        .query("dailyStats")
        .withIndex("by_workspace_day", (q) => q.eq("workspaceId", args.workspaceId))
        .collect();
      for (const row of stale) await ctx.db.delete(row._id);
    }

    const page = await ctx.db
      .query("messages")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", args.workspaceId).lt("_creationTime", startedAt)
      )
      .paginate({ numItems: STATS_MESSAGE_BATCH, cursor: args.cursor });

    const days = new Map<
      string,
      { messages: number; latencyTotalMs: number; latencyCount: number }
    >();
    for (const message of page.page) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      if (message.kind !== "text" && message.kind !== "rich") continue;
      const day = dayKey(message.createdAt);
      const delta = days.get(day) ?? { messages: 0, latencyTotalMs: 0, latencyCount: 0 };
      delta.messages += 1;
      if (typeof message.latencyMs === "number") {
        delta.latencyTotalMs += message.latencyMs;
        delta.latencyCount += 1;
      }
      days.set(day, delta);
    }

    for (const [day, delta] of days) {
      const row = await ctx.db
        .query("dailyStats")
        .withIndex("by_workspace_day", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("day", day)
        )
        .unique();
      if (!row) {
        await ctx.db.insert("dailyStats", { workspaceId: args.workspaceId, day, ...delta });
        continue;
      }
      await ctx.db.patch(row._id, {
        messages: row.messages + delta.messages,
        latencyTotalMs: row.latencyTotalMs + delta.latencyTotalMs,
        latencyCount: row.latencyCount + delta.latencyCount,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillDailyStatsForWorkspace,
        { workspaceId: args.workspaceId, startedAt, cursor: page.continueCursor }
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Daily usage rollup
//
//   npx convex run migrations:backfillUsageDaily
//
// Rebuilds usageDaily from usageEvents. The clear and the cut-off happen in
// the same mutation, so an event recorded meanwhile is counted once.
// ---------------------------------------------------------------------------

const USAGE_BATCH = 500;

export const backfillUsageDaily = internalMutation({
  args: {
    startedAt: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    let startedAt = args.startedAt;
    if (startedAt === undefined) {
      for (const row of await ctx.db.query("usageDaily").collect()) {
        await ctx.db.delete(row._id);
      }
      startedAt = Date.now();
    }

    const page = await ctx.db
      .query("usageEvents")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", startedAt))
      .paginate({ numItems: USAGE_BATCH, cursor: args.cursor ?? null });
    for (const event of page.page) await addToUsageDaily(ctx, event);

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillUsageDaily, {
        startedAt,
        cursor: page.continueCursor,
      });
    }
    return { events: page.page.length, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// The admin on the roster
//
//   bunx convex run migrations:ownerMembers
//
// Gives every workspace the admin's own human-agent card, which takes the
// first human seat on its plan.
// ---------------------------------------------------------------------------

export const ownerMembers = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });

    for (const workspace of page.page) await ensureOwnerMember(ctx, workspace);

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.ownerMembers, {
        cursor: page.continueCursor,
      });
    }
    return { workspaces: page.page.length, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Human agents' login emails
//
//   bunx convex run migrations:memberLoginEmails
//
// Gives each human agent's login the email on their roster entry, so it signs
// in with that as well as the username. An email that is not valid, or already
// belongs to another login, is left off.
// ---------------------------------------------------------------------------

const LOGIN_BATCH = 100;

export const memberLoginEmails = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("memberCredentials")
      .paginate({ numItems: LOGIN_BATCH, cursor: args.cursor ?? null });

    let filled = 0;
    const clashes: string[] = [];
    for (const login of page.page) {
      if (login.email) continue;
      const member = await ctx.db.get("teamMembers", login.memberId);
      const email = loginEmailOf(member?.email);
      if (!email) continue;
      if (await loginEmailTaken(ctx, email, login._id)) {
        clashes.push(login.username);
        continue;
      }
      await ctx.db.patch(login._id, { email });
      filled++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.memberLoginEmails, {
        cursor: page.continueCursor,
      });
    }
    return { filled, clashes, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Convex storage → R2
//
//   npx convex run migrations:storageToR2
//   npx convex run migrations:sweepStorage
//
// Copies every uploaded file a row points at into R2, moves the row onto the
// key and deletes the Convex copy. The sweep then deletes what is left in
// Convex storage, which nothing points at, and refuses while anything does.
// ---------------------------------------------------------------------------

const FILE_BATCH = 25;

const LEGACY_TABLES = [
  "workspaces",
  "teamMembers",
  "knowledgeSources",
  "products",
] as const;
type LegacyTable = (typeof LEGACY_TABLES)[number];
const legacyTable = v.union(
  v.literal("workspaces"),
  v.literal("teamMembers"),
  v.literal("knowledgeSources"),
  v.literal("products")
);

const FOLDER: Record<LegacyTable, FileFolder> = {
  workspaces: "logos",
  teamMembers: "team",
  knowledgeSources: "knowledge",
  products: "products",
};

type LegacyFile = {
  rowId: string;
  workspaceId: Id<"workspaces">;
  storageId: Id<"_storage">;
};
type LegacyPage = { files: LegacyFile[]; cursor: string; isDone: boolean };

async function legacyPage(
  ctx: QueryCtx,
  table: LegacyTable,
  cursor: string | null
): Promise<LegacyPage> {
  const opts = { numItems: FILE_BATCH, cursor };
  const files: LegacyFile[] = [];
  const add = (
    rowId: string,
    workspaceId: Id<"workspaces">,
    storageId: Id<"_storage"> | undefined
  ) => {
    if (storageId) files.push({ rowId, workspaceId, storageId });
  };

  switch (table) {
    case "workspaces": {
      const page = await ctx.db.query("workspaces").paginate(opts);
      for (const row of page.page) add(row._id, row._id, row.logoStorageId);
      return { files, cursor: page.continueCursor, isDone: page.isDone };
    }
    case "teamMembers": {
      const page = await ctx.db.query("teamMembers").paginate(opts);
      for (const row of page.page) add(row._id, row.workspaceId, row.photoStorageId);
      return { files, cursor: page.continueCursor, isDone: page.isDone };
    }
    case "knowledgeSources": {
      const page = await ctx.db.query("knowledgeSources").paginate(opts);
      for (const row of page.page) add(row._id, row.workspaceId, row.storageId);
      return { files, cursor: page.continueCursor, isDone: page.isDone };
    }
    case "products": {
      const page = await ctx.db.query("products").paginate(opts);
      for (const row of page.page) {
        for (const image of row.images ?? []) {
          add(row._id, row.workspaceId, image.storageId);
        }
      }
      return { files, cursor: page.continueCursor, isDone: page.isDone };
    }
  }
}

export const legacyFilesPage = internalQuery({
  args: { table: legacyTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<LegacyPage> =>
    await legacyPage(ctx, args.table, args.cursor),
});

async function moveRowToKey(
  ctx: MutationCtx,
  table: LegacyTable,
  rowId: string,
  storageId: Id<"_storage">,
  key: string | undefined
): Promise<boolean> {
  switch (table) {
    case "workspaces": {
      const id = ctx.db.normalizeId("workspaces", rowId);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.logoStorageId !== storageId) return false;
      await ctx.db.patch(row._id, { logoKey: key, logoStorageId: undefined });
      return true;
    }
    case "teamMembers": {
      const id = ctx.db.normalizeId("teamMembers", rowId);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.photoStorageId !== storageId) return false;
      await ctx.db.patch(row._id, { photoKey: key, photoStorageId: undefined });
      return true;
    }
    case "knowledgeSources": {
      const id = ctx.db.normalizeId("knowledgeSources", rowId);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.storageId !== storageId) return false;
      await ctx.db.patch(row._id, { fileKey: key, storageId: undefined });
      return true;
    }
    case "products": {
      const id = ctx.db.normalizeId("products", rowId);
      const row = id ? await ctx.db.get(id) : null;
      const images = row?.images ?? [];
      if (!row || !images.some((image) => image.storageId === storageId)) {
        return false;
      }
      await ctx.db.patch(row._id, {
        images: images.flatMap((image) => {
          if (image.storageId !== storageId) return [image];
          return key ? [{ ...image, storageId: undefined, fileKey: key }] : [];
        }),
      });
      return true;
    }
  }
}

export const adoptFile = internalMutation({
  args: {
    table: legacyTable,
    rowId: v.string(),
    storageId: v.id("_storage"),
    key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const moved = await moveRowToKey(
      ctx,
      args.table,
      args.rowId,
      args.storageId,
      args.key
    );
    if (!moved && args.key) await r2.deleteObject(ctx, args.key);
    await ctx.storage.delete(args.storageId).catch(() => undefined);
  },
});

export const storageToR2 = internalAction({
  args: {
    table: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<null> => {
    const index = args.table ?? 0;
    const table = LEGACY_TABLES[index];
    if (!table) {
      console.log("[storageToR2] done");
      return null;
    }

    const page: LegacyPage = await ctx.runQuery(
      internal.migrations.legacyFilesPage,
      { table, cursor: args.cursor ?? null }
    );
    for (const file of page.files) {
      const blob = await ctx.storage.get(file.storageId);
      const key = blob
        ? await r2.store(ctx, blob, {
            key: newFileKey(FOLDER[table], file.workspaceId),
            type: blob.type || undefined,
          })
        : undefined;
      await ctx.runMutation(internal.migrations.adoptFile, {
        table,
        rowId: file.rowId,
        storageId: file.storageId,
        key,
      });
    }
    console.log(`[storageToR2] ${table}: moved ${page.files.length}`);

    await ctx.scheduler.runAfter(
      0,
      internal.migrations.storageToR2,
      page.isDone
        ? { table: index + 1, cursor: null }
        : { table: index, cursor: page.cursor }
    );
    return null;
  },
});

type StoragePage = { count: number; bytes: number; cursor: string; isDone: boolean };

export const storagePage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), dryRun: v.boolean() },
  handler: async (ctx, args): Promise<StoragePage> => {
    const page = await ctx.db.system
      .query("_storage")
      .paginate({ numItems: 100, cursor: args.cursor });
    if (!args.dryRun) {
      for (const file of page.page) await ctx.storage.delete(file._id);
    }
    return {
      count: page.page.length,
      bytes: page.page.reduce((sum, file) => sum + file.size, 0),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const sweepStorage = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ files: number; bytes: number }> => {
    const dryRun = args.dryRun ?? false;
    for (const table of dryRun ? [] : LEGACY_TABLES) {
      let cursor: string | null = null;
      for (;;) {
        const page: LegacyPage = await ctx.runQuery(
          internal.migrations.legacyFilesPage,
          { table, cursor }
        );
        if (page.files.length) {
          throw new Error(
            `${table} still points at Convex storage; run storageToR2 first`
          );
        }
        if (page.isDone) break;
        cursor = page.cursor;
      }
    }

    let files = 0;
    let bytes = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: StoragePage = await ctx.runMutation(
        internal.migrations.storagePage,
        { cursor: dryRun ? cursor : null, dryRun }
      );
      files += page.count;
      bytes += page.bytes;
      if (page.isDone) break;
      cursor = page.cursor;
    }
    return { files, bytes };
  },
});

// ---------------------------------------------------------------------------
// Record serial numbers
//
//   npx convex run migrations:recordSerials
//
// Numbers each book's records from 1 in the order they were filed, then
// starts the book's counter so new records carry on from there.
// ---------------------------------------------------------------------------

const BOOK_BATCH = 50;
const SERIAL_BATCH = 200;

export const recordSerials = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("recordBooks")
      .paginate({ numItems: BOOK_BATCH, cursor: args.cursor ?? null });

    for (const book of page.page) {
      if (book.lastSerial !== undefined) continue;
      await ctx.scheduler.runAfter(0, internal.migrations.recordSerialsForBook, {
        bookId: book._id,
        cursor: null,
        serial: 0,
        count: 0,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.recordSerials, {
        cursor: page.continueCursor,
      });
    }
  },
});

export const recordSerialsForBook = internalMutation({
  args: {
    bookId: v.id("recordBooks"),
    cursor: v.union(v.string(), v.null()),
    serial: v.number(),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const book = await ctx.db.get("recordBooks", args.bookId);
    if (!book || book.lastSerial !== undefined) return;

    const page = await ctx.db
      .query("records")
      .withIndex("by_book", (q) => q.eq("bookId", args.bookId))
      .paginate({ numItems: SERIAL_BATCH, cursor: args.cursor });

    let serial = args.serial;
    for (const record of page.page) {
      serial = record.serialNumber ?? serial + 1;
      if (record.serialNumber === undefined) {
        await ctx.db.patch(record._id, { serialNumber: serial });
      }
    }
    const count = args.count + page.page.length;

    // Same transaction as the last page read, so a record filed meanwhile
    // either lands in this page or sees the counter.
    if (page.isDone) {
      await ctx.db.patch(book._id, { lastSerial: serial, recordCount: count });
      return;
    }
    await ctx.scheduler.runAfter(0, internal.migrations.recordSerialsForBook, {
      bookId: args.bookId,
      cursor: page.continueCursor,
      serial,
      count,
    });
  },
});

// ---------------------------------------------------------------------------
// Contact activity, for the audience segments and best send time
//
//   npx convex run migrations:contactActivity
//
// Fills lastInboundAt, lastReadAt, lastRepliedAt, lastOrderAt, readHours and
// bestHour from history. Safe to run twice: it only ever moves a value later.
// ---------------------------------------------------------------------------

const ACTIVITY_BATCH = 50;

export const contactActivity = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("contacts")
      .paginate({ numItems: ACTIVITY_BATCH, cursor: args.cursor ?? null });
    const ordersBooks = new Map<Id<"workspaces">, Id<"recordBooks"> | null>();
    const zones = new Map<Id<"workspaces">, string>();

    for (const contact of page.page) {
      if (!ordersBooks.has(contact.workspaceId)) {
        const book = await findOrdersBook(ctx, contact.workspaceId);
        ordersBooks.set(contact.workspaceId, book?._id ?? null);
        const workspace = await ctx.db.get("workspaces", contact.workspaceId);
        zones.set(contact.workspaceId, workspace?.timezone ?? "UTC");
      }
      const patch: Partial<Doc<"contacts">> = {};

      const threads = await ctx.db
        .query("conversations")
        .withIndex("by_contact_agent", (q) => q.eq("contactId", contact._id))
        .take(20);
      if (threads.some((thread) => !thread.marketingOnly) && !contact.lastInboundAt) {
        patch.lastInboundAt = contact.lastSeenAt;
      }

      const sends = await ctx.db
        .query("marketingSends")
        .withIndex("by_contactId_and_createdAt", (q) => q.eq("contactId", contact._id))
        .order("desc")
        .take(50);
      const reads = sends
        .map((send) => send.readAt)
        .filter((at): at is number => at !== undefined)
        .sort((a, b) => a - b);
      const lastRead = reads.at(-1);
      if (lastRead && lastRead > (contact.lastReadAt ?? 0)) patch.lastReadAt = lastRead;
      const lastReply = Math.max(0, ...sends.map((send) => send.repliedAt ?? 0));
      if (lastReply > (contact.lastRepliedAt ?? 0)) patch.lastRepliedAt = lastReply;
      if (reads.length > 0 && !contact.readHours) {
        const zone = zones.get(contact.workspaceId)!;
        const readHours = reads.slice(-7).map((at) => zonedParts(at, zone).hour);
        patch.readHours = readHours;
        patch.bestHour = bestHourOf(readHours);
      }

      const ordersBookId = ordersBooks.get(contact.workspaceId);
      if (ordersBookId) {
        const records = await ctx.db
          .query("records")
          .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
          .take(100);
        const lastOrder = Math.max(
          0,
          ...records.filter((record) => record.bookId === ordersBookId).map((record) => record.createdAt)
        );
        if (lastOrder > (contact.lastOrderAt ?? 0)) patch.lastOrderAt = lastOrder;
      }

      if (Object.keys(patch).length > 0) await ctx.db.patch("contacts", contact._id, patch);
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.contactActivity, {
        cursor: page.continueCursor,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Workspace stages
//
//   bunx convex run migrations:workspaceStages
//
// Clears the retired stages (onboarding, setup complete, handed over), so
// those workspaces read as Account setup. Custom stages are kept.
// ---------------------------------------------------------------------------

const RETIRED_STAGES = new Set(["onboarding", "setup_complete", "handed_over"]);

export const workspaceStages = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("workspaces")
      .paginate({ numItems: WORKSPACE_BATCH, cursor: args.cursor ?? null });

    let cleared = 0;
    for (const workspace of page.page) {
      if (!workspace.stage || !RETIRED_STAGES.has(workspace.stage)) continue;
      await ctx.db.patch(workspace._id, { stage: undefined, stageLabel: undefined });
      cleared++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.workspaceStages, {
        cursor: page.continueCursor,
      });
    }
    return { cleared, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Platform roles
//
//   bunx convex run migrations:adminRoles
//
// Creates the Member role with what team members could open before roles
// existed, and puts every team member without a role on it.
// ---------------------------------------------------------------------------

export const adminRoles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("adminRoles")
      .withIndex("by_name", (q) => q.eq("name", "Member"))
      .first();
    const now = Date.now();
    const roleId =
      existing?._id ??
      (await ctx.db.insert("adminRoles", {
        name: "Member",
        description: "Only the workspaces assigned to them.",
        scopes: MEMBER_SCOPES,
        allWorkspaces: false,
        createdAt: now,
        updatedAt: now,
      }));

    let moved = 0;
    for (const admin of await ctx.db.query("admins").collect()) {
      if (admin.role !== "member" || admin.roleId) continue;
      await ctx.db.patch(admin._id, { roleId });
      moved++;
    }
    return { roleId, moved };
  },
});

// ---------------------------------------------------------------------------
// Record adds and deletes out of the activity log
//
//   npx convex run migrations:purgeRecordActivity
// ---------------------------------------------------------------------------

const ACTIVITY_LOG_BATCH = 500;

export const purgeRecordActivity = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("activityLogs")
      .paginate({ numItems: ACTIVITY_LOG_BATCH, cursor: args.cursor ?? null });

    let removed = 0;
    for (const row of page.page) {
      if (row.table !== "records" || row.operation === "update") continue;
      await ctx.db.delete(row._id);
      removed++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.purgeRecordActivity, {
        cursor: page.continueCursor,
      });
    }
    return { removed, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Website sign-ups, marked
//
//   bunx convex run migrations:signupSources
//
// Marks the workspaces that signed themselves up before `source` was kept. A
// sign-up makes its owner's login and the workspace in one transaction, so
// they share a creation time; a login the team adds comes later, by hand.
// ---------------------------------------------------------------------------

export const signupSources = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("users")
      .paginate({ numItems: LOGIN_BATCH, cursor: args.cursor ?? null });

    let marked = 0;
    for (const user of page.page) {
      if (user.createdBy || user.workspaceIds.length !== 1) continue;
      const workspace = await ctx.db.get("workspaces", user.workspaceIds[0]!);
      if (!workspace || workspace.source || Math.abs(workspace.createdAt - user.createdAt) > 1000) {
        continue;
      }
      await ctx.db.patch("workspaces", workspace._id, { source: "signup" });
      marked++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.signupSources, {
        cursor: page.continueCursor,
      });
    }
    return { marked, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Template sends, drawn as templates
//
//   bunx convex run migrations:templateMessages
//
// Marketing sends used to go into the inbox as their text alone, so the inbox
// could not show the header, footer or buttons the customer saw. This finds
// each one by matching its text against the workspace's templates and stores
// the template beside it.
// ---------------------------------------------------------------------------

const MESSAGE_BATCH = 200;
/** Less fixed text than this, and a template would match unrelated replies. */
const MIN_TEMPLATE_TEXT = 20;

function templatePattern(body: string): RegExp | null {
  const pieces = body.trim().split(/\{\{\s*(?:name|business|event|date|venue|message)\s*\}\}/);
  if (pieces.join("").replace(/\s+/g, "").length < MIN_TEMPLATE_TEXT) return null;
  const literal = (piece: string) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${pieces.map(literal).join("[\\s\\S]*?")}$`);
}

export const templateMessages = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("messages")
      .paginate({ numItems: MESSAGE_BATCH, cursor: args.cursor ?? null });

    const known = new Map<Id<"workspaces">, Array<{ pattern: RegExp; shown: object }>>();
    let converted = 0;
    for (const message of page.page) {
      if (message.role !== "assistant" || message.kind !== "text" || !message.text) continue;
      let templates = known.get(message.workspaceId);
      if (!templates) {
        const rows = await ctx.db
          .query("marketingTemplates")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", message.workspaceId))
          .take(200);
        templates = rows.flatMap((row) => {
          const pattern = templatePattern(row.body);
          const shown = templateAsShown(row);
          return pattern && shown ? [{ pattern, shown }] : [];
        });
        known.set(message.workspaceId, templates);
      }
      const match = templates.find((template) => template.pattern.test(message.text!.trim()));
      if (!match) continue;
      await ctx.db.patch("messages", message._id, {
        kind: "rich",
        payload: JSON.stringify({ ...match.shown, preview: message.text }),
      });
      converted++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.templateMessages, {
        cursor: page.continueCursor,
      });
    }
    return { converted, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Audience-only contacts
//
//   bunx convex run migrations:previewAudienceOnly
//   bunx convex run migrations:audienceOnlyContacts
//
// People brought in by an import or by hand who have never written in stay
// off the Contacts page until they do. Safe to run twice.
// ---------------------------------------------------------------------------

async function audienceOnlyCandidate(ctx: QueryCtx, contact: Doc<"contacts">): Promise<boolean> {
  if (contact.audienceOnly || contact.lastInboundAt || contact.lastRepliedAt) return false;
  if (contact.source !== "import" && contact.source !== "manual") return false;
  const threads = await ctx.db
    .query("conversations")
    .withIndex("by_contact_agent", (q) => q.eq("contactId", contact._id))
    .take(20);
  return threads.every((thread) => thread.marketingOnly);
}

export const audienceOnlyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contacts").paginate({ numItems: 200, cursor: args.cursor });
    const byWorkspace: Record<string, number> = {};
    for (const contact of page.page) {
      if (await audienceOnlyCandidate(ctx, contact)) {
        byWorkspace[contact.workspaceId] = (byWorkspace[contact.workspaceId] ?? 0) + 1;
      }
    }
    return { byWorkspace, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const previewAudienceOnly = internalAction({
  args: {},
  handler: async (ctx) => {
    const totals: Record<string, number> = {};
    let cursor: string | null = null;
    for (;;) {
      const page: { byWorkspace: Record<string, number>; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.migrations.audienceOnlyPage, { cursor });
      for (const [workspaceId, count] of Object.entries(page.byWorkspace)) {
        totals[workspaceId] = (totals[workspaceId] ?? 0) + count;
      }
      if (page.isDone) return totals;
      cursor = page.continueCursor;
    }
  },
});

export const audienceOnlyContacts = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contacts").paginate({ numItems: 100, cursor: args.cursor ?? null });
    for (const contact of page.page) {
      if (await audienceOnlyCandidate(ctx, contact)) {
        await ctx.db.patch("contacts", contact._id, { audienceOnly: true });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.audienceOnlyContacts, {
        cursor: page.continueCursor,
      });
    }
  },
});
