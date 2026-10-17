// Platform roles: what a member of the platform team can open in the admin
// console, and whether that covers every workspace or only the ones assigned
// to them. Administrators are not a role here — they open everything.

import { ConvexError, v, type Infer } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import type { Id } from "./_generated/dataModel";
import { adminScope } from "./schema";
import { requireAdmin } from "./lib/auth";

const roleFields = {
  name: v.string(),
  description: v.optional(v.string()),
  scopes: v.array(adminScope),
  allWorkspaces: v.boolean(),
};

type RoleFields = {
  name: string;
  description?: string;
  scopes: Infer<typeof adminScope>[];
  allWorkspaces: boolean;
};

async function checked(
  ctx: MutationCtx,
  fields: RoleFields,
  except?: Id<"adminRoles">
) {
  const name = fields.name.trim();
  if (!name) throw new ConvexError("Name the role.");
  if (name.length > 40) throw new ConvexError("Keep the role name under 40 characters.");
  if (name.toLowerCase() === "admin") {
    throw new ConvexError("Admin is built in. Choose another name.");
  }
  const clash = await ctx.db
    .query("adminRoles")
    .withIndex("by_name", (q) => q.eq("name", name))
    .first();
  if (clash && clash._id !== except) throw new ConvexError("A role with that name already exists.");

  const scopes = [...new Set(fields.scopes)];
  if (scopes.length === 0) throw new ConvexError("Give the role at least one area.");

  const description = fields.description?.trim().slice(0, 200) || undefined;
  return { name, description, scopes, allWorkspaces: fields.allWorkspaces };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const roles = await ctx.db.query("adminRoles").collect();
    const admins = await ctx.db.query("admins").collect();
    const counts = new Map<string, number>();
    for (const admin of admins) {
      if (admin.role !== "member" || !admin.roleId) continue;
      counts.set(admin.roleId, (counts.get(admin.roleId) ?? 0) + 1);
    }
    return roles
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((role) => ({ ...role, memberCount: counts.get(role._id) ?? 0 }));
  },
});

export const create = mutation({
  args: roleFields,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const now = Date.now();
    return await ctx.db.insert("adminRoles", {
      ...(await checked(ctx, args)),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: { roleId: v.id("adminRoles"), ...roleFields },
  handler: async (ctx, { roleId, ...fields }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get("adminRoles", roleId))) throw new ConvexError("Role not found.");
    await ctx.db.patch(roleId, {
      ...(await checked(ctx, fields, roleId)),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { roleId: v.id("adminRoles") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const holder = await ctx.db
      .query("admins")
      .withIndex("by_role", (q) => q.eq("roleId", args.roleId))
      .first();
    if (holder) throw new ConvexError("Move everyone off this role before deleting it.");
    await ctx.db.delete(args.roleId);
    return null;
  },
});
