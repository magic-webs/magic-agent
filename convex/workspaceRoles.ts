// A workspace's own roles for its human agents. See convex/lib/access.ts for
// what a role decides and where it is enforced.
//
// Managed by the owner only: a human agent changing roles could open any area
// to themselves.

import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { requireOwner, requireWorkspace } from "./lib/auth";
import { AREAS, STARTER_ROLES } from "./lib/access";
import { areaLevel, chatScope, workspaceArea } from "./schema/validators";

const MAX_ROLES = 20;

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const roles = await ctx.db
      .query("workspaceRoles")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(MAX_ROLES + 5);
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return roles
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((role) => ({
        ...role,
        memberCount: members.filter((member) => member.accessRoleId === role._id).length,
      }));
  },
});

/** Manager and Agent, the first time the owner opens Roles. */
export const ensureStarters = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const existing = await ctx.db
      .query("workspaceRoles")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
    if (existing) return null;
    const now = Date.now();
    for (const role of STARTER_ROLES) {
      await ctx.db.insert("workspaceRoles", {
        workspaceId: args.workspaceId,
        ...role,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const save = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    roleId: v.optional(v.id("workspaceRoles")),
    name: v.string(),
    description: v.optional(v.string()),
    chats: chatScope,
    areas: v.array(v.object({ area: workspaceArea, level: areaLevel })),
    canAssignOthers: v.boolean(),
    canDeleteChats: v.boolean(),
    canExport: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.workspaceId);
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) throw new ConvexError("Give the role a name.");

    const roles = await ctx.db
      .query("workspaceRoles")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(MAX_ROLES + 5);
    if (
      roles.some(
        (role) => role._id !== args.roleId && role.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      throw new ConvexError(`There is already a role called "${name}".`);
    }

    const areas = AREAS.map((area) => ({
      area,
      level: args.areas.find((row) => row.area === area)?.level ?? ("none" as const),
    }));
    const fields = {
      name,
      description: args.description?.trim() || undefined,
      chats: args.chats,
      areas,
      canAssignOthers: args.canAssignOthers,
      canDeleteChats: args.canDeleteChats,
      canExport: args.canExport,
      updatedAt: Date.now(),
    };

    if (args.roleId) {
      const role = roles.find((row) => row._id === args.roleId);
      if (!role) throw new ConvexError("Role not found.");
      await ctx.db.patch("workspaceRoles", role._id, fields);
      return role._id;
    }
    if (roles.length >= MAX_ROLES) {
      throw new ConvexError(`A workspace can have up to ${MAX_ROLES} roles.`);
    }
    return await ctx.db.insert("workspaceRoles", {
      workspaceId: args.workspaceId,
      ...fields,
      createdAt: Date.now(),
    });
  },
});

/**
 * Refused while anyone holds it: falling back to no role would quietly give
 * them full access.
 */
export const remove = mutation({
  args: { roleId: v.id("workspaceRoles") },
  handler: async (ctx, args) => {
    const role = await ctx.db.get("workspaceRoles", args.roleId);
    if (!role) return null;
    await requireOwner(ctx, role.workspaceId);
    const holders = await ctx.db
      .query("teamMembers")
      .withIndex("by_accessRoleId", (q) => q.eq("accessRoleId", role._id))
      .take(1);
    if (holders.length > 0) {
      throw new ConvexError("Move the human agents with this role to another one first.");
    }
    await ctx.db.delete("workspaceRoles", role._id);
    return null;
  },
});

export const setMemberRole = mutation({
  args: {
    memberId: v.id("teamMembers"),
    roleId: v.union(v.id("workspaceRoles"), v.null()),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db.get("teamMembers", args.memberId);
    if (!member) throw new ConvexError("Human agent not found");
    await requireOwner(ctx, member.workspaceId);
    if (member.isOwner) throw new ConvexError("The admin always has full access.");
    if (args.roleId) {
      const role = await ctx.db.get("workspaceRoles", args.roleId);
      if (!role || role.workspaceId !== member.workspaceId) {
        throw new ConvexError("Role not found.");
      }
    }
    await ctx.db.patch("teamMembers", member._id, {
      accessRoleId: args.roleId ?? undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
