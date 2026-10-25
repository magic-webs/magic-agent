import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./functions";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireModify, requireScope } from "./lib/auth";
import { ACTIVE_STATUSES, DAY, SUPPORT_TYPES, ticketRef } from "./lib/support";
import { logEvent, notifyStaff, readSettings } from "./support";

const hours = v.object({
  low: v.number(),
  normal: v.number(),
  high: v.number(),
  urgent: v.number(),
});

export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireScope(ctx, "support");
    return await readSettings(ctx);
  },
});

export const saveSettings = mutation({
  args: {
    firstResponseHours: hours,
    resolutionHours: hours,
    autoResolveWaitingDays: v.number(),
    autoCloseResolvedDays: v.number(),
    reopenDays: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    for (const value of [
      ...Object.values(args.firstResponseHours),
      ...Object.values(args.resolutionHours),
    ]) {
      if (!(value > 0 && value <= 24 * 90)) throw new ConvexError("Targets are between 1 hour and 90 days.");
    }
    for (const days of [args.autoResolveWaitingDays, args.autoCloseResolvedDays, args.reopenDays]) {
      if (!(days >= 1 && days <= 90)) throw new ConvexError("Days are between 1 and 90.");
    }
    const existing = await ctx.db.query("supportSettings").first();
    const row = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("supportSettings", row);
  },
});

// ------------------------------------------------------------ canned replies

export const replies = query({
  args: {},
  handler: async (ctx) => {
    await requireScope(ctx, "support");
    const rows = await ctx.db.query("supportReplies").withIndex("by_title").take(200);
    return rows.map((row) => ({ _id: row._id, title: row.title, body: row.body }));
  },
});

export const saveReply = mutation({
  args: { replyId: v.optional(v.id("supportReplies")), title: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireModify(ctx, "support");
    const title = args.title.trim().slice(0, 80);
    const body = args.body.trim().slice(0, 5000);
    if (!title || !body) throw new ConvexError("A canned reply needs a title and text.");
    const now = Date.now();
    if (args.replyId) {
      await ctx.db.patch(args.replyId, { title, body, updatedAt: now });
      return args.replyId;
    }
    return await ctx.db.insert("supportReplies", {
      title,
      body,
      createdBy: principal.adminId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteReply = mutation({
  args: { replyId: v.id("supportReplies") },
  handler: async (ctx, args) => {
    await requireModify(ctx, "support");
    await ctx.db.delete(args.replyId);
  },
});

// ---------------------------------------------------------------- reporting

export const report = query({
  args: { from: v.number() },
  handler: async (ctx, args) => {
    await requireScope(ctx, "support");
    const tickets = await ctx.db
      .query("supportTickets")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.from))
      .take(3000);
    const backlog = (
      await Promise.all(
        ACTIVE_STATUSES.map((status) =>
          ctx.db
            .query("supportTickets")
            .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
            .take(1000)
        )
      )
    ).flat();

    const average = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const responded = tickets.filter((ticket) => ticket.firstResponseAt);
    const resolved = tickets.filter((ticket) => ticket.resolvedAt);
    const withTarget = responded.filter((ticket) => ticket.firstResponseDueAt);
    const rated = tickets.filter((ticket) => ticket.rating);

    const byDay = new Map<string, number>();
    for (const ticket of tickets) {
      const day = new Date(ticket.createdAt).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    const byWorkspace = new Map<string, number>();
    for (const ticket of tickets) {
      byWorkspace.set(ticket.workspaceId, (byWorkspace.get(ticket.workspaceId) ?? 0) + 1);
    }
    const topWorkspaces = await Promise.all(
      [...byWorkspace.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(async ([id, count]) => {
          const workspace = await ctx.db.get("workspaces", id as Doc<"workspaces">["_id"]);
          return { name: workspace?.name ?? "Deleted workspace", count };
        })
    );

    const agents = new Map<string, { name: string; open: number; resolved: number; ratings: number[] }>();
    const agent = (ticket: Doc<"supportTickets">) => {
      const key = ticket.assigneeId ?? "unassigned";
      if (!agents.has(key)) {
        agents.set(key, { name: ticket.assigneeName ?? "Unassigned", open: 0, resolved: 0, ratings: [] });
      }
      return agents.get(key)!;
    };
    for (const ticket of backlog) agent(ticket).open += 1;
    for (const ticket of resolved) agent(ticket).resolved += 1;
    for (const ticket of rated) agent(ticket).ratings.push(ticket.rating!);

    return {
      total: tickets.length,
      backlog: backlog.length,
      unassigned: backlog.filter((ticket) => !ticket.assigneeId).length,
      breached: backlog.filter((ticket) => ticket.slaBreached).length,
      avgFirstResponseMs: average(responded.map((ticket) => ticket.firstResponseAt! - ticket.createdAt)),
      avgResolutionMs: average(resolved.map((ticket) => ticket.resolvedAt! - ticket.createdAt)),
      firstResponseHitRate: withTarget.length
        ? withTarget.filter((ticket) => ticket.firstResponseAt! <= ticket.firstResponseDueAt!).length /
          withTarget.length
        : null,
      csat: average(rated.map((ticket) => ticket.rating!)),
      csatCount: rated.length,
      byType: SUPPORT_TYPES.map((type) => ({
        type: type.value,
        label: type.label,
        count: tickets.filter((ticket) => ticket.type === type.value).length,
      })),
      byDay: [...byDay.entries()].sort().map(([day, count]) => ({ day, count })),
      topWorkspaces,
      agents: [...agents.values()].map((row) => ({
        name: row.name,
        open: row.open,
        resolved: row.resolved,
        csat: average(row.ratings),
      })),
      backlogAge: backlog.map((ticket) => ticket.createdAt),
    };
  },
});

// -------------------------------------------------------------------- sweep

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const settings = await readSettings(ctx);
    const now = Date.now();

    for (const status of ["open", "in_progress"] as const) {
      const tickets = await ctx.db
        .query("supportTickets")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
        .take(500);
      for (const ticket of tickets) {
        if (ticket.slaBreached) continue;
        const missedResponse =
          !ticket.firstResponseAt && ticket.firstResponseDueAt && ticket.firstResponseDueAt < now;
        const missedResolution = ticket.resolutionDueAt && ticket.resolutionDueAt < now;
        if (!missedResponse && !missedResolution) continue;
        await ctx.db.patch(ticket._id, { slaBreached: true });
        const what = missedResponse ? "first response" : "resolution";
        await logEvent(ctx, ticket, "sla_breached", "System", what);
        await notifyStaff(
          ctx,
          ticket,
          `SLA missed on ${ticketRef(ticket.number)}`,
          `The ${what} target for this ${ticket.priority} ticket has passed.\n\n${ticket.subject}`,
          ticket.assigneeId ? [ticket.assigneeId] : undefined
        );
      }
    }

    const waiting = await ctx.db
      .query("supportTickets")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "waiting_client").lt("updatedAt", now - settings.autoResolveWaitingDays * DAY)
      )
      .take(200);
    for (const ticket of waiting) {
      await ctx.db.patch(ticket._id, { status: "resolved", resolvedAt: now, updatedAt: now });
      await logEvent(ctx, ticket, "status", "System", "resolved — no reply");
      await ctx.scheduler.runAfter(0, internal.supportAccess.endAccess, {
        ticketId: ticket._id,
        reason: "revoked",
        actorName: "System",
      });
    }

    const resolved = await ctx.db
      .query("supportTickets")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "resolved").lt("updatedAt", now - settings.autoCloseResolvedDays * DAY)
      )
      .take(200);
    for (const ticket of resolved) {
      await ctx.db.patch(ticket._id, { status: "closed", closedAt: now, updatedAt: now });
      await logEvent(ctx, ticket, "status", "System", "closed");
    }

    await ctx.runMutation(internal.support.pruneViewers, {});
  },
});
