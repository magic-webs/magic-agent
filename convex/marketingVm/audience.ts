import { ConvexError, v } from "convex/values";
import { internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../functions";
import type { Doc, Id } from "../_generated/dataModel";
import { deleteMessage } from "../lib/delivery";
import { refreshContactSearch } from "../lib/inbox";
import { appendNote, mergeFields } from "../lib/contactClean";
import { EVERYONE, isBuiltIn, loadRecordMatch, validityOf } from "../lib/audience";
import { kvPair } from "../schema/validators";

const MAX_IDS = 500;

function mirrorDoc(contact: Doc<"contacts">) {
  const { remark: _remark, ...rest } = contact;
  return rest;
}

async function contactIn(ctx: QueryCtx, workspaceId: Id<"workspaces">, id: string) {
  const contactId = ctx.db.normalizeId("contacts", id);
  const contact = contactId ? await ctx.db.get("contacts", contactId) : null;
  return contact && contact.workspaceId === workspaceId ? contact : null;
}

function capIds(ids: string[]) {
  if (ids.length > MAX_IDS) throw new ConvexError(`Pick at most ${MAX_IDS} people.`);
}

export const business = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    return workspace
      ? [workspace.name, workspace.industry, workspace.description].filter(Boolean).join(" — ").slice(0, 400)
      : "";
  },
});

export const remarks = internalQuery({
  args: { workspaceId: v.id("workspaces"), contactIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    capIds(args.contactIds);
    const out: Array<{ id: string; remark: string | null }> = [];
    for (const id of args.contactIds) {
      const contact = await contactIn(ctx, args.workspaceId, id);
      if (contact) out.push({ id: contact._id, remark: contact.remark ?? null });
    }
    return out;
  },
});

export const recordMatch = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    records: v.array(v.object({ bookId: v.id("recordBooks"), stages: v.optional(v.array(v.string())) })),
  },
  handler: async (ctx, args) => {
    const match = await loadRecordMatch(ctx, args.workspaceId, { ...EVERYONE, records: args.records });
    return { contactIds: [...(match?.contactIds ?? [])], phones: [...(match?.phones ?? [])] };
  },
});

const savedRow = v.object({
  phone: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  company: v.optional(v.string()),
  birthday: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.array(v.string()),
  notes: v.optional(v.string()),
  fields: v.optional(v.array(kvPair)),
  doNotContact: v.optional(v.boolean()),
  nameEdited: v.optional(v.boolean()),
});

export const saveContacts = internalMutation({
  args: { workspaceId: v.id("workspaces"), rows: v.array(savedRow) },
  handler: async (ctx, args) => {
    capIds(args.rows.map((row) => row.phone));
    const now = Date.now();
    const out: Array<{ phone: string; contactId: Id<"contacts">; doc: ReturnType<typeof mirrorDoc> | null }> = [];
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_workspace_external", (q) => q.eq("workspaceId", args.workspaceId).eq("externalId", row.phone))
        .unique();
      let contactId: Id<"contacts">;
      if (existing) {
        const patch: Partial<Doc<"contacts">> = {};
        if (row.name && (!existing.name || row.nameEdited)) patch.name = row.name;
        if (!existing.email && row.email) patch.email = row.email;
        if (!existing.company && row.company) patch.company = row.company;
        if (!existing.birthday && row.birthday) patch.birthday = row.birthday;
        if (row.category && (!existing.category || existing.category === "unknown" || isBuiltIn(existing.category))) {
          patch.category = row.category === validityOf(patch.name ?? existing.name ?? row.name) ? undefined : row.category;
        }
        const tags = [...new Set([...(existing.tags ?? []), ...row.tags])].slice(0, 30);
        if (tags.length !== (existing.tags ?? []).length) patch.tags = tags;
        const remark = appendNote(existing.remark, row.notes);
        if (remark !== existing.remark) patch.remark = remark;
        if (row.fields?.length) {
          const attributes = mergeFields(existing.attributes, row.fields, true);
          if (JSON.stringify(attributes) !== JSON.stringify(existing.attributes)) patch.attributes = attributes;
        }
        if (row.doNotContact && !existing.optedOutAt) {
          patch.optedOutAt = now;
          patch.optOutReason = "import";
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch("contacts", existing._id, patch);
          if (patch.name || patch.remark) await refreshContactSearch(ctx, existing._id);
        }
        contactId = existing._id;
      } else {
        contactId = await ctx.db.insert("contacts", {
          workspaceId: args.workspaceId,
          externalId: row.phone,
          channelType: "whatsapp",
          name: row.name,
          phone: row.phone,
          email: row.email,
          company: row.company,
          birthday: row.birthday,
          category: row.category === validityOf(row.name) ? undefined : row.category,
          tags: row.tags,
          remark: row.notes,
          attributes: row.fields ?? [],
          source: "import",
          audienceOnly: true,
          ...(row.doNotContact ? { optedOutAt: now, optOutReason: "import" as const } : {}),
          lastSeenAt: now,
          createdAt: now,
        });
      }
      const doc = await ctx.db.get("contacts", contactId);
      out.push({ phone: row.phone, contactId, doc: doc ? mirrorDoc(doc) : null });
    }
    return out;
  },
});

export const recheckContacts = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    rows: v.array(
      v.object({
        contactId: v.string(),
        name: v.optional(v.string()),
        nameEdited: v.optional(v.boolean()),
        category: v.optional(v.string()),
        company: v.optional(v.string()),
        tags: v.array(v.string()),
        doNotContact: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    capIds(args.rows.map((row) => row.contactId));
    const now = Date.now();
    const docs: Array<ReturnType<typeof mirrorDoc>> = [];
    for (const row of args.rows) {
      const contact = await contactIn(ctx, args.workspaceId, row.contactId);
      if (!contact) continue;
      const patch: Partial<Doc<"contacts">> = {};
      if (row.name && row.name !== contact.name && row.nameEdited) patch.name = row.name;
      if (row.category) {
        const category = row.category === validityOf(patch.name ?? contact.name) ? undefined : row.category;
        if (category !== contact.category) patch.category = category;
      }
      if (!contact.company && row.company) patch.company = row.company;
      const tags = [...new Set([...(contact.tags ?? []), ...row.tags])].slice(0, 30);
      if (tags.length !== (contact.tags ?? []).length) patch.tags = tags;
      if (row.doNotContact && !contact.optedOutAt) {
        patch.optedOutAt = now;
        patch.optOutReason = "import";
      }
      if (Object.keys(patch).length === 0) continue;
      await ctx.db.patch("contacts", contact._id, patch);
      if (patch.name) await refreshContactSearch(ctx, contact._id);
      const fresh = await ctx.db.get("contacts", contact._id);
      if (fresh) docs.push(mirrorDoc(fresh));
    }
    return docs;
  },
});

export const updatePeople = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    contactIds: v.array(v.string()),
    category: v.optional(v.string()),
    addTags: v.array(v.string()),
    removeTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    capIds(args.contactIds);
    const drop = new Set(args.removeTags);
    const docs: Array<ReturnType<typeof mirrorDoc>> = [];
    for (const id of args.contactIds) {
      const contact = await contactIn(ctx, args.workspaceId, id);
      if (!contact) continue;
      const tags = [...new Set([...(contact.tags ?? []), ...args.addTags])].filter((tag) => !drop.has(tag)).slice(0, 30);
      await ctx.db.patch("contacts", contact._id, {
        tags,
        ...(args.category !== undefined
          ? { category: args.category && args.category !== validityOf(contact.name) ? args.category : undefined }
          : {}),
      });
      const fresh = await ctx.db.get("contacts", contact._id);
      if (fresh) docs.push(mirrorDoc(fresh));
    }
    return docs;
  },
});

export const stripFields = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    items: v.array(
      v.object({ contactId: v.optional(v.string()), phone: v.optional(v.string()), fields: v.array(kvPair) })
    ),
  },
  handler: async (ctx, args) => {
    capIds(args.items.map((item) => item.contactId ?? item.phone ?? ""));
    let changed = 0;
    for (const item of args.items) {
      const phone = item.phone;
      const contact = item.contactId
        ? await contactIn(ctx, args.workspaceId, item.contactId)
        : phone
          ? await ctx.db
              .query("contacts")
              .withIndex("by_workspace_external", (q) => q.eq("workspaceId", args.workspaceId).eq("externalId", phone))
              .unique()
          : null;
      if (!contact) continue;
      const attributes = contact.attributes.filter(
        (attribute) =>
          !item.fields.some(
            (field) =>
              field.key.trim().toLowerCase() === attribute.key.trim().toLowerCase() && field.value === attribute.value
          )
      );
      if (attributes.length === contact.attributes.length) continue;
      await ctx.db.patch("contacts", contact._id, { attributes });
      changed++;
    }
    return { changed };
  },
});

type Keepers = { paid: Set<Id<"contacts">>; forms: Set<Id<"contacts">>; rollouts: Id<"marketingEvents">[] };

async function keepersIn(ctx: QueryCtx, workspaceId: Id<"workspaces">): Promise<Keepers> {
  const links = await ctx.db
    .query("paymentLinks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(2000);
  const forms = await ctx.db
    .query("formSubmissions")
    .withIndex("by_account", (q) => q.eq("workspaceId", workspaceId))
    .take(2000);
  const sends = await ctx.db
    .query("marketingEvents")
    .withIndex("by_workspace_and_date", (q) => q.eq("workspaceId", workspaceId))
    .take(1000);
  return {
    paid: new Set(links.flatMap((link) => (link.contactId ? [link.contactId] : []))),
    forms: new Set(forms.flatMap((form) => (form.contactId ? [form.contactId] : []))),
    rollouts: sends.flatMap((send) => (send.rollout ? [send._id] : [])),
  };
}

async function mustKeep(ctx: QueryCtx, contact: Doc<"contacts">, keepers: Keepers) {
  if (contact.lastInboundAt || contact.lastRepliedAt || contact.lastOrderAt) return true;
  if (keepers.paid.has(contact._id) || keepers.forms.has(contact._id)) return true;
  if (await ctx.db.query("orders").withIndex("by_contact", (q) => q.eq("contactId", contact._id)).first()) return true;
  if (await ctx.db.query("records").withIndex("by_contact", (q) => q.eq("contactId", contact._id)).first()) return true;
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_contact_agent", (q) => q.eq("contactId", contact._id))
    .take(20);
  if (conversations.length === 20) return true;
  for (const conversation of conversations) {
    const conversationId = conversation._id;
    const inbound = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .filter((q) => q.eq(q.field("role"), "user"))
      .first();
    if (inbound) return true;
    if (await ctx.db.query("appLinks").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).first()) {
      return true;
    }
    if (
      await ctx.db.query("paymentLinks").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).first()
    ) {
      return true;
    }
  }
  return false;
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

/** Deletes the contacts nothing in Convex ties to the business; the service has already ruled out its own ties. */
export const purgeContacts = internalMutation({
  args: { workspaceId: v.id("workspaces"), contactIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (args.contactIds.length > 50) throw new ConvexError("Too many contacts at once.");
    const keepers = await keepersIn(ctx, args.workspaceId);
    const deleted: string[] = [];
    for (const id of args.contactIds) {
      const contact = await contactIn(ctx, args.workspaceId, id);
      if (!contact || (await mustKeep(ctx, contact, keepers))) continue;
      await deleteContact(ctx, contact._id, keepers);
      deleted.push(contact._id);
    }
    return { deleted };
  },
});
