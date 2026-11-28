import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { LedgerCategory } from "./billing";

type Totals = { messages: number; amountMicros: number };
export type DailyCategories = Record<LedgerCategory, Totals>;

const REBUILD_CAP = 15_000;

export const emptyDailyCategories = (): DailyCategories => ({
  service: { messages: 0, amountMicros: 0 },
  utility: { messages: 0, amountMicros: 0 },
  marketing: { messages: 0, amountMicros: 0 },
  authentication: { messages: 0, amountMicros: 0 },
  genie: { messages: 0, amountMicros: 0 },
});

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter) return formatter;
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

function wallClock(instant: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant, read in a zone. */
export function localDay(instant: number, timeZone: string): string {
  const t = wallClock(instant, timeZone);
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

function offsetAt(instant: number, timeZone: string): number {
  const t = wallClock(instant, timeZone);
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a local day starts. */
export function dayStart(day: string, timeZone: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

type Share = {
  day: string;
  currency: string;
  category: LedgerCategory;
  messages: number;
  amountMicros: number;
  unrated: number;
  pending: number;
};

function shareOf(row: Doc<"billingEvents">, timeZone: string): Share {
  return {
    day: localDay(row.createdAt, timeZone),
    currency: row.currency,
    category: row.category === "ai" ? "service" : row.category,
    messages: row.mergedInto === undefined && row.status !== "refunded" ? 1 : 0,
    amountMicros: row.amountMicros,
    unrated: row.rated ? 0 : 1,
    pending: row.status === "pending" ? 1 : 0,
  };
}

const ROLLED_FIELDS = [
  "createdAt",
  "currency",
  "category",
  "mergedInto",
  "status",
  "amountMicros",
  "rated",
] as const;

async function timeZoneOf(db: DatabaseReader, workspaceId: Id<"workspaces">) {
  return (await db.get("workspaces", workspaceId))?.timezone ?? "UTC";
}

function dayRow(db: DatabaseReader, workspaceId: Id<"workspaces">, day: string, currency: string) {
  return db
    .query("billingDaily")
    .withIndex("by_workspace_day_currency", (q) =>
      q.eq("workspaceId", workspaceId).eq("day", day).eq("currency", currency)
    )
    .unique();
}

async function bump(
  db: DatabaseWriter,
  workspaceId: Id<"workspaces">,
  share: Share,
  sign: 1 | -1
) {
  const row = await dayRow(db, workspaceId, share.day, share.currency);
  const categories = row ? structuredClone(row.categories) : emptyDailyCategories();
  categories[share.category].messages += sign * share.messages;
  categories[share.category].amountMicros += sign * share.amountMicros;
  const unrated = (row?.unrated ?? 0) + sign * share.unrated;
  const pending = (row?.pending ?? 0) + sign * share.pending;
  if (row) {
    await db.patch("billingDaily", row._id, { categories, unrated, pending });
  } else {
    await db.insert("billingDaily", {
      workspaceId,
      day: share.day,
      currency: share.currency,
      categories,
      unrated,
      pending,
    });
  }
}

/** Moves one billingEvents change into the day totals. */
export async function rollUpBillingEvent(
  db: DatabaseWriter,
  oldDoc: Doc<"billingEvents"> | null,
  newDoc: Doc<"billingEvents"> | null
) {
  if (oldDoc && newDoc && ROLLED_FIELDS.every((f) => oldDoc[f] === newDoc[f])) return;
  const workspaceId = (newDoc ?? oldDoc)!.workspaceId;
  const timeZone = await timeZoneOf(db, workspaceId);
  if (oldDoc) await bump(db, workspaceId, shareOf(oldDoc, timeZone), -1);
  if (newDoc) await bump(db, workspaceId, shareOf(newDoc, timeZone), 1);
}

/** Recounts one local day from its billingEvents. Returns the rows read. */
export async function rebuildDay(
  db: DatabaseWriter,
  workspaceId: Id<"workspaces">,
  day: string,
  timeZone: string
): Promise<number> {
  const rows = await db
    .query("billingEvents")
    .withIndex("by_workspace_createdAt", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .gte("createdAt", dayStart(day, timeZone))
        .lt("createdAt", dayStart(shiftDay(day, 1), timeZone))
    )
    .take(REBUILD_CAP);
  if (rows.length === REBUILD_CAP) {
    throw new Error(`billingDaily: ${workspaceId} ${day} has more than ${REBUILD_CAP} rows`);
  }

  const counted = new Map<
    string,
    { categories: DailyCategories; unrated: number; pending: number }
  >();
  for (const row of rows) {
    const share = shareOf(row, timeZone);
    const entry = counted.get(share.currency) ?? {
      categories: emptyDailyCategories(),
      unrated: 0,
      pending: 0,
    };
    entry.categories[share.category].messages += share.messages;
    entry.categories[share.category].amountMicros += share.amountMicros;
    entry.unrated += share.unrated;
    entry.pending += share.pending;
    counted.set(share.currency, entry);
  }

  const existing = await db
    .query("billingDaily")
    .withIndex("by_workspace_day_currency", (q) =>
      q.eq("workspaceId", workspaceId).eq("day", day)
    )
    .collect();
  for (const row of existing) {
    const entry = counted.get(row.currency);
    if (entry) {
      await db.patch("billingDaily", row._id, entry);
      counted.delete(row.currency);
    } else {
      await db.delete("billingDaily", row._id);
    }
  }
  for (const [currency, entry] of counted) {
    await db.insert("billingDaily", { workspaceId, day, currency, ...entry });
  }
  return rows.length;
}

/** Day totals for local days `from` to `to`, inclusive. */
export async function dailyRows(
  db: DatabaseReader,
  workspaceId: Id<"workspaces">,
  from: string,
  to: string
) {
  return await db
    .query("billingDaily")
    .withIndex("by_workspace_day_currency", (q) =>
      q.eq("workspaceId", workspaceId).gte("day", from).lte("day", to)
    )
    .take(2000);
}
