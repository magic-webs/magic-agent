import type { Doc } from "../_generated/dataModel";

export function reviewDueAt(row: Doc<"conversations">): number | undefined {
  if (row.status !== "open" || row.markedBot || row.marketingOnly !== undefined) return undefined;
  if (row.messageCount === 0 || (row.reviewedAt ?? 0) >= row.lastMessageAt) return undefined;
  return row.lastMessageAt;
}
