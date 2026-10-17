import { ConvexError, v } from "convex/values";
import {
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { requireScope, requireSignedIn } from "./lib/auth";
import { userWorkspaceSlugs } from "./authDb";
import { logoSrcFor } from "./lib/branding";

async function checkedWorkspaces(
  ctx: MutationCtx,
  workspaceIds: Id<"workspaces">[]
): Promise<Id<"workspaces">[]> {
  const unique = [...new Set(workspaceIds)];
  if (unique.length === 0) throw new ConvexError("Pick at least one workspace.");
  for (const id of unique) {
    if (!(await ctx.db.get("workspaces", id))) {
      throw new ConvexError("One of the selected workspaces no longer exists.");
    }
  }
  return unique;
}

async function endSessionsAndFactor(ctx: MutationCtx, userId: Id<"users">) {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) await ctx.db.delete(session._id);
  const factor = await ctx.db
    .query("twoFactor")
    .withIndex("by_principal", (q) => q.eq("principal", `user|${userId}`))
    .unique();
  if (factor) await ctx.db.delete(factor._id);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireScope(ctx, "users");
    const users = await ctx.db.query("users").order("desc").take(500);
    const factors = await ctx.db.query("twoFactor").collect();
    const protectedLogins = new Set(
      factors.filter((f) => f.status === "active").map((f) => f.principal)
    );
    return users.map((user) => ({
      _id: user._id,
      email: user.email,
      name: user.name,
      workspaceIds: user.workspaceIds,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt ?? null,
      twoFactor: protectedLogins.has(`user|${user._id}`),
    }));
  },
});

/** The caller's own workspaces, for the switcher in the sidebar footer. */
export const myWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireSignedIn(ctx);
    const listed = async (rows: (Doc<"workspaces"> | null)[]) => {
      const out = [];
      for (const workspace of rows) {
        if (!workspace) continue;
        out.push({
          _id: workspace._id,
          name: workspace.name,
          slug: workspace.slug,
          logoSrc: await logoSrcFor(ctx, workspace),
        });
      }
      return out;
    };

    // The platform team, by what their role reaches. A full administrator
    // works from the console rather than one workspace at a time.
    if (principal.role === "admin") {
      if (principal.scopes === null) return [];
      const rows = principal.workspaceIds
        ? await Promise.all(principal.workspaceIds.map((id) => ctx.db.get("workspaces", id)))
        : await ctx.db.query("workspaces").collect();
      return await listed(
        rows
          .filter((row) => row?.status !== "archived")
          .sort((a, b) => (a?.name ?? "").localeCompare(b?.name ?? ""))
      );
    }

    if (principal.role !== "user") return [];
    const slugs = new Set(await userWorkspaceSlugs(ctx, principal.workspaceIds));
    const rows = await Promise.all(principal.workspaceIds.map((id) => ctx.db.get("workspaces", id)));
    return await listed(rows.filter((row) => row && slugs.has(row.slug)));
  },
});

export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    workspaceIds: v.array(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    await requireScope(ctx, "users");
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new ConvexError("User not found.");
    await ctx.db.patch(user._id, {
      name: args.name?.trim() || undefined,
      workspaceIds: await checkedWorkspaces(ctx, args.workspaceIds),
    });
    return null;
  },
});

export const remove = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireScope(ctx, "users");
    const user = await ctx.db.get("users", args.userId);
    if (!user) return null;
    await endSessionsAndFactor(ctx, user._id);
    await ctx.db.delete(user._id);
    return null;
  },
});

export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique(),
});

export const insert = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    passwordHash: v.string(),
    workspaceIds: v.array(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    await requireScope(ctx, "users");
    const clash =
      (await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique()) ??
      (await ctx.db
        .query("admins")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique()) ??
      (await ctx.db
        .query("memberCredentials")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first());
    if (clash) throw new ConvexError("That email address is already registered.");
    return await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      passwordHash: args.passwordHash,
      workspaceIds: await checkedWorkspaces(ctx, args.workspaceIds),
      createdAt: Date.now(),
    });
  },
});

export const setPassword = internalMutation({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    await requireScope(ctx, "users");
    const user = await ctx.db.get("users", args.userId);
    if (!user) throw new ConvexError("User not found.");
    await ctx.db.patch(user._id, { passwordHash: args.passwordHash });
    await endSessionsAndFactor(ctx, user._id);
    return null;
  },
});
