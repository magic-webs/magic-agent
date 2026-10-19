import { ConvexError, v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { escalationDepartment } from "./schema";
import { requireWorkspace } from "./lib/auth";
import { clampPause } from "./lib/shared";

const MAX_RULES = 50;

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const rules = await ctx.db
      .query("handoverRules")
      .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", args.workspaceId))
      .take(MAX_RULES);

    const out = [];
    for (const rule of rules) {
      const agent = rule.agentId ? await ctx.db.get("agents", rule.agentId) : null;
      const members = [];
      for (const id of rule.memberIds) {
        const member = await ctx.db.get("teamMembers", id);
        if (member) members.push({ _id: member._id, name: member.name, status: member.status });
      }
      out.push({ ...rule, agentName: agent?.botName ?? null, members });
    }
    return out;
  },
});

const ruleFields = {
  name: v.string(),
  agentId: v.optional(v.id("agents")),
  department: v.optional(escalationDepartment),
  memberIds: v.array(v.id("teamMembers")),
  pauseAgent: v.boolean(),
  pauseMinutes: v.optional(v.number()),
  enabled: v.boolean(),
};

async function checkedRule(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  fields: {
    name: string;
    agentId?: Id<"agents">;
    memberIds: Id<"teamMembers">[];
    pauseMinutes?: number;
  }
) {
  const name = fields.name.trim().slice(0, 80);
  if (!name) throw new ConvexError("Give the rule a name.");
  if (fields.agentId) {
    const agent = await ctx.db.get("agents", fields.agentId);
    if (!agent || agent.workspaceId !== workspaceId) {
      throw new ConvexError("That agent is not in this workspace.");
    }
  }
  const memberIds = [...new Set(fields.memberIds)];
  if (memberIds.length === 0) throw new ConvexError("Pick at least one team member.");
  for (const id of memberIds) {
    const member = await ctx.db.get("teamMembers", id);
    if (!member || member.workspaceId !== workspaceId) {
      throw new ConvexError("A picked team member is not in this workspace.");
    }
  }
  return {
    name,
    memberIds,
    pauseMinutes: fields.pauseMinutes === undefined ? undefined : clampPause(fields.pauseMinutes),
  };
}

export const create = mutation({
  args: { workspaceId: v.id("workspaces"), ...ruleFields },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const existing = await ctx.db
      .query("handoverRules")
      .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(MAX_RULES);
    if (existing.length >= MAX_RULES) {
      throw new ConvexError(`A workspace can have up to ${MAX_RULES} handover rules.`);
    }
    const { workspaceId, ...fields } = args;
    const now = Date.now();
    return await ctx.db.insert("handoverRules", {
      ...fields,
      ...(await checkedRule(ctx, workspaceId, fields)),
      workspaceId,
      order: (existing[0]?.order ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function ownRule(ctx: MutationCtx, ruleId: Id<"handoverRules">) {
  const rule = await ctx.db.get("handoverRules", ruleId);
  if (!rule) throw new ConvexError("That rule no longer exists.");
  await requireWorkspace(ctx, rule.workspaceId);
  return rule;
}

export const update = mutation({
  args: { ruleId: v.id("handoverRules"), ...ruleFields },
  handler: async (ctx, args) => {
    const rule = await ownRule(ctx, args.ruleId);
    const { ruleId, ...fields } = args;
    await ctx.db.patch(ruleId, {
      ...fields,
      ...(await checkedRule(ctx, rule.workspaceId, fields)),
      nextIndex: 0,
      updatedAt: Date.now(),
    });
  },
});

export const setEnabled = mutation({
  args: { ruleId: v.id("handoverRules"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await ownRule(ctx, args.ruleId);
    await ctx.db.patch(args.ruleId, { enabled: args.enabled, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { ruleId: v.id("handoverRules") },
  handler: async (ctx, args) => {
    await ownRule(ctx, args.ruleId);
    await ctx.db.delete(args.ruleId);
  },
});

export const move = mutation({
  args: { ruleId: v.id("handoverRules"), direction: v.union(v.literal("up"), v.literal("down")) },
  handler: async (ctx, args) => {
    const rule = await ownRule(ctx, args.ruleId);
    const rules = await ctx.db
      .query("handoverRules")
      .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", rule.workspaceId))
      .take(MAX_RULES);
    const at = rules.findIndex((row) => row._id === rule._id);
    const to = args.direction === "up" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= rules.length) return;
    [rules[at], rules[to]] = [rules[to], rules[at]];
    for (const [index, row] of rules.entries()) {
      if (row.order !== index) await ctx.db.patch(row._id, { order: index });
    }
  },
});

/**
 * The member an escalation goes to under the first matching rule, taking the
 * next turn on a rule shared by several. Away and inactive members are skipped.
 */
export async function pickHandover(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  agentId: Id<"agents"> | undefined,
  department: Doc<"conversations">["escalationDepartment"]
): Promise<{ rule: Doc<"handoverRules">; member: Doc<"teamMembers"> } | null> {
  const rules = await ctx.db
    .query("handoverRules")
    .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", conversation.workspaceId))
    .take(MAX_RULES);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.agentId && rule.agentId !== agentId) continue;
    if (rule.department && rule.department !== department) continue;

    const start = rule.nextIndex ?? 0;
    for (let step = 0; step < rule.memberIds.length; step++) {
      const index = (start + step) % rule.memberIds.length;
      const member = await ctx.db.get("teamMembers", rule.memberIds[index]);
      if (!member || member.workspaceId !== conversation.workspaceId) continue;
      if (member.status !== "active") continue;
      await ctx.db.patch(rule._id, { nextIndex: (index + 1) % rule.memberIds.length });
      return { rule, member };
    }
  }
  return null;
}
