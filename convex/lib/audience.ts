import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { audienceCategory, audienceSelection } from "../schema/marketing";
import { sentRecently } from "./marketingStats";
import { isProperName } from "./contactClean";
import { marketOf } from "./markets";
import { inSegments } from "./segments";
import { normalisePhone } from "./notifications";

const SIZE_SCAN_CAP = 5000;
const CAP_CHECKS = 1500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type AudienceSelection = Infer<typeof audienceSelection>;
export type AudienceCategory = Infer<typeof audienceCategory>;

export const EVERYONE: AudienceSelection = {
  audienceIds: [],
  categories: [],
  tags: [],
  excludeAudienceIds: [],
};

export const VALID = "valid";
export const NOT_VALID = "invalid";

export const BUILT_IN_CATEGORIES: AudienceCategory[] = [
  {
    key: VALID,
    label: "Complete",
    description: "Has a real name and a WhatsApp number that can receive messages.",
  },
  {
    key: NOT_VALID,
    label: "Incomplete",
    description:
      "The name is missing or not a real name: a placeholder, a greeting like hi or hello, emojis, styled letters, digits or symbols — or the number cannot be used.",
  },
];

export function isBuiltIn(key: string) {
  return key === VALID || key === NOT_VALID;
}

export function withBuiltIns(stored: AudienceCategory[] | undefined): AudienceCategory[] {
  return [...BUILT_IN_CATEGORIES, ...(stored ?? []).filter((category) => !isBuiltIn(category.key))];
}

export function validityOf(name: string | undefined): string {
  return isProperName(name) ? VALID : NOT_VALID;
}

export function categoryOf(
  contact: Pick<Doc<"contacts">, "category" | "name">,
  known?: ReadonlySet<string>
): string {
  const stored = contact.category;
  if (stored && stored !== "unknown" && (!known || isBuiltIn(stored) || known.has(stored))) {
    return stored;
  }
  return validityOf(contact.name);
}

export function knownCategories(
  settings: Pick<Doc<"marketingSettings">, "categories"> | null | undefined
): Set<string> {
  return new Set((settings?.categories ?? []).map((category) => category.key));
}

export type RecordMatch = { contactIds: Set<string>; phones: Set<string> };

export type Scope = { known?: ReadonlySet<string>; now: number; records?: RecordMatch };

export function isEveryone(selection: AudienceSelection | undefined): boolean {
  return (
    !selection ||
    (selection.audienceIds.length === 0 &&
      selection.categories.length === 0 &&
      selection.tags.length === 0 &&
      !selection.records?.length)
  );
}

/** Who has a record in the chosen books: linked contacts, and phones for the rest. */
export async function loadRecordMatch(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  selection: AudienceSelection | undefined,
  limit = SIZE_SCAN_CAP
): Promise<RecordMatch | undefined> {
  if (!selection?.records?.length) return undefined;
  const match: RecordMatch = { contactIds: new Set(), phones: new Set() };
  for (const choice of selection.records) {
    const book = await ctx.db.get("recordBooks", choice.bookId);
    if (!book || book.workspaceId !== workspaceId) continue;
    const stages = choice.stages?.length ? choice.stages : [undefined];
    for (const stage of stages) {
      const rows = stage
        ? await ctx.db
            .query("records")
            .withIndex("by_book_stage", (q) => q.eq("bookId", choice.bookId).eq("stage", stage))
            .take(limit)
        : await ctx.db
            .query("records")
            .withIndex("by_book", (q) => q.eq("bookId", choice.bookId))
            .take(limit);
      for (const row of rows) {
        if (row.contactId) match.contactIds.add(row.contactId);
        const digits = row.person?.phone ? normalisePhone(row.person.phone, "91") : null;
        if (digits) match.phones.add(digits);
      }
    }
  }
  return match;
}

function inRecords(contact: Doc<"contacts">, records: RecordMatch | undefined): boolean {
  if (!records) return false;
  return records.contactIds.has(contact._id) || records.phones.has(contact.externalId);
}

export async function membershipsOf(
  ctx: QueryCtx,
  contactId: Id<"contacts">
): Promise<Set<Id<"audiences">>> {
  const rows = await ctx.db
    .query("audienceMembers")
    .withIndex("by_contactId", (q) => q.eq("contactId", contactId))
    .take(200);
  return new Set(rows.map((row) => row.audienceId));
}

export async function inSelection(
  ctx: QueryCtx,
  contact: Doc<"contacts">,
  selection: AudienceSelection | undefined,
  scope: Scope
): Promise<boolean> {
  if (!selection) return true;
  if (!inSegments(contact, selection.segments, scope.now)) return false;
  const needsLists =
    selection.audienceIds.length > 0 || selection.excludeAudienceIds.length > 0;
  const lists = needsLists ? await membershipsOf(ctx, contact._id) : new Set();
  if (selection.excludeAudienceIds.some((id) => lists.has(id))) return false;
  if (isEveryone(selection)) return true;
  if (selection.categories.includes(categoryOf(contact, scope.known))) return true;
  if (contact.tags?.some((tag) => selection.tags.includes(tag))) return true;
  if (selection.records?.length) {
    const records =
      scope.records ?? (await loadRecordMatch(ctx, contact.workspaceId, selection));
    if (inRecords(contact, records)) return true;
  }
  return selection.audienceIds.some((id) => lists.has(id));
}

export async function loadMemberSets(
  ctx: QueryCtx,
  selection: AudienceSelection,
  limit: number
): Promise<Map<Id<"audiences">, Set<Id<"contacts">>>> {
  const sets = new Map<Id<"audiences">, Set<Id<"contacts">>>();
  for (const audienceId of [...selection.audienceIds, ...selection.excludeAudienceIds]) {
    if (sets.has(audienceId)) continue;
    const rows = await ctx.db
      .query("audienceMembers")
      .withIndex("by_audienceId_and_contactId", (q) => q.eq("audienceId", audienceId))
      .take(limit);
    sets.set(audienceId, new Set(rows.map((row) => row.contactId)));
  }
  return sets;
}

export function matchesWith(
  contact: Doc<"contacts">,
  selection: AudienceSelection,
  sets: Map<Id<"audiences">, Set<Id<"contacts">>>,
  scope: Scope
): boolean {
  const member = (id: Id<"audiences">) => sets.get(id)?.has(contact._id) ?? false;
  if (selection.excludeAudienceIds.some(member)) return false;
  if (!inSegments(contact, selection.segments, scope.now)) return false;
  if (isEveryone(selection)) return true;
  if (selection.categories.includes(categoryOf(contact, scope.known))) return true;
  if (contact.tags?.some((tag) => selection.tags.includes(tag))) return true;
  if (inRecords(contact, scope.records)) return true;
  return selection.audienceIds.some(member);
}

export function reachable(contact: Doc<"contacts">): boolean {
  return contact.channelType === "whatsapp" && !contact.optedOutAt;
}

export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}\-_]/gu, "").slice(0, 40);
}

export async function measureAudience(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  selection: AudienceSelection,
  now: number
) {
  const settings = await ctx.db
    .query("marketingSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const cap = settings?.weeklyCap ?? 0;
  const contacts = await ctx.db
    .query("contacts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(SIZE_SCAN_CAP);
  const sets = await loadMemberSets(ctx, selection, SIZE_SCAN_CAP);
  const records = await loadRecordMatch(ctx, workspaceId, selection);
  const known = knownCategories(settings);
  let matched = 0;
  let notWhatsApp = 0;
  let sendable = 0;
  let optedOut = 0;
  let overCap = 0;
  let capChecks = 0;
  const byMarket: Record<string, number> = {};
  for (const contact of contacts) {
    if (!matchesWith(contact, selection, sets, { known, now, records })) continue;
    matched++;
    if (contact.channelType !== "whatsapp") {
      notWhatsApp++;
      continue;
    }
    if (!reachable(contact)) {
      optedOut++;
      continue;
    }
    if (cap > 0 && capChecks < CAP_CHECKS) {
      capChecks++;
      if ((await sentRecently(ctx, contact._id, now - WEEK_MS)) >= cap) {
        overCap++;
        continue;
      }
    }
    sendable++;
    const market = marketOf(contact.externalId);
    byMarket[market] = (byMarket[market] ?? 0) + 1;
  }
  const partialBecause: "size" | "cap" | null =
    contacts.length >= SIZE_SCAN_CAP ? "size" : capChecks >= CAP_CHECKS ? "cap" : null;
  const listTotal = await listsTotal(ctx, workspaceId, selection);
  return {
    reachable: sendable,
    matched,
    notWhatsApp,
    byMarket,
    optedOut,
    overCap,
    listTotal,
    partial: partialBecause !== null,
    partialBecause,
    scanLimit: SIZE_SCAN_CAP,
    capLimit: CAP_CHECKS,
    upTo: partialBecause ? listTotal : null,
  };
}

export type AudienceSize = Awaited<ReturnType<typeof measureAudience>>;

// Up to two lookups a contact (lists and the weekly limit), kept well inside a query's limits.
const COUNT_PAGE = 500;

export type AudienceTotals = Pick<
  AudienceSize,
  "reachable" | "matched" | "notWhatsApp" | "byMarket" | "optedOut" | "overCap"
>;

/** One page of an exact count, matched the way a send matches, for audiences too big to measure in one query. */
export async function countAudiencePage(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  selection: AudienceSelection,
  now: number,
  cursor: string | null
): Promise<AudienceTotals & { listTotal: number | null; cursor: string; isDone: boolean }> {
  const settings = await ctx.db
    .query("marketingSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  const cap = settings?.weeklyCap ?? 0;
  const known = knownCategories(settings);
  const records = await loadRecordMatch(ctx, workspaceId, selection);
  const page = await ctx.db
    .query("contacts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .paginate({ numItems: COUNT_PAGE, cursor });
  const totals = emptyTotals();
  for (const contact of page.page) {
    if (!(await inSelection(ctx, contact, selection, { known, now, records }))) continue;
    totals.matched++;
    if (contact.channelType !== "whatsapp") {
      totals.notWhatsApp++;
      continue;
    }
    if (!reachable(contact)) {
      totals.optedOut++;
      continue;
    }
    if (cap > 0 && (await sentRecently(ctx, contact._id, now - WEEK_MS)) >= cap) {
      totals.overCap++;
      continue;
    }
    totals.reachable++;
    const market = marketOf(contact.externalId);
    totals.byMarket[market] = (totals.byMarket[market] ?? 0) + 1;
  }
  return {
    ...totals,
    listTotal: cursor === null ? await listsTotal(ctx, workspaceId, selection) : null,
    cursor: page.continueCursor,
    isDone: page.isDone,
  };
}

export function emptyTotals(): AudienceTotals {
  return { reachable: 0, matched: 0, notWhatsApp: 0, byMarket: {}, optedOut: 0, overCap: 0 };
}

export function exactSize(totals: AudienceTotals, listTotal: number | null): AudienceSize {
  return {
    ...totals,
    listTotal,
    partial: false,
    partialBecause: null,
    scanLimit: SIZE_SCAN_CAP,
    capLimit: CAP_CHECKS,
    upTo: null,
  };
}

/** The most a selection of lists alone can reach: their sizes added up, before repeats are removed. */
async function listsTotal(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  selection: AudienceSelection
): Promise<number | null> {
  const listsOnly =
    selection.audienceIds.length > 0 &&
    selection.categories.length === 0 &&
    selection.tags.length === 0 &&
    !selection.records?.length;
  if (!listsOnly) return null;
  let total = 0;
  for (const id of selection.audienceIds) {
    const audience = await ctx.db.get("audiences", id);
    if (audience?.workspaceId === workspaceId) total += audience.memberCount;
  }
  return total;
}
