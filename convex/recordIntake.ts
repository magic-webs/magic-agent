import { ConvexError, v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { kvPair } from "./schema";
import { checkValues, type RecordField } from "./lib/records";
import { personFromAnswers } from "./lib/apps";
import { leafPaths, lookup, normalisePhone, trimSample } from "./lib/notifications";
import {
  applyTarget,
  sameSource,
  validTarget,
  type MappedRecord,
  type MappingRow,
} from "./lib/recordMapping";
import { noteConversion } from "./lib/marketingStats";
import { noteContactActivity } from "./lib/contactActivity";
import { ORDERS_HANDLE } from "./lib/ordersBook";
import { publicSiteUrl } from "./lib/publicUrl";
import { randomKey } from "./lib/shared";
import { requireRecordBook } from "./lib/auth";
import { claimReference, searchBlobFor } from "./records";

const MAX_IMPORT_ROWS = 200;
const MAX_VALUE_LENGTH = 2000;
const MAX_SAMPLE = 16_000;

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
  const { reference, serialNumber } = await claimReference(ctx, book);
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

const MAX_MAPPING_ROWS = 200;
const mappingRow = v.object({ source: v.string(), target: v.string() });

function cleanMapping(book: Doc<"recordBooks">, mapping: MappingRow[]): MappingRow[] {
  const out: MappingRow[] = [];
  for (const row of mapping) {
    const source = row.source.trim().slice(0, 200);
    if (!source) continue;
    if (!validTarget(book, row.target)) {
      throw new ConvexError(`"${row.target}" is not a place in ${book.pluralName} a value can go.`);
    }
    if (out.some((kept) => sameSource(kept.source, source))) continue;
    out.push({ source, target: row.target });
  }
  return out.slice(0, MAX_MAPPING_ROWS);
}

/** Remembers which column went where, so the next file from the same place lines up. */
export const saveImportMapping = mutation({
  args: { bookId: v.id("recordBooks"), mapping: v.array(mappingRow) },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    const fresh = cleanMapping(book, args.mapping);
    const kept = (book.importMapping ?? []).filter(
      (row) => !fresh.some((next) => sameSource(next.source, row.source))
    );
    await ctx.db.patch(args.bookId, {
      importMapping: [...fresh, ...kept].slice(0, MAX_MAPPING_ROWS),
      updatedAt: Date.now(),
    });
    return { success: true };
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
    let parsed: unknown = null;
    try {
      parsed = book.lastInboundPayload ? JSON.parse(book.lastInboundPayload) : null;
    } catch {
      parsed = null;
    }
    return {
      enabled: book.inboundEnabled ?? false,
      url: inboundUrl(book.inboundKey),
      lastInboundAt: book.lastInboundAt ?? null,
      lastInboundPayload: book.lastInboundPayload ?? null,
      count: book.inboundCount ?? 0,
      sampleAt: book.inboundSampleAt ?? book.lastInboundAt ?? null,
      capturing: book.inboundCapture ?? false,
      samplePaths: parsed
        ? leafPaths(parsed, 100).map((path) => ({
            path,
            sample: (asValue(lookup(parsed, path)) ?? "").slice(0, 80),
          }))
        : [],
      mapping: book.inboundMapping ?? [],
    };
  },
});

export const saveInboundMapping = mutation({
  args: { bookId: v.id("recordBooks"), mapping: v.array(mappingRow) },
  handler: async (ctx, args) => {
    const book = await requireRecordBook(ctx, args.bookId);
    const mapping = cleanMapping(book, args.mapping);
    await ctx.db.patch(args.bookId, {
      inboundMapping: mapping.length ? mapping : undefined,
      updatedAt: Date.now(),
    });
    return { saved: mapping.length };
  },
});

/** Takes the next call as the sample the mapping is picked from. */
export const captureInboundSample = mutation({
  args: { bookId: v.id("recordBooks"), capture: v.boolean() },
  handler: async (ctx, args) => {
    await requireRecordBook(ctx, args.bookId);
    await ctx.db.patch(args.bookId, { inboundCapture: args.capture ? true : undefined });
    return { success: true };
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

/**
 * A posted body as the book's own field keys, the person, and the extras.
 * Paths the book has a saved mapping for go where it says; everything else is
 * matched by name, and a mapped value wins over a guessed one.
 */
function mapPayload(book: Doc<"recordBooks">, data: Record<string, unknown>) {
  const mapping = book.inboundMapping ?? [];
  const mapped: MappedRecord = { values: [] };
  for (const row of mapping) {
    const value = asValue(lookup(data, row.source));
    if (value) applyTarget(mapped, row.target, row.source, value);
  }
  const covered = (path: string) =>
    mapping.some(
      (row) => row.source === path || row.source.startsWith(`${path}.`)
    );

  const guessed = guessPayload(book, data, covered);
  return {
    values: [...guessed.values, ...mapped.values],
    person: { ...guessed.person, ...mapped.person },
    stage: mapped.stage ?? guessed.stage,
    notes: mapped.notes ?? guessed.notes,
  };
}

function guessPayload(
  book: Doc<"recordBooks">,
  data: Record<string, unknown>,
  covered: (path: string) => boolean
) {
  const paths = new Map<string, string>(Object.keys(data).map((key) => [key, key]));
  let source = data;
  for (const key of NESTED_KEYS) {
    const nested = data[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      source = { ...data, ...(nested as Record<string, unknown>) };
      delete source[key];
      for (const child of Object.keys(nested)) paths.set(child, `${key}.${child}`);
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
    if (!value?.trim() || key === "query" || covered(paths.get(key) ?? key)) continue;
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
    const data = JSON.parse(args.payload) as Record<string, unknown>;
    const takeSample = !book.lastInboundPayload || book.inboundCapture;
    await ctx.db.patch(book._id, {
      lastInboundAt: now,
      ...(takeSample
        ? {
            lastInboundPayload: (args.payload.length > MAX_SAMPLE
              ? JSON.stringify(trimSample(data))
              : args.payload
            ).slice(0, MAX_SAMPLE),
            inboundSampleAt: now,
            inboundCapture: undefined,
          }
        : {}),
    });
    if (!book.inboundEnabled || book.status === "archived") return "disabled";

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
