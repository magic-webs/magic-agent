import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { zonedParts } from "./marketing";

const READ_HOURS_KEPT = 7;
const MIN_READS_FOR_HABIT = 2;

/** The hour they read most often, the latest of any tie; none until there is a habit. */
export function bestHourOf(hours: number[]): number | undefined {
  if (hours.length < MIN_READS_FOR_HABIT) return undefined;
  const counts = new Map<number, number>();
  for (const hour of hours) counts.set(hour, (counts.get(hour) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const hour of hours) {
    const count = counts.get(hour)!;
    if (count >= bestCount) {
      best = hour;
      bestCount = count;
    }
  }
  return bestCount >= MIN_READS_FOR_HABIT ? best : undefined;
}

export function withReadHour(
  contact: Pick<Doc<"contacts">, "readHours">,
  hour: number
): { readHours: number[]; bestHour: number | undefined } {
  const readHours = [...(contact.readHours ?? []), hour].slice(-READ_HOURS_KEPT);
  return { readHours, bestHour: bestHourOf(readHours) };
}

export async function noteContactRead(ctx: MutationCtx, contactId: Id<"contacts">, at: number) {
  const contact = await ctx.db.get("contacts", contactId);
  if (!contact) return;
  const workspace = await ctx.db.get("workspaces", contact.workspaceId);
  const { hour } = zonedParts(at, workspace?.timezone ?? "UTC");
  await ctx.db.patch("contacts", contact._id, {
    lastReadAt: Math.max(contact.lastReadAt ?? 0, at),
    ...withReadHour(contact, hour),
  });
}

export async function noteContactActivity(
  ctx: MutationCtx,
  contactId: Id<"contacts">,
  field: "lastRepliedAt" | "lastOrderAt",
  at: number
) {
  const contact = await ctx.db.get("contacts", contactId);
  if (!contact || (contact[field] ?? 0) >= at) return;
  await ctx.db.patch("contacts", contact._id, { [field]: at });
}
