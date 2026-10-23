import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./functions";
import { requireContact, requireWorkspace } from "./lib/auth";
import { normaliseBirthday } from "./lib/marketing";
import { normaliseEmail } from "./lib/notifications";
import { MAX_FIELDS, checkPhone } from "./lib/contactClean";
import { categoryOf, isBuiltIn, knownCategories } from "./lib/audience";
import { refreshContactSearch } from "./lib/inbox";
import schema from "./schema";
import { channelType, kvPair } from "./schema/validators";

/** The most people one paste may add. */
const MAX_ADD = 500;
const LIST_LIMIT = 1000;
const PAGE_READ_BUDGET = 1000;

/**
 * WhatsApp contacts typed in or pasted on the Marketing page, so greetings
 * and event reminders reach people who have not written in yet.
 *
 * Stored exactly as the inbound webhook would store them — the number as
 * digits, country code first — so when one of them replies, their message
 * finds this contact rather than creating a second one beside it.
 *
 * Someone already on file is not duplicated: their name, birthday, email and
 * company are filled in only where they were empty.
 */
export const addMany = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    /** Put in front of a number typed without one, e.g. "91". */
    countryCode: v.optional(v.string()),
    source: v.optional(v.union(v.literal("manual"), v.literal("import"))),
    contacts: v.array(
      v.object({
        name: v.optional(v.string()),
        phone: v.string(),
        birthday: v.optional(v.string()),
        email: v.optional(v.string()),
        company: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    if (args.contacts.length === 0) throw new ConvexError("Add at least one number.");
    if (args.contacts.length > MAX_ADD) {
      throw new ConvexError(`Add at most ${MAX_ADD} people at a time.`);
    }

    const now = Date.now();
    let added = 0;
    let updated = 0;
    const invalid: string[] = [];
    const seen = new Set<string>();

    for (const row of args.contacts) {
      const { digits } = checkPhone(row.phone, args.countryCode);
      if (!digits) {
        invalid.push(row.phone.trim() || "(empty)");
        continue;
      }
      if (seen.has(digits)) continue;
      seen.add(digits);

      const name = row.name?.trim() || undefined;
      const birthday = row.birthday?.trim()
        ? (normaliseBirthday(row.birthday) ?? undefined)
        : undefined;
      // Dropped rather than refused when it is not an address: the number is
      // what the import is for.
      const email = row.email?.trim() ? (normaliseEmail(row.email) ?? undefined) : undefined;
      const company = row.company?.trim() || undefined;

      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_external", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("externalId", digits)
        )
        .first();
      if (existing) {
        const patch: {
          name?: string;
          birthday?: string;
          email?: string;
          company?: string;
        } = {};
        if (!existing.name && name) patch.name = name;
        if (!existing.birthday && birthday) patch.birthday = birthday;
        if (!existing.email && email) patch.email = email;
        if (!existing.company && company) patch.company = company;
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch("contacts", existing._id, patch);
          if (patch.name) await refreshContactSearch(ctx, existing._id);
        }
        updated++;
        continue;
      }

      await ctx.db.insert("contacts", {
        workspaceId: args.workspaceId,
        externalId: digits,
        channelType: "whatsapp",
        name,
        phone: digits,
        birthday,
        email,
        company,
        attributes: [],
        source: args.source ?? "manual",
        audienceOnly: true,
        // Required, and there is no "never" to put: the day they were added
        // is the closest thing to when the business last heard of them.
        lastSeenAt: now,
        createdAt: now,
      });
      added++;
    }

    return { added, updated, invalid };
  },
});

/**
 * One page of the WhatsApp contacts, for the CSV export. Paged rather than
 * read whole, so a workspace with tens of thousands of people downloads in a
 * handful of calls instead of failing one oversized read; the page walks them
 * until `isDone`.
 */
export const exportPage = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
    audienceId: v.optional(v.id("audiences")),
    category: v.optional(v.string()),
    subscription: v.optional(v.union(v.literal("subscribed"), v.literal("unsubscribed"))),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const category = args.category;
    const known =
      category === undefined
        ? new Set<string>()
        : knownCategories(
            await ctx.db
              .query("marketingSettings")
              .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
              .unique()
          );
    const keep = (contact: Doc<"contacts"> | null): contact is Doc<"contacts"> =>
      contact !== null &&
      contact.workspaceId === args.workspaceId &&
      contact.channelType === "whatsapp" &&
      (category === undefined || categoryOf(contact, known) === category) &&
      (args.subscription !== "subscribed" || !contact.optedOutAt) &&
      (args.subscription !== "unsubscribed" || Boolean(contact.optedOutAt));
    const row = (contact: Doc<"contacts">) => ({
      name: contact.name ?? null,
      // The number messages actually go to, which `phone` — editable on
      // the Contacts page — need not be.
      phone: contact.externalId,
      birthday: contact.birthday ?? null,
      email: contact.email ?? null,
      company: contact.company ?? null,
      notes: contact.remark ?? null,
      fields: contact.attributes,
      optedOutAt: contact.optedOutAt ?? null,
    });

    if (args.audienceId) {
      const audienceId = args.audienceId;
      const audience = await ctx.db.get("audiences", audienceId);
      if (!audience || audience.workspaceId !== args.workspaceId) throw new ConvexError("List not found");
      const result = await ctx.db
        .query("audienceMembers")
        .withIndex("by_audienceId_and_contactId", (q) => q.eq("audienceId", audienceId))
        .paginate(args.paginationOpts);
      const contacts = await Promise.all(result.page.map((member) => ctx.db.get("contacts", member.contactId)));
      return { ...result, page: contacts.filter(keep).map(row) };
    }

    const result =
      category && known.has(category) && !isBuiltIn(category)
        ? await ctx.db
            .query("contacts")
            .withIndex("by_workspace_and_category", (q) =>
              q.eq("workspaceId", args.workspaceId).eq("category", category)
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("contacts")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
            .paginate(args.paginationOpts);
    return { ...result, page: result.page.filter(keep).map(row) };
  },
});

type BookCell = {
  stage: string | null;
  reference: string;
  count: number;
  updatedAt: number;
};

type Roster = {
  botNames: Map<string, string>;
  stageById: Map<string, Doc<"leadStages">>;
};

async function rosterOf(ctx: QueryCtx, workspaceId: Id<"workspaces">): Promise<Roster> {
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(200);
  const stages = await ctx.db
    .query("leadStages")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(200);
  return {
    botNames: new Map(agents.map((agent) => [agent._id as string, agent.botName])),
    stageById: new Map(stages.map((stage) => [stage._id as string, stage])),
  };
}

function groupRecords(
  records: Doc<"records">[],
  into = new Map<string, Map<string, BookCell>>()
) {
  for (const record of records) {
    if (!record.contactId) continue;
    const key = record.contactId as string;
    const books = into.get(key) ?? new Map<string, BookCell>();
    const seen = books.get(record.bookId as string);
    // The latest one speaks for the contact; the rest only add to the count.
    if (!seen || record.updatedAt > seen.updatedAt) {
      books.set(record.bookId as string, {
        stage: record.stage ?? null,
        reference: record.reference,
        count: (seen?.count ?? 0) + 1,
        updatedAt: record.updatedAt,
      });
    } else {
      seen.count += 1;
    }
    into.set(key, books);
  }
  return into;
}

async function recordsOf(ctx: QueryCtx, contactId: Id<"contacts">) {
  const records = await ctx.db
    .query("records")
    .withIndex("by_contact", (q) => q.eq("contactId", contactId))
    .take(100);
  return groupRecords(records).get(contactId as string) ?? new Map<string, BookCell>();
}

async function latestConversation(ctx: QueryCtx, contactId: Id<"contacts">) {
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_contact_agent", (q) => q.eq("contactId", contactId))
    .take(20);
  return conversations.reduce<Doc<"conversations"> | null>(
    (best, row) => (!best || row.lastMessageAt > best.lastMessageAt ? row : best),
    null
  );
}

function stageOf(latest: Doc<"conversations"> | null, roster: Roster) {
  return latest?.leadStageId ? (roster.stageById.get(latest.leadStageId as string) ?? null) : null;
}

function handledByOf(latest: Doc<"conversations"> | null, roster: Roster) {
  return latest ? (roster.botNames.get(latest.activeAgentId ?? latest.agentId) ?? null) : null;
}

function rowOf(
  contact: Doc<"contacts">,
  latest: Doc<"conversations"> | null,
  books: Map<string, BookCell>,
  roster: Roster
) {
  const stage = stageOf(latest, roster);
  return {
    ...contact,
    conversationId: latest?._id ?? null,
    messageCount: latest?.messageCount ?? 0,
    conversationStatus: latest?.status ?? null,
    leadStage: stage ? { name: stage.name, outcome: stage.outcome } : null,
    records: [...books].map(([bookId, row]) => ({
      bookId,
      stage: row.stage,
      reference: row.reference,
      count: row.count,
    })),
    handledBy: handledByOf(latest, roster),
  };
}

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(LIST_LIMIT);
    const roster = await rosterOf(ctx, args.workspaceId);
    const filed = await ctx.db
      .query("records")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(LIST_LIMIT * 5);
    const byContact = groupRecords(filed);

    const out = [];
    for (const contact of contacts) {
      const latest = await latestConversation(ctx, contact._id);
      out.push(rowOf(contact, latest, byContact.get(contact._id as string) ?? new Map(), roster));
    }
    return out;
  },
});

export const page = query({
  args: {
    workspaceId: v.id("workspaces"),
    search: v.optional(v.string()),
    channel: v.optional(channelType),
    status: v.optional(
      v.union(v.literal("open"), v.literal("escalated"), v.literal("closed"), v.literal("none"))
    ),
    /** A lead stage's name, or "none" for a contact not filed at one. */
    stage: v.optional(v.string()),
    seenSince: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const roster = await rosterOf(ctx, args.workspaceId);
    const needle = args.search?.trim().toLowerCase() ?? "";
    const latestById = new Map<string, Doc<"conversations"> | null>();
    const booksById = new Map<string, Map<string, BookCell>>();

    const latestFor = async (contactId: Id<"contacts">) => {
      const key = contactId as string;
      if (!latestById.has(key)) latestById.set(key, await latestConversation(ctx, contactId));
      return latestById.get(key) ?? null;
    };
    const booksFor = async (contactId: Id<"contacts">) => {
      const key = contactId as string;
      const cached = booksById.get(key);
      if (cached) return cached;
      const books = await recordsOf(ctx, contactId);
      booksById.set(key, books);
      return books;
    };

    const keep = async (contact: Doc<"contacts">) => {
      if (args.channel && contact.channelType !== args.channel) return false;
      if (args.seenSince !== undefined && contact.lastSeenAt < args.seenSince) return false;
      if (!args.status && !args.stage && !needle) return true;

      const latest = await latestFor(contact._id);
      if (args.status && (latest?.status ?? "none") !== args.status) return false;
      const stage = stageOf(latest, roster);
      if (args.stage && (stage?.name ?? "none") !== args.stage) return false;
      if (!needle) return true;

      const text = [
        contact.name,
        contact.phone,
        contact.email,
        contact.company,
        contact.remark,
        contact.externalId,
        handledByOf(latest, roster),
        stage?.name,
      ];
      if (text.some((field) => field?.toLowerCase().includes(needle))) return true;
      const books = await booksFor(contact._id);
      return [...books.values()].some((row) =>
        [row.reference, row.stage].some((field) => field?.toLowerCase().includes(needle))
      );
    };

    const result = await stream(ctx.db, schema)
      .query("contacts")
      .withIndex("by_workspace_and_audienceOnly", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("audienceOnly", undefined)
      )
      .order("desc")
      .filterWith(keep)
      .paginate({
        ...args.paginationOpts,
        maximumRowsRead: args.paginationOpts.maximumRowsRead ?? PAGE_READ_BUDGET,
      });

    const rows = [];
    for (const contact of result.page) {
      rows.push(rowOf(contact, await latestFor(contact._id), await booksFor(contact._id), roster));
    }
    return { ...result, page: rows };
  },
});

/** Everything a person may edit about a contact from the contacts table. */
export const update = mutation({
  args: {
    contactId: v.id("contacts"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    remark: v.optional(v.string()),
    /** Any readable date; stored as "MM-DD". Empty clears it. */
    birthday: v.optional(v.string()),
    /** The contact's own fields, replacing what is there. */
    attributes: v.optional(v.array(kvPair)),
  },
  handler: async (ctx, args) => {
    await requireContact(ctx, args.contactId);
    const { contactId, birthday, attributes, ...rest } = args;

    const patch: Record<string, unknown> = {};
    if (attributes !== undefined) {
      const kept: Array<{ key: string; value: string }> = [];
      for (const row of attributes) {
        const key = row.key.trim().slice(0, 40);
        const value = row.value.trim().slice(0, 500);
        if (!key || !value || kept.some((entry) => entry.key.toLowerCase() === key.toLowerCase())) continue;
        kept.push({ key, value });
      }
      patch.attributes = kept.slice(0, MAX_FIELDS);
    }
    if (birthday !== undefined) {
      const normalised = normaliseBirthday(birthday);
      if (birthday.trim() && !normalised) {
        throw new ConvexError("That birthday is not a real day of the year.");
      }
      patch.birthday = normalised ?? undefined;
    }
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      // A cleared field is stored as absent, not as an empty string, so the
      // table's "—" placeholder and the agent prompt both stay simple.
      patch[key] = value.trim() === "" ? undefined : value.trim();
    }

    await ctx.db.patch(contactId, patch);
    await refreshContactSearch(ctx, contactId);
    return { success: true };
  },
});

export const setSubscribed = mutation({
  args: { contactId: v.id("contacts"), subscribed: v.boolean() },
  handler: async (ctx, args) => {
    const contact = await requireContact(ctx, args.contactId);
    await ctx.db.patch("contacts", contact._id, {
      optedOutAt: args.subscribed ? undefined : Date.now(),
      optOutReason: args.subscribed ? undefined : "manual",
    });
    return { success: true };
  },
});
