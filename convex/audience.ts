import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import {
  internalAction,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { deleteMessage } from "./lib/delivery";
import {
  categoryOf,
  isBuiltIn,
  knownCategories,
  measureAudience,
  normaliseTag,
  validityOf,
} from "./lib/audience";
import schema from "./schema";
import { audienceSelection } from "./schema/marketing";

const SIZE_SCAN_CAP = 5000;
const MAX_BULK = 500;
const PAGE_READ_BUDGET = 1000;

async function requireAudience(ctx: QueryCtx, audienceId: Id<"audiences">) {
  const audience = await ctx.db.get("audiences", audienceId);
  if (!audience) throw new ConvexError("Audience not found");
  await requireWorkspace(ctx, audience.workspaceId);
  return audience;
}

async function categoriesIn(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const settings = await ctx.db
    .query("marketingSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  return knownCategories(settings);
}

function placeOf(contact: Doc<"contacts">, known: Set<string>) {
  const category = categoryOf(contact, known);
  return { category, automatic: category !== contact.category };
}

function personOf(contact: Doc<"contacts">, known: Set<string>) {
  return {
    ...placeOf(contact, known),
    _id: contact._id,
    name: contact.name ?? null,
    phone: contact.externalId,
    email: contact.email ?? null,
    company: contact.company ?? null,
    birthday: contact.birthday ?? null,
    tags: contact.tags ?? [],
    source: contact.source ?? null,
    optedOutAt: contact.optedOutAt ?? null,
    createdAt: contact.createdAt,
  };
}

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("audiences")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(200);
    return rows;
  },
});

export const tags = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const known = await categoriesIn(ctx, args.workspaceId);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(SIZE_SCAN_CAP);
    const counts = new Map<string, number>();
    const categories = new Map<string, number>();
    for (const contact of contacts) {
      if (contact.channelType !== "whatsapp") continue;
      for (const tag of contact.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      const { category } = placeOf(contact, known);
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
    return {
      tags: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([tag, count]) => ({ tag, count })),
      categories: Object.fromEntries(categories),
      capped: contacts.length >= SIZE_SCAN_CAP,
    };
  },
});

export const people = query({
  args: {
    workspaceId: v.id("workspaces"),
    audienceId: v.optional(v.id("audiences")),
    category: v.optional(v.string()),
    tag: v.optional(v.string()),
    subscription: v.optional(v.union(v.literal("subscribed"), v.literal("unsubscribed"))),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const known = await categoriesIn(ctx, args.workspaceId);
    const needle = args.search?.trim().toLowerCase() ?? "";
    const digits = /^[\d\s()+.-]+$/.test(needle) ? needle.replace(/\D/g, "").replace(/^0+/, "") : "";
    const keep = (contact: Doc<"contacts"> | null): contact is Doc<"contacts"> => {
      if (!contact || contact.workspaceId !== args.workspaceId) return false;
      if (contact.channelType !== "whatsapp") return false;
      if (args.category !== undefined && placeOf(contact, known).category !== args.category) return false;
      if (args.tag && !(contact.tags ?? []).includes(args.tag)) return false;
      if (args.subscription === "subscribed" && contact.optedOutAt) return false;
      if (args.subscription === "unsubscribed" && !contact.optedOutAt) return false;
      if (needle) {
        const inText = [contact.name, contact.company, contact.email].some((field) =>
          field?.toLowerCase().includes(needle)
        );
        const inNumber =
          digits !== "" &&
          [contact.externalId, contact.phone].some((field) => field?.replace(/\D/g, "").includes(digits));
        if (!inText && !inNumber) return false;
      }
      return true;
    };
    const opts = {
      ...args.paginationOpts,
      maximumRowsRead: args.paginationOpts.maximumRowsRead ?? PAGE_READ_BUDGET,
    };
    const db = stream(ctx.db, schema);

    if (args.audienceId) {
      const audienceId = args.audienceId;
      const audience = await ctx.db.get("audiences", audienceId);
      // A list deleted while it is on screen reads as empty until the view moves off it.
      if (!audience) return { page: [], isDone: true, continueCursor: "" };
      if (audience.workspaceId !== args.workspaceId) throw new ConvexError("Audience not found");
      const result = await db
        .query("audienceMembers")
        .withIndex("by_audienceId_and_contactId", (q) => q.eq("audienceId", audienceId))
        .map(async (member) => {
          const contact = await ctx.db.get("contacts", member.contactId);
          return keep(contact) ? contact : null;
        })
        .paginate(opts);
      return { ...result, page: result.page.map((contact) => personOf(contact, known)) };
    }

    const category = args.category && known.has(args.category) ? args.category : undefined;
    const contacts = category
      ? db
          .query("contacts")
          .withIndex("by_workspace_and_category", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("category", category)
          )
          .order("desc")
      : db
          .query("contacts")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
          .order("desc");
    const result = await contacts.filterWith(async (contact) => keep(contact)).paginate(opts);
    return { ...result, page: result.page.map((contact) => personOf(contact, known)) };
  },
});

export const size = query({
  args: {
    workspaceId: v.id("workspaces"),
    audience: audienceSelection,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await measureAudience(ctx, args.workspaceId, args.audience, args.now);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    contactIds: v.optional(v.array(v.id("contacts"))),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new ConvexError("Give the audience a name.");
    if ((args.contactIds?.length ?? 0) > MAX_BULK) {
      throw new ConvexError(`Pick at most ${MAX_BULK} people.`);
    }
    const now = Date.now();
    const audienceId = await ctx.db.insert("audiences", {
      workspaceId: args.workspaceId,
      name,
      description: args.description?.trim().slice(0, 200) || undefined,
      source: "manual",
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (args.contactIds?.length) {
      await addMembers(ctx, audienceId, args.workspaceId, args.contactIds);
    }
    return audienceId;
  },
});

export const rename = mutation({
  args: {
    audienceId: v.id("audiences"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new ConvexError("Give the audience a name.");
    await ctx.db.patch("audiences", audience._id, {
      name,
      description: args.description?.trim().slice(0, 200) || undefined,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const remove = mutation({
  args: { audienceId: v.id("audiences"), withContacts: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    await ctx.db.delete("audiences", audience._id);
    await ctx.scheduler.runAfter(0, internal.audience.purgeMembers, {
      audienceId: audience._id,
      deleteContacts: args.withContacts || undefined,
    });
    return { success: true };
  },
});

type Keepers = {
  paid: Set<Id<"contacts">>;
  forms: Set<Id<"contacts">>;
  events: Id<"marketingCampaigns">[];
  rollouts: Id<"marketingEvents">[];
};

async function keepersIn(ctx: QueryCtx, workspaceId: Id<"workspaces">): Promise<Keepers> {
  const links = await ctx.db
    .query("paymentLinks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(2000);
  const forms = await ctx.db
    .query("formSubmissions")
    .withIndex("by_account", (q) => q.eq("workspaceId", workspaceId))
    .take(2000);
  const events = await ctx.db
    .query("marketingCampaigns")
    .withIndex("by_workspace_and_date", (q) => q.eq("workspaceId", workspaceId))
    .take(200);
  const sends = await ctx.db
    .query("marketingEvents")
    .withIndex("by_workspace_and_date", (q) => q.eq("workspaceId", workspaceId))
    .take(1000);
  return {
    paid: new Set(links.flatMap((link) => (link.contactId ? [link.contactId] : []))),
    forms: new Set(forms.flatMap((form) => (form.contactId ? [form.contactId] : []))),
    events: events.map((event) => event._id),
    rollouts: sends.flatMap((send) => (send.rollout ? [send._id] : [])),
  };
}

/** Why the contact has to stay, or null when nothing but this list and campaign messages ties them to the business. */
async function keepReason(
  ctx: QueryCtx,
  contact: Doc<"contacts">,
  audienceId: Id<"audiences">,
  keepers: Keepers
): Promise<string | null> {
  if (contact.lastInboundAt || contact.lastRepliedAt) return "messaged you";
  if (contact.lastOrderAt) return "ordered";
  if (keepers.paid.has(contact._id)) return "payment link";
  if (keepers.forms.has(contact._id)) return "form entry";
  const lists = await ctx.db
    .query("audienceMembers")
    .withIndex("by_contactId", (q) => q.eq("contactId", contact._id))
    .take(50);
  if (lists.some((row) => row.audienceId !== audienceId)) return "in another list";
  if (await ctx.db.query("orders").withIndex("by_contact", (q) => q.eq("contactId", contact._id)).first()) {
    return "ordered";
  }
  if (await ctx.db.query("records").withIndex("by_contact", (q) => q.eq("contactId", contact._id)).first()) {
    return "has a record";
  }
  for (const campaignId of keepers.events) {
    const guest = await ctx.db
      .query("eventGuests")
      .withIndex("by_campaignId_and_contactId", (q) => q.eq("campaignId", campaignId).eq("contactId", contact._id))
      .first();
    if (guest) return "event guest";
  }
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_contact_agent", (q) => q.eq("contactId", contact._id))
    .take(20);
  if (conversations.length === 20) return "long history";
  for (const conversation of conversations) {
    const conversationId = conversation._id;
    const inbound = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .filter((q) => q.eq(q.field("role"), "user"))
      .first();
    const linked = await ctx.db
      .query("appLinks")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .first();
    const paid = await ctx.db
      .query("paymentLinks")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .first();
    if (inbound) return "messaged you";
    if (linked) return "app link";
    if (paid) return "payment link";
  }
  return null;
}

async function deleteContact(ctx: MutationCtx, contactId: Id<"contacts">, keepers: Keepers) {
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_contact_agent", (q) => q.eq("contactId", contactId))
    .take(20);
  for (const conversation of conversations) {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .take(1000);
    for (const message of messages) await deleteMessage(ctx, message);
    await ctx.db.delete("conversations", conversation._id);
  }
  const sends = await ctx.db
    .query("marketingSends")
    .withIndex("by_contactId_and_createdAt", (q) => q.eq("contactId", contactId))
    .take(500);
  for (const send of sends) await ctx.db.delete("marketingSends", send._id);
  for (const eventId of keepers.rollouts) {
    const planned = await ctx.db
      .query("rolloutRecipients")
      .withIndex("by_eventId_and_contactId", (q) => q.eq("eventId", eventId).eq("contactId", contactId))
      .first();
    if (planned) await ctx.db.delete("rolloutRecipients", planned._id);
  }
  const lists = await ctx.db
    .query("audienceMembers")
    .withIndex("by_contactId", (q) => q.eq("contactId", contactId))
    .take(50);
  for (const list of lists) await ctx.db.delete("audienceMembers", list._id);
  await ctx.db.delete("contacts", contactId);
}

const PURGE_BATCH = 400;
const CONTACT_PURGE_BATCH = 40;

export const purgeMembers = internalMutation({
  args: { audienceId: v.id("audiences"), deleteContacts: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const limit = args.deleteContacts ? CONTACT_PURGE_BATCH : PURGE_BATCH;
    const rows = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audienceId_and_contactId", (q) => q.eq("audienceId", args.audienceId))
      .take(limit);
    const keepers = args.deleteContacts && rows.length > 0 ? await keepersIn(ctx, rows[0].workspaceId) : null;
    let handled = 0;
    for (const row of rows) {
      const contact = keepers ? await ctx.db.get("contacts", row.contactId) : null;
      if (contact && keepers && (await keepReason(ctx, contact, args.audienceId, keepers)) === null) {
        await deleteContact(ctx, contact._id, keepers);
      } else {
        await ctx.db.delete("audienceMembers", row._id);
      }
      handled++;
      if (keepers) {
        const metrics = await ctx.meta.getTransactionMetrics();
        if (metrics.documentsRead.remaining < 4000 || metrics.documentsWritten.remaining < 2000) break;
      }
    }
    if (rows.length === limit || handled < rows.length) {
      await ctx.scheduler.runAfter(0, internal.audience.purgeMembers, args);
    }
  },
});

// Lists deleted before "Delete list and contacts" existed: their memberships are gone, so the
// import that filled the list says who was in it.
async function deletedListImport(ctx: QueryCtx, importId: Id<"audienceImports">) {
  const importDoc = await ctx.db.get("audienceImports", importId);
  if (!importDoc?.audienceId || importDoc.mode === "recheck") throw new ConvexError("Not an import that made a list");
  if (await ctx.db.get("audiences", importDoc.audienceId)) {
    throw new ConvexError("That list still exists. Delete it with its contacts from the Audience page.");
  }
  return { ...importDoc, audienceId: importDoc.audienceId };
}

async function importedContact(ctx: QueryCtx, workspaceId: Id<"workspaces">, row: Doc<"audienceImportRows">) {
  if (row.status !== "saved" || !row.phone || row.existingContactId) return null;
  const phone = row.phone;
  return await ctx.db
    .query("contacts")
    .withIndex("by_workspace_external", (q) => q.eq("workspaceId", workspaceId).eq("externalId", phone))
    .unique();
}

export const deletedListPage = internalQuery({
  args: { importId: v.id("audienceImports"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const importDoc = await deletedListImport(ctx, args.importId);
    const keepers = await keepersIn(ctx, importDoc.workspaceId);
    const page = await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_line", (q) => q.eq("importId", args.importId))
      .paginate({ numItems: 100, cursor: args.cursor });
    let deletable = 0;
    let gone = 0;
    const kept: Record<string, number> = {};
    for (const row of page.page) {
      const contact = await importedContact(ctx, importDoc.workspaceId, row);
      if (!contact) {
        if (row.status === "saved" && !row.existingContactId) gone++;
        continue;
      }
      const reason = await keepReason(ctx, contact, importDoc.audienceId, keepers);
      if (reason) kept[reason] = (kept[reason] ?? 0) + 1;
      else deletable++;
    }
    return { deletable, gone, kept, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const previewDeletedList = internalAction({
  args: { importId: v.id("audienceImports") },
  handler: async (ctx, args) => {
    let cursor: string | null = null;
    const total = { deletable: 0, gone: 0, kept: {} as Record<string, number> };
    for (;;) {
      const page: { deletable: number; gone: number; kept: Record<string, number>; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.audience.deletedListPage, { importId: args.importId, cursor });
      total.deletable += page.deletable;
      total.gone += page.gone;
      for (const [reason, count] of Object.entries(page.kept)) total.kept[reason] = (total.kept[reason] ?? 0) + count;
      if (page.isDone) return total;
      cursor = page.continueCursor;
    }
  },
});

export const purgeDeletedList = internalMutation({
  args: { importId: v.id("audienceImports"), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const importDoc = await deletedListImport(ctx, args.importId);
    const keepers = await keepersIn(ctx, importDoc.workspaceId);
    const page = await ctx.db
      .query("audienceImportRows")
      .withIndex("by_importId_and_line", (q) => q.eq("importId", args.importId))
      .paginate({ numItems: 25, cursor: args.cursor ?? null });
    for (const row of page.page) {
      const contact = await importedContact(ctx, importDoc.workspaceId, row);
      if (contact && (await keepReason(ctx, contact, importDoc.audienceId, keepers)) === null) {
        await deleteContact(ctx, contact._id, keepers);
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.audience.purgeDeletedList, {
        importId: args.importId,
        cursor: page.continueCursor,
      });
    }
  },
});

async function addMembers(
  ctx: MutationCtx,
  audienceId: Id<"audiences">,
  workspaceId: Id<"workspaces">,
  contactIds: Id<"contacts">[]
) {
  const now = Date.now();
  let added = 0;
  for (const contactId of contactIds) {
    const contact = await ctx.db.get("contacts", contactId);
    if (!contact || contact.workspaceId !== workspaceId) continue;
    const existing = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audienceId_and_contactId", (q) =>
        q.eq("audienceId", audienceId).eq("contactId", contactId)
      )
      .unique();
    if (existing) continue;
    await ctx.db.insert("audienceMembers", { workspaceId, audienceId, contactId, addedAt: now });
    added++;
  }
  const audience = await ctx.db.get("audiences", audienceId);
  if (audience && added > 0) {
    await ctx.db.patch("audiences", audienceId, {
      memberCount: audience.memberCount + added,
      updatedAt: now,
    });
  }
  return added;
}

export const addPeople = mutation({
  args: { audienceId: v.id("audiences"), contactIds: v.array(v.id("contacts")) },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    if (args.contactIds.length > MAX_BULK) throw new ConvexError(`Pick at most ${MAX_BULK} people.`);
    const added = await addMembers(ctx, audience._id, audience.workspaceId, args.contactIds);
    return { added };
  },
});

export const removePeople = mutation({
  args: { audienceId: v.id("audiences"), contactIds: v.array(v.id("contacts")) },
  handler: async (ctx, args) => {
    const audience = await requireAudience(ctx, args.audienceId);
    if (args.contactIds.length > MAX_BULK) throw new ConvexError(`Pick at most ${MAX_BULK} people.`);
    let removed = 0;
    for (const contactId of args.contactIds) {
      const row = await ctx.db
        .query("audienceMembers")
        .withIndex("by_audienceId_and_contactId", (q) =>
          q.eq("audienceId", audience._id).eq("contactId", contactId)
        )
        .unique();
      if (!row) continue;
      await ctx.db.delete("audienceMembers", row._id);
      removed++;
    }
    await ctx.db.patch("audiences", audience._id, {
      memberCount: Math.max(0, audience.memberCount - removed),
      updatedAt: Date.now(),
    });
    return { removed };
  },
});

export const updatePeople = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    contactIds: v.array(v.id("contacts")),
    category: v.optional(v.string()),
    addTags: v.optional(v.array(v.string())),
    removeTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.contactIds.length > MAX_BULK) throw new ConvexError(`Pick at most ${MAX_BULK} people.`);
    if (args.category && !isBuiltIn(args.category)) {
      const known = await categoriesIn(ctx, args.workspaceId);
      if (!known.has(args.category)) throw new ConvexError("That category no longer exists.");
    }
    const add = (args.addTags ?? []).map(normaliseTag).filter(Boolean);
    const drop = new Set((args.removeTags ?? []).map(normaliseTag));
    let updated = 0;
    for (const contactId of args.contactIds) {
      const contact = await ctx.db.get("contacts", contactId);
      if (!contact || contact.workspaceId !== args.workspaceId) continue;
      const tags = [...new Set([...(contact.tags ?? []), ...add])]
        .filter((tag) => !drop.has(tag))
        .slice(0, 30);
      await ctx.db.patch("contacts", contact._id, {
        tags,
        ...(args.category !== undefined
          ? {
              category:
                args.category && args.category !== validityOf(contact.name) ? args.category : undefined,
            }
          : {}),
      });
      updated++;
    }
    return { updated };
  },
});
