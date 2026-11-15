import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
  type MutationCtx,
} from "./_generated/server";
import type { DataModel, TableNames } from "./_generated/dataModel";
import { customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import { internal } from "./_generated/api";
import { getPrincipal, type Principal } from "./lib/auth";
import { LOGGED_TABLES, logChange, type ActivityCtx } from "./lib/activity";
import { reviewDueAt } from "./lib/reviewDue";
import { bumpAudienceCounts, tally } from "./lib/audienceCounts";
import { contactChanged, isMirrored, newSyncState, SYNC_BATCH, type SyncState } from "./lib/marketingSync";

type WrappedCtx = ActivityCtx & { sync: SyncState };

const triggers = new Triggers<DataModel, WrappedCtx>();
for (const table of Object.keys(LOGGED_TABLES) as TableNames[]) {
  triggers.register(table, (ctx, change) =>
    logChange(ctx, table, change as Parameters<typeof logChange>[2])
  );
}

triggers.register("conversations", async (ctx, change) => {
  if (!change.newDoc) return;
  const due = reviewDueAt(change.newDoc);
  if (due !== change.newDoc.reviewDueAt) {
    await ctx.innerDb.patch(change.id, { reviewDueAt: due });
  }
});

triggers.register("contacts", async (ctx, change) => {
  const before = tally(change.oldDoc);
  const after = tally(change.newDoc);
  const workspaceId = (change.newDoc ?? change.oldDoc)!.workspaceId;
  await bumpAudienceCounts(ctx.innerDb, workspaceId, {
    whatsapp: after.whatsapp - before.whatsapp,
    optedOut: after.optedOut - before.optedOut,
    withBirthday: after.withBirthday - before.withBirthday,
  });

  if (!contactChanged(change.oldDoc, change.newDoc)) return;
  if (!(await isMirrored(ctx.innerDb, ctx.sync, workspaceId))) return;
  const at = Date.now();
  ctx.sync.events.set(
    `contact:${change.id}`,
    change.newDoc
      ? { type: "contact", at, doc: change.newDoc }
      : { type: "contact.deleted", at, id: change.id }
  );
});

triggers.register("marketingSends", async (ctx, change) => {
  const workspaceId = (change.newDoc ?? change.oldDoc)!.workspaceId;
  if (!(await isMirrored(ctx.innerDb, ctx.sync, workspaceId))) return;
  const at = Date.now();
  ctx.sync.events.set(
    `send:${change.id}`,
    change.newDoc
      ? { type: "send", at, doc: change.newDoc }
      : { type: "send.deleted", at, id: change.id }
  );
});

async function flushSync(ctx: MutationCtx, state: SyncState) {
  if (state.events.size === 0) return;
  const events = [...state.events.values()];
  for (let i = 0; i < events.length; i += SYNC_BATCH) {
    await ctx.scheduler.runAfter(0, internal.marketingSync.forward, {
      events: events.slice(i, i + SYNC_BATCH),
      attempt: 0,
    });
  }
}

const withActivity = {
  args: {},
  input: (ctx: MutationCtx) => {
    let principal: Promise<Principal | null> | undefined;
    const sync = newSyncState();
    return {
      ctx: triggers.wrapDB({
        ...ctx,
        activity: {
          principal: () => (principal ??= getPrincipal(ctx)),
          written: 0,
        },
        sync,
      }),
      args: {},
      onSuccess: () => flushSync(ctx, sync),
    };
  },
};

// Every write a signed-in person makes on a logged table lands in the
// workspace's activity log. Scheduled and webhook work carries no identity,
// so it is never logged.
export const mutation = customMutation(rawMutation, withActivity);
export const internalMutation = customMutation(rawInternalMutation, withActivity);
