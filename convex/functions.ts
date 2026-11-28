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
import { isRealChange, LOGGED_TABLES, logChange, type ActivityCtx } from "./lib/activity";
import { allows, INCIDENTAL_FIELDS, TABLE_AREAS } from "./lib/access";
import { ConvexError } from "convex/values";
import { reviewDueAt } from "./lib/reviewDue";
import { bumpAudienceCounts, tally } from "./lib/audienceCounts";
import { bumpLeadCount } from "./lib/leadStageCounts";
import { contactChanged, isMirrored, newSyncState, SYNC_BATCH, type SyncState } from "./lib/marketingSync";
import { rollUpBillingEvent } from "./lib/billingDaily";

type WrappedCtx = ActivityCtx & { sync: SyncState };

const triggers = new Triggers<DataModel, WrappedCtx>();
for (const table of Object.keys(LOGGED_TABLES) as TableNames[]) {
  triggers.register(table, (ctx, change) =>
    logChange(ctx, table, change as Parameters<typeof logChange>[2])
  );
}

// A human agent's role decides which areas they may change. Checked on the
// table rather than in each function, so no path into an area is missed.
for (const [table, areas] of Object.entries(TABLE_AREAS) as [TableNames, string[]][]) {
  triggers.register(table, async (ctx, change) => {
    const doc = (change.newDoc ?? change.oldDoc) as Record<string, unknown> | null;
    if (!doc) return;
    if (
      change.operation === "update" &&
      !isRealChange(
        table,
        change.oldDoc as never,
        change.newDoc as never,
        INCIDENTAL_FIELDS
      )
    ) {
      return;
    }
    const principal = await ctx.activity.principal();
    if (principal?.role !== "member") return;
    const allowed = areas.some((area) =>
      allows(principal.access, area as Parameters<typeof allows>[1], "edit")
    );
    if (!allowed) throw new ConvexError("Your role can only view this area.");
  });
}

triggers.register("conversations", async (ctx, change) => {
  if (!change.newDoc) return;
  const due = reviewDueAt(change.newDoc);
  if (due !== change.newDoc.reviewDueAt) {
    await ctx.innerDb.patch(change.id, { reviewDueAt: due });
  }
});

triggers.register("conversations", async (ctx, change) => {
  const before = change.oldDoc?.leadStageId;
  const after = change.newDoc?.leadStageId;
  if (before === after) return;
  if (before) await bumpLeadCount(ctx.innerDb, before, -1);
  if (after) await bumpLeadCount(ctx.innerDb, after, 1);
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

triggers.register("billingEvents", async (ctx, change) => {
  await rollUpBillingEvent(ctx.innerDb, change.oldDoc, change.newDoc);
});

triggers.register("workspaces", async (ctx, change) => {
  if (!change.oldDoc || !change.newDoc) return;
  if (change.oldDoc.timezone === change.newDoc.timezone) return;
  await ctx.scheduler.runAfter(0, internal.billingDaily.rebuildWorkspace, {
    workspaceId: change.id,
  });
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

triggers.register("marketingTemplates", async (ctx, change) => {
  const workspaceId = (change.newDoc ?? change.oldDoc)!.workspaceId;
  if (!(await isMirrored(ctx.innerDb, ctx.sync, workspaceId))) return;
  const at = Date.now();
  ctx.sync.events.set(
    `template:${change.id}`,
    change.newDoc
      ? { type: "template", at, doc: change.newDoc }
      : { type: "template.deleted", at, id: change.id }
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
