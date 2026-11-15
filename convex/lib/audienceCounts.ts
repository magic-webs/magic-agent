import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseWriter, QueryCtx } from "../_generated/server";
import { reachable } from "./audience";

const SHARDS = 8;

export type AudienceCounts = { whatsapp: number; optedOut: number; withBirthday: number };

export function tally(contact: Doc<"contacts"> | null): AudienceCounts {
  if (!contact) return { whatsapp: 0, optedOut: 0, withBirthday: 0 };
  const canSend = reachable(contact);
  return {
    whatsapp: canSend ? 1 : 0,
    optedOut: contact.channelType === "whatsapp" && contact.optedOutAt ? 1 : 0,
    withBirthday: canSend && !!contact.birthday && contact.birthday >= "01-01" ? 1 : 0,
  };
}

export async function bumpAudienceCounts(
  db: DatabaseWriter,
  workspaceId: Id<"workspaces">,
  delta: AudienceCounts
) {
  if (!delta.whatsapp && !delta.optedOut && !delta.withBirthday) return;
  const shard = Math.floor(Math.random() * SHARDS);
  const row = await db
    .query("audienceCounts")
    .withIndex("by_workspaceId_and_shard", (q) => q.eq("workspaceId", workspaceId).eq("shard", shard))
    .unique();
  if (row) {
    await db.patch("audienceCounts", row._id, {
      whatsapp: row.whatsapp + delta.whatsapp,
      optedOut: row.optedOut + delta.optedOut,
      withBirthday: row.withBirthday + delta.withBirthday,
    });
  } else {
    await db.insert("audienceCounts", { workspaceId, shard, ...delta });
  }
}

export async function audienceCountsFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<AudienceCounts> {
  const rows = await ctx.db
    .query("audienceCounts")
    .withIndex("by_workspaceId_and_shard", (q) => q.eq("workspaceId", workspaceId))
    .take(SHARDS * 2);
  const total = { whatsapp: 0, optedOut: 0, withBirthday: 0 };
  for (const row of rows) {
    total.whatsapp += row.whatsapp;
    total.optedOut += row.optedOut;
    total.withBirthday += row.withBirthday;
  }
  return total;
}
