import { ConvexError, v } from "convex/values";
import { action, internalQuery, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { getPrincipal, principalKey, requireOwner, requireWorkspace } from "./lib/auth";
import { openSecret, sealSecret } from "./lib/secretBox";
import { ACTIVE_STATUSES, SUPPORT_LIMITS, ticketRef } from "./lib/support";
import { logEvent, notifyClient, notifyStaff, requireStaffTicket } from "./support";

const HOUR = 60 * 60 * 1000;
const VISIT_GAP_MS = 30 * 60 * 1000;

async function ownerName(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const principal = await requireOwner(ctx, workspaceId);
  if (principal.role === "admin") throw new ConvexError("Only the client can decide on access.");
  return principal.label;
}

async function wipeVault(ctx: MutationCtx, ticket: Doc<"supportTickets">, actorName: string) {
  const entries = await ctx.db
    .query("supportVault")
    .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
    .take(20);
  for (const entry of entries) await ctx.db.delete(entry._id);
  if (entries.length > 0) await logEvent(ctx, ticket, "vault_wiped", actorName);
}

export const grant = mutation({
  args: { ticketId: v.id("supportTickets"), hours: v.number() },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket) throw new ConvexError("Ticket not found.");
    const name = await ownerName(ctx, ticket.workspaceId);
    if (!ACTIVE_STATUSES.includes(ticket.status)) {
      throw new ConvexError("Access can only be granted on an open ticket.");
    }
    const hours = Math.round(args.hours);
    if (hours < 1 || hours > SUPPORT_LIMITS.accessHours) {
      throw new ConvexError(`Grant between 1 and ${SUPPORT_LIMITS.accessHours} hours.`);
    }
    const now = Date.now();
    const accessUntil = now + hours * HOUR;
    await ctx.db.patch(ticket._id, {
      accessUntil,
      accessGrantedAt: now,
      accessGrantedBy: name,
      accessRequestedAt: undefined,
      accessRequestNote: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(accessUntil, internal.supportAccess.expire, {
      ticketId: ticket._id,
      until: accessUntil,
    });
    await logEvent(ctx, ticket, "access_granted", name, `${hours} h`);
    await notifyStaff(
      ctx,
      ticket,
      `${name} granted access on ${ticketRef(ticket.number)}`,
      `Your access to the workspace is open for ${hours} hours.`,
      ticket.assigneeId ? [ticket.assigneeId] : undefined
    );
  },
});

export const revoke = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket) throw new ConvexError("Ticket not found.");
    const name = await ownerName(ctx, ticket.workspaceId);
    await closeAccess(ctx, ticket, "revoked", name);
  },
});

export const decline = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket) throw new ConvexError("Ticket not found.");
    const name = await ownerName(ctx, ticket.workspaceId);
    if (!ticket.accessRequestedAt) return;
    await ctx.db.patch(ticket._id, {
      accessRequestedAt: undefined,
      accessRequestNote: undefined,
      updatedAt: Date.now(),
    });
    await logEvent(ctx, ticket, "access_declined", name);
    await notifyStaff(
      ctx,
      ticket,
      `${name} declined access on ${ticketRef(ticket.number)}`,
      ticket.subject,
      ticket.assigneeId ? [ticket.assigneeId] : undefined
    );
  },
});

export const request = mutation({
  args: { ticketId: v.id("supportTickets"), note: v.string() },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireStaffTicket(ctx, args.ticketId, "modify");
    if (ticket.accessUntil) throw new ConvexError("Access is already granted.");
    const note = args.note.trim().slice(0, 500);
    if (!note) throw new ConvexError("Say what you need access for.");
    const admin = await ctx.db.get("admins", principal.adminId);
    const name = admin?.name?.trim() || admin?.email || "Support";
    const now = Date.now();
    await ctx.db.patch(ticket._id, {
      accessRequestedAt: now,
      accessRequestNote: note,
      clientUnread: true,
      updatedAt: now,
      ...(ticket.assigneeId ? {} : { assigneeId: principal.adminId, assigneeName: name }),
    });
    await logEvent(ctx, ticket, "access_requested", name, note);
    await notifyClient(
      ctx,
      ticket,
      `Support is asking for access on ${ticketRef(ticket.number)}`,
      `${name}: ${note}\n\nOpen the ticket to approve or decline. Access ends on its own when the time you pick runs out.`
    );
  },
});

async function closeAccess(
  ctx: MutationCtx,
  ticket: Doc<"supportTickets">,
  reason: "revoked" | "expired",
  actorName: string
) {
  await wipeVault(ctx, ticket, actorName);
  if (!ticket.accessUntil) return;
  await ctx.db.patch(ticket._id, {
    accessUntil: undefined,
    accessGrantedAt: undefined,
    accessGrantedBy: undefined,
    updatedAt: Date.now(),
  });
  await logEvent(ctx, ticket, reason === "expired" ? "access_expired" : "access_revoked", actorName);
  if (reason === "expired") {
    await notifyClient(
      ctx,
      ticket,
      `Support access ended on ${ticketRef(ticket.number)}`,
      "The time you granted ran out, so support can no longer open your workspace."
    );
  }
}

export const endAccess = internalMutation({
  args: {
    ticketId: v.id("supportTickets"),
    reason: v.union(v.literal("revoked"), v.literal("expired")),
    actorName: v.string(),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (ticket) await closeAccess(ctx, ticket, args.reason, args.actorName);
  },
});

export const expire = internalMutation({
  args: { ticketId: v.id("supportTickets"), until: v.number() },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket || ticket.accessUntil !== args.until) return;
    await closeAccess(ctx, ticket, "expired", "System");
  },
});

export const recordVisit = mutation({
  args: { workspaceId: v.id("workspaces"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const principal = await getPrincipal(ctx);
    if (principal?.role !== "admin") return;
    const tickets = await ctx.db
      .query("supportTickets")
      .withIndex("by_workspace_and_status", (q) => q.eq("workspaceId", args.workspaceId))
      .take(200);
    const active = tickets.filter(
      (ticket) =>
        ACTIVE_STATUSES.includes(ticket.status) &&
        (ticket.assigneeId === principal.adminId || ticket.accessUntil)
    );
    if (active.length === 0) return;
    const admin = await ctx.db.get("admins", principal.adminId);
    const name = admin?.name?.trim() || admin?.email || "Support";
    const now = Date.now();
    for (const ticket of active) {
      const recent = await ctx.db
        .query("supportEvents")
        .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
        .order("desc")
        .take(20);
      const seen = recent.find(
        (event) =>
          event.kind === "workspace_opened" &&
          event.actorName === name &&
          event.createdAt > now - VISIT_GAP_MS
      );
      if (seen && !args.reason) continue;
      const how =
        ticket.accessUntil && ticket.assigneeId === principal.adminId
          ? "with the access you granted"
          : principal.scopes === null
            ? "as an administrator"
            : "as the account manager";
      await logEvent(
        ctx,
        ticket,
        "workspace_opened",
        name,
        args.reason ? `${how} — ${args.reason.trim().slice(0, 300)}` : how
      );
    }
  },
});

// ------------------------------------------------------------------- vault

export const vaultContext = internalQuery({
  args: { ticketId: v.id("supportTickets"), entryId: v.optional(v.id("supportVault")) },
  handler: async (ctx, args) => {
    const principal = await getPrincipal(ctx);
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!principal || !ticket) return null;
    const entry = args.entryId ? await ctx.db.get("supportVault", args.entryId) : null;
    let label = principal.label;
    if (principal.role === "admin") {
      const admin = await ctx.db.get("admins", principal.adminId);
      label = admin?.name?.trim() || admin?.email || label;
    }
    return {
      principal: { ...principal, key: principalKey(principal) },
      label,
      ticket,
      entry: entry && entry.ticketId === ticket._id ? entry : null,
    };
  },
});

export const vaultAdd = action({
  args: {
    ticketId: v.id("supportTickets"),
    label: v.string(),
    username: v.optional(v.string()),
    secret: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.supportAccess.vaultContext, {
      ticketId: args.ticketId,
    });
    if (!context) throw new ConvexError("Ticket not found.");
    const { principal, ticket } = context;
    const owns =
      (principal.role === "workspace" && principal.workspaceId === ticket.workspaceId) ||
      (principal.role === "user" && principal.workspaceIds.includes(ticket.workspaceId));
    if (!owns) throw new ConvexError("Only the workspace's own login can share credentials.");
    if (!ticket.accessUntil) {
      throw new ConvexError("Grant access first. Shared credentials are wiped when it ends.");
    }
    const label = args.label.trim().slice(0, 80);
    const secret = args.secret.trim();
    if (!label || !secret) throw new ConvexError("Name the account and enter the password.");
    if (secret.length > 2000) throw new ConvexError("That secret is too long.");
    await ctx.runMutation(internal.supportAccess.vaultStore, {
      ticketId: ticket._id,
      label,
      username: args.username?.trim().slice(0, 200) || undefined,
      sealed: await sealSecret(secret),
      note: args.note?.trim().slice(0, 500) || undefined,
      createdBy: context.label,
    });
  },
});

export const vaultStore = internalMutation({
  args: {
    ticketId: v.id("supportTickets"),
    label: v.string(),
    username: v.optional(v.string()),
    sealed: v.string(),
    note: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket?.accessUntil) throw new ConvexError("Access has ended.");
    const count = (
      await ctx.db
        .query("supportVault")
        .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
        .take(20)
    ).length;
    if (count >= 10) throw new ConvexError("Share up to 10 credentials on one ticket.");
    await ctx.db.insert("supportVault", {
      ...args,
      workspaceId: ticket.workspaceId,
      createdAt: Date.now(),
    });
    await logEvent(ctx, ticket, "vault_added", args.createdBy, args.label);
    await notifyStaff(
      ctx,
      ticket,
      `Credentials shared on ${ticketRef(ticket.number)}`,
      `${args.createdBy} shared "${args.label}".`,
      ticket.assigneeId ? [ticket.assigneeId] : undefined
    );
  },
});

export const vaultDelete = mutation({
  args: { entryId: v.id("supportVault") },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get("supportVault", args.entryId);
    if (!entry) return;
    await requireOwner(ctx, entry.workspaceId);
    await ctx.db.delete(entry._id);
  },
});

export const vaultReveal = action({
  args: { ticketId: v.id("supportTickets"), entryId: v.id("supportVault") },
  handler: async (ctx, args): Promise<{ username: string | null; secret: string }> => {
    const context = await ctx.runQuery(internal.supportAccess.vaultContext, args);
    if (!context?.entry) throw new ConvexError("That credential is gone.");
    const { principal, ticket, entry } = context;
    if (principal.role !== "admin") throw new ConvexError("Only support can reveal credentials.");
    const allowed =
      principal.scopes === null ||
      (principal.scopes.includes("support") && ticket.assigneeId === principal.adminId);
    if (!allowed) throw new ConvexError("Only the ticket's assignee can reveal credentials.");
    if (!ticket.accessUntil) throw new ConvexError("Access has ended.");
    const secret = await openSecret(entry.sealed);
    await ctx.runMutation(internal.supportAccess.vaultRevealed, {
      ticketId: ticket._id,
      actorName: context.label,
      label: entry.label,
    });
    return { username: entry.username ?? null, secret };
  },
});

export const vaultRevealed = internalMutation({
  args: { ticketId: v.id("supportTickets"), actorName: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (ticket) await logEvent(ctx, ticket, "vault_revealed", args.actorName, args.label);
  },
});

const ACCESS_KINDS = new Set<Doc<"supportEvents">["kind"]>([
  "access_requested",
  "access_declined",
  "access_granted",
  "access_revoked",
  "access_expired",
  "workspace_opened",
  "vault_added",
  "vault_revealed",
  "vault_wiped",
]);

export const accessLog = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const events = await ctx.db
      .query("supportEvents")
      .withIndex("by_workspaceId_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(400);
    const access = events.filter((event) => ACCESS_KINDS.has(event.kind)).slice(0, 100);
    const numbers = new Map<Id<"supportTickets">, number | null>();
    for (const event of access) {
      if (!numbers.has(event.ticketId)) {
        numbers.set(event.ticketId, (await ctx.db.get("supportTickets", event.ticketId))?.number ?? null);
      }
    }
    return access.map((event) => ({
      _id: event._id,
      ticketId: event.ticketId,
      number: numbers.get(event.ticketId) ?? null,
      kind: event.kind,
      actorName: event.actorName,
      detail: event.detail ?? null,
      createdAt: event.createdAt,
    }));
  },
});
