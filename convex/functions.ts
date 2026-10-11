import {
  internalMutation as rawInternalMutation,
  mutation as rawMutation,
  type MutationCtx,
} from "./_generated/server";
import type { DataModel, TableNames } from "./_generated/dataModel";
import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import { getPrincipal, type Principal } from "./lib/auth";
import { LOGGED_TABLES, logChange, type ActivityCtx } from "./lib/activity";

const triggers = new Triggers<DataModel, ActivityCtx>();
for (const table of Object.keys(LOGGED_TABLES) as TableNames[]) {
  triggers.register(table, (ctx, change) =>
    logChange(ctx, table, change as Parameters<typeof logChange>[2])
  );
}

function withActivity(ctx: MutationCtx) {
  let principal: Promise<Principal | null> | undefined;
  return triggers.wrapDB({
    ...ctx,
    activity: {
      principal: () => (principal ??= getPrincipal(ctx)),
      written: 0,
    },
  });
}

// Every write a signed-in person makes on a logged table lands in the
// workspace's activity log. Scheduled and webhook work carries no identity,
// so it is never logged.
export const mutation = customMutation(rawMutation, customCtx(withActivity));
export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(withActivity)
);
