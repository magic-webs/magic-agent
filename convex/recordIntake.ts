import { ConvexError, v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { kvPair } from "./schema";
import { checkValues, type RecordField } from "./lib/records";
import { personFromAnswers } from "./lib/apps";
import { normalisePhone } from "./lib/notifications";
import { noteConversion } from "./lib/marketingStats";
import { noteContactActivity } from "./lib/contactActivity";
import { ORDERS_HANDLE } from "./lib/ordersBook";
import { publicSiteUrl } from "./lib/publicUrl";
import { randomKey } from "./lib/shared";
import { requireRecordBook } from "./lib/auth";
import { claimSerial, freshReference, searchBlobFor } from "./records";

const MAX_IMPORT_ROWS = 200;
const MAX_VALUE_LENGTH = 2000;

type Pair = { key: string; value: string };
type Person = { name?: string; phone?: string; email?: string; company?: string };

const personShape = v.object({
  name: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  company: v.optional(v.string()),
});

const fieldKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function cleanPerson(person: Person): Person | undefined {
  const kept = Object.fromEntries(
    Object.entries(person)
      .map(([key, value]) => [key, value?.trim()])
      .filter(([, value]) => value)
  ) as Person;
  return Object.keys(kept).length ? kept : undefined;
}

async function contactForPhone(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  phone: string | undefined
) {
  const digits = phone ? normalisePhone(phone, "91") : null;
  if (!digits) return null;
  return await ctx.db
    .query("contacts")
    .withIndex("by_workspace_external", (q) =>
      q.eq("workspaceId", workspaceId).eq("externalId", digits)
    )
    .first();
}

/**
 * Files one record from outside the conversation. Lenient on purpose, as a form
 * submission is: a value the book would turn away is kept as an extra rather
 * than lost, and a missing required field does not block the row.
 */
async function fileOutside(
  ctx: MutationCtx,
  book: Doc<"recordBooks">,
  input: {
    values: Pair[];
    person?: Person;
    stage?: string;
    notes?: string;
    source: "import" | "webhook";
  }
): Promise<Id<"records">> {
  const given: Record<string, string> = {};
  for (const pair of input.values) {
    const value = pair.value.trim().slice(0, MAX_VALUE_LENGTH);
    if (pair.key.trim() && value) given[pair.key.trim()] = value;
  }
  const checked = checkValues(book.fields as RecordField[], given);
  const kept = new Set(checked.values.map((pair) => pair.key));
  const values = [
    ...checked.values,
    ...Object.entries(given)
      .filter(([key]) => !kept.has(key))
      .map(([key, value]) => ({ key, value })),
  ];

  const guessed = personFromAnswers(
    Object.entries(given).map(([key, value]) => ({ key, label: key, value }))
  );
  const person = cleanPerson({ ...guessed, ...input.person });
  const contact = await contactForPhone(ctx, book.workspaceId, person?.phone);

  const stage =
    input.stage &&
    book.stages.find((name) => name.toLowerCase() === input.stage!.trim().toLowerCase());

  const now = Date.now();
  const reference = await freshReference(ctx, book.workspaceId, book.referencePrefix);
  const serialNumber = await claimSerial(ctx, book._id);
  const recordId = await ctx.db.insert("records", {
    workspaceId: book.workspaceId,
    bookId: book._id,
    reference,
    serialNumber,
    contactId: contact?._id,
    person,
    values,
    stage: stage || book.stages[0],
    notes: input.notes?.trim() || undefined,
    source: input.source,
    searchBlob: searchBlobFor(reference, person, values),
    createdAt: now,
    updatedAt: now,
  });
  if (contact) {
    await noteConversion(ctx, contact._id, now);
    if (book.handle === ORDERS_HANDLE) {
      await noteContactActivity(ctx, contact._id, "lastOrderAt", now);
    }
  }
  return recordId;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** One batch of rows from a spreadsheet. The page sends a big file in batches. */
export const importRecords = mutation({
  args: {
    bookId: v.id("recordBooks"),
    rows: v.array(
      v.object({
        values: v.array(kvPair),
        person: v.optional(personShape),
        stage: v.optional(v.string()),
        notes: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    if (book.status === "archived") {
      throw new ConvexError(`${book.pluralName} is archived. Reopen it before importing.`);
    }
    if (args.rows.length > MAX_IMPORT_ROWS) {
      throw new ConvexError(`Send at most ${MAX_IMPORT_ROWS} rows at a time.`);
    }
    for (const row of args.rows) {
      await fileOutside(ctx, book, { ...row, source: "import" });
    }
    return { imported: args.rows.length };
  },
});

// ---------------------------------------------------------------------------
// Incoming webhook
// ---------------------------------------------------------------------------

function inboundUrl(key: string | undefined): string | null {
  return key ? `${publicSiteUrl()}/records/${key}` : null;
}

export const inboundSettings = query({
  args: { bookId: v.id("recordBooks") },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    return {
      enabled: book.inboundEnabled ?? false,
      url: inboundUrl(book.inboundKey),
      lastInboundAt: book.lastInboundAt ?? null,
      lastInboundPayload: book.lastInboundPayload ?? null,
      count: book.inboundCount ?? 0,
    };
  },
});

export const setInboundEnabled = mutation({
  args: { bookId: v.id("recordBooks"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    const inboundKey = book.inboundKey ?? randomKey(28);
    await ctx.db.patch(args.bookId, {
      inboundEnabled: args.enabled,
      inboundKey,
      updatedAt: Date.now(),
    });
    return { url: inboundUrl(inboundKey) };
  },
});

export const rotateInboundKey = mutation({
  args: { bookId: v.id("recordBooks") },
  handler: async (ctx, args) => {
    await requireRecordBook(ctx, args.bookId);
    const inboundKey = randomKey(28);
    await ctx.db.patch(args.bookId, { inboundKey, updatedAt: Date.now() });
    return { url: inboundUrl(inboundKey) };
  },
});

const NESTED_KEYS = ["data", "record", "fields", "payload", "body"];
const PERSON_KEYS: Record<string, keyof Person> = {
  name: "name",
  fullname: "name",
  customername: "name",
  phone: "phone",
  mobile: "phone",
  phonenumber: "phone",
  whatsapp: "phone",
  email: "email",
  emailaddress: "email",
  company: "company",
  companyname: "company",
  business: "company",
};

function asValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
}

/** A posted body as the book's own field keys, the person, and the extras. */
function mapPayload(book: Doc<"recordBooks">, data: Record<string, unknown>) {
  let source = data;
  for (const key of NESTED_KEYS) {
    const nested = data[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      source = { ...data, ...(nested as Record<string, unknown>) };
      delete source[key];
      break;
    }
  }

  const byName = new Map<string, string>();
  for (const field of book.fields as RecordField[]) {
    byName.set(fieldKey(field.key), field.key);
    byName.set(fieldKey(field.label), field.key);
  }

  const values: Pair[] = [];
  const person: Person = {};
  let stage: string | undefined;
  let notes: string | undefined;
  for (const [key, raw] of Object.entries(source)) {
    const value = asValue(raw);
    if (!value?.trim() || key === "query") continue;
    const name = fieldKey(key);
    const field = byName.get(name);
    if (field) {
      values.push({ key: field, value });
    } else if (PERSON_KEYS[name]) {
      person[PERSON_KEYS[name]] ??= value;
    } else if (name === "stage") {
      stage = value;
    } else if (name === "notes" || name === "note") {
      notes = value;
    } else {
      values.push({ key: key.trim().slice(0, 60), value });
    }
  }
  return { values, person, stage, notes };
}

/** Called by the /records/<key> route. */
export const acceptInbound = internalMutation({
  args: { inboundKey: v.string(), payload: v.string() },
  handler: async (ctx, args): Promise<"filed" | "disabled" | "unknown"> => {
    const book = await ctx.db
      .query("recordBooks")
      .withIndex("by_inboundKey", (q) => q.eq("inboundKey", args.inboundKey))
      .unique();
    if (!book) return "unknown";

    const now = Date.now();
    await ctx.db.patch(book._id, {
      lastInboundPayload: args.payload.slice(0, 8000),
      lastInboundAt: now,
    });
    if (!book.inboundEnabled || book.status === "archived") return "disabled";

    const data = JSON.parse(args.payload) as Record<string, unknown>;
    const recordId = await fileOutside(ctx, book, {
      ...mapPayload(book, data),
      source: "webhook",
    });
    await ctx.db.patch(book._id, { inboundCount: (book.inboundCount ?? 0) + 1 });
    await ctx.scheduler.runAfter(0, internal.records.announce, {
      recordId,
      event: "filed",
      byAgent: true,
    });
    return "filed";
  },
});
