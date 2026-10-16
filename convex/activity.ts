import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AuthError, requireStaff } from "./lib/auth";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 500;

type Actor = { actorId: string; actorLabel: string; actorRole: string };

function actorNames(ctx: QueryCtx) {
  const cache = new Map<string, Promise<string | null>>();
  const lookup = async ({ actorId, actorRole }: Actor) => {
    if (actorRole === "admin") {
      const id = ctx.db.normalizeId("admins", actorId);
      const admin = id && (await ctx.db.get("admins", id));
      return admin ? admin.name?.trim() || null : null;
    }
    if (actorRole === "user") {
      const id = ctx.db.normalizeId("users", actorId);
      const user = id && (await ctx.db.get("users", id));
      return user ? user.name?.trim() || null : null;
    }
    if (actorRole === "member") {
      const id = ctx.db.normalizeId("teamMembers", actorId);
      const member = id && (await ctx.db.get("teamMembers", id));
      return member?.name.trim() || null;
    }
    const id = ctx.db.normalizeId("workspaces", actorId);
    const workspace = id && (await ctx.db.get("workspaces", id));
    return workspace?.name.trim() || null;
  };
  return async (actor: Actor) => {
    const key = `${actor.actorRole}|${actor.actorId}`;
    if (!cache.has(key)) cache.set(key, lookup(actor));
    return (await cache.get(key)) ?? actor.actorLabel;
  };
}

export const list = query({
  args: {
    workspaceId: v.optional(v.id("workspaces")),
    actorId: v.optional(v.string()),
    entity: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const principal = await requireStaff(ctx);
    if (principal.workspaceIds) {
      if (!args.workspaceId) {
        return { page: [], isDone: true, continueCursor: "" };
      }
      if (!principal.workspaceIds.includes(args.workspaceId)) {
        throw new AuthError("You do not have access to this workspace.");
      }
    }

    const { workspaceId, actorId } = args;
    const base = ctx.db.query("activityLogs");
    const indexed =
      workspaceId && actorId
        ? base.withIndex("by_workspace_and_actorId", (q) =>
            q.eq("workspaceId", workspaceId).eq("actorId", actorId)
          )
        : workspaceId
          ? base.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          : actorId
            ? base.withIndex("by_actorId", (q) => q.eq("actorId", actorId))
            : base;
    const ordered = indexed.order("desc");
    const result = await (args.entity
      ? ordered.filter((q) => q.eq(q.field("entity"), args.entity!))
      : ordered
    ).paginate(args.paginationOpts);

    const names = new Map<Id<"workspaces">, string>();
    for (const row of result.page) {
      if (names.has(row.workspaceId)) continue;
      const workspace = await ctx.db.get("workspaces", row.workspaceId);
      names.set(row.workspaceId, workspace?.name ?? "Deleted workspace");
    }
    const nameOf = actorNames(ctx);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => ({
          ...row,
          actorLabel: await nameOf(row),
          workspaceName: names.get(row.workspaceId)!,
        }))
      ),
    };
  },
});

/** Who has made changes lately, for the person filter. */
export const actors = query({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args) => {
    const principal = await requireStaff(ctx);
    const { workspaceId } = args;
    if (principal.workspaceIds && (!workspaceId || !principal.workspaceIds.includes(workspaceId))) {
      return [];
    }
    const rows = await (workspaceId
      ? ctx.db
          .query("activityLogs")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      : ctx.db.query("activityLogs")
    )
      .order("desc")
      .take(500);
    const seen = new Map<string, Actor>();
    for (const row of rows) {
      if (!seen.has(row.actorId)) {
        seen.set(row.actorId, {
          actorId: row.actorId,
          actorLabel: row.actorLabel,
          actorRole: row.actorRole,
        });
      }
    }
    const nameOf = actorNames(ctx);
    return await Promise.all(
      [...seen.values()].map(async (actor) => ({
        ...actor,
        actorLabel: await nameOf(actor),
      }))
    );
  },
});

export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("activityLogs")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.activity.prune, {});
    }
  },
});
