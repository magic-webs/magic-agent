import type { Doc, Id } from "../_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

export type SyncEvent =
  | { type: "send"; at: number; doc: Doc<"marketingSends"> }
  | { type: "send.deleted"; at: number; id: string }
  | { type: "contact"; at: number; doc: Doc<"contacts"> }
  | { type: "contact.deleted"; at: number; id: string };

export type SyncState = {
  events: Map<string, SyncEvent>;
  mirrored: Map<Id<"workspaces">, boolean>;
};

export const SYNC_BATCH = 200;

export function newSyncState(): SyncState {
  return { events: new Map(), mirrored: new Map() };
}

export async function isMirrored(
  db: GenericDatabaseReader<DataModel>,
  state: SyncState,
  workspaceId: Id<"workspaces">
) {
  let on = state.mirrored.get(workspaceId);
  if (on === undefined) {
    on = (await db.get("workspaces", workspaceId))?.marketingMirror === true;
    state.mirrored.set(workspaceId, on);
  }
  return on;
}

const CONTACT_FIELDS: Array<keyof Doc<"contacts">> = [
  "externalId",
  "channelType",
  "name",
  "phone",
  "email",
  "company",
  "birthday",
  "attributes",
  "source",
  "category",
  "tags",
  "audienceOnly",
  "optedOutAt",
  "optOutReason",
];

export function contactChanged(before: Doc<"contacts"> | null, after: Doc<"contacts"> | null) {
  if (!before || !after) return true;
  return CONTACT_FIELDS.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}
