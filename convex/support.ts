import { ConvexError, v, type Infer } from "convex/values";
import { internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import {
  covers,
  getPrincipal,
  hasScope,
  principalKey,
  requireModify,
  requireScope,
  requireWorkspace,
  type Principal,
} from "./lib/auth";
import { r2, requireOwnKey, uploadUrlFor } from "./lib/files";
import {
  ACTIVE_STATUSES,
  DAY,
  DEFAULT_SUPPORT_SETTINGS,
  SUPPORT_LIMITS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  dueDates,
  labelOf,
  preview,
  ticketRef,
  type SupportSettings,
  type SupportStatus,
} from "./lib/support";
import {
  supportAttachment,
  supportEventKind,
  supportPriority,
  supportStatus,
  supportType,
} from "./schema/support";

type Ctx = QueryCtx | MutationCtx;
type Ticket = Doc<"supportTickets">;
type Attachment = Infer<typeof supportAttachment>;
type Staff = Extract<Principal, { role: "admin" }>;

const URL_TTL_SECONDS = 12 * 60 * 60;
const VIEWER_WINDOW_MS = 40_000;

export async function readSettings(ctx: Ctx): Promise<SupportSettings> {
  const row = await ctx.db.query("supportSettings").first();
  if (!row) return DEFAULT_SUPPORT_SETTINGS;
  return {
    firstResponseHours: row.firstResponseHours,
    resolutionHours: row.resolutionHours,
    autoResolveWaitingDays: row.autoResolveWaitingDays,
    autoCloseResolvedDays: row.autoCloseResolvedDays,
    reopenDays: row.reopenDays,
  };
}

export async function logEvent(
  ctx: MutationCtx,
  ticket: Ticket,
  kind: Infer<typeof supportEventKind>,
  actorName: string,
  detail?: string
) {
  await ctx.db.insert("supportEvents", {
    ticketId: ticket._id,
    workspaceId: ticket.workspaceId,
    kind,
    actorName,
    detail,
    createdAt: Date.now(),
  });
}

async function nextNumber(ctx: MutationCtx): Promise<number> {
  const counter = await ctx.db.query("supportCounter").first();
  if (!counter) {
    await ctx.db.insert("supportCounter", { next: 1002 });
    return 1001;
  }
  await ctx.db.patch(counter._id, { next: counter.next + 1 });
  return counter.next;
}

async function requesterOf(ctx: Ctx, principal: Principal, workspaceId: Id<"workspaces">) {
  const key = principalKey(principal);
  if (principal.role === "member") {
    const member = await ctx.db.get("teamMembers", principal.memberId);
    return { key, name: member?.name ?? principal.label, email: member?.email };
  }
  if (principal.role === "user") {
    const user = await ctx.db.get("users", principal.userId);
    return { key, name: principal.label, email: user?.email };
  }
  if (principal.role === "workspace") {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    const owner = (
      await ctx.db
        .query("teamMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .take(100)
    ).find((member) => member.isOwner);
    return {
      key,
      name: workspace?.ownerName?.trim() || owner?.name || workspace?.name || "Workspace",
      email: owner?.email || workspace?.supportEmail,
    };
  }
  const admin = await ctx.db.get("admins", principal.adminId);
  return { key, name: admin?.name?.trim() || admin?.email || principal.label, email: admin?.email };
}

function clientSees(principal: Principal, ticket: Ticket): boolean {
  return principal.role !== "member" || ticket.requesterKey === principalKey(principal);
}

async function requireClientTicket(ctx: Ctx, ticketId: Id<"supportTickets">) {
  const ticket = await ctx.db.get("supportTickets", ticketId);
  if (!ticket) throw new ConvexError("Ticket not found.");
  const principal = await requireWorkspace(ctx, ticket.workspaceId);
  if (!clientSees(principal, ticket)) throw new ConvexError("Ticket not found.");
  return { ticket, principal };
}

export async function requireStaffTicket(
  ctx: Ctx,
  ticketId: Id<"supportTickets">,
  level: "view" | "modify" = "view"
) {
  const principal =
    level === "modify" ? await requireModify(ctx, "support") : await requireScope(ctx, "support");
  const ticket = await ctx.db.get("supportTickets", ticketId);
  if (!ticket) throw new ConvexError("Ticket not found.");
  return { ticket, principal };
}

async function staffName(ctx: Ctx, principal: Staff): Promise<string> {
  const admin = await ctx.db.get("admins", principal.adminId);
  return admin?.name?.trim() || admin?.email || "Support";
}

function checkAttachments(attachments: Attachment[], workspaceId: Id<"workspaces">) {
  if (attachments.length > SUPPORT_LIMITS.files) {
    throw new ConvexError(`Attach up to ${SUPPORT_LIMITS.files} files.`);
  }
  for (const file of attachments) {
    requireOwnKey(file.key, "support", workspaceId);
    if (file.size > SUPPORT_LIMITS.fileBytes) {
      throw new ConvexError(`${file.name} is over 20 MB.`);
    }
  }
  return attachments.map((file) => ({ ...file, name: file.name.slice(0, 200) }));
}

function checkBody(body: string, allowEmpty = false): string {
  const text = body.trim();
  if (!text && !allowEmpty) throw new ConvexError("Write a message first.");
  if (text.length > SUPPORT_LIMITS.body) throw new ConvexError("That message is too long.");
  return text;
}

async function withUrls(attachments: Attachment[]) {
  return await Promise.all(
    attachments.map(async (file) => ({
      ...file,
      url: await r2.getUrl(file.key, { expiresIn: URL_TTL_SECONDS }),
    }))
  );
}

export async function notifyClient(
  ctx: MutationCtx,
  ticket: Ticket,
  title: string,
  message: string
) {
  await ctx.scheduler.runAfter(0, internal.push.notify, {
    workspaceId: ticket.workspaceId,
    event: "support_update",
    data: { ticketId: ticket._id, title, message, link: `/support/${ticket._id}` },
  });
  await ctx.scheduler.runAfter(0, internal.supportSend.toClient, {
    ticketId: ticket._id,
    title,
    message,
  });
}

export function notifyStaff(
  ctx: MutationCtx,
  ticket: Ticket,
  title: string,
  message: string,
  adminIds?: Id<"admins">[]
) {
  return ctx.scheduler.runAfter(0, internal.supportSend.toStaff, {
    ticketId: ticket._id,
    title,
    message,
    adminIds,
  });
}

function ticketRow(ticket: Ticket) {
  return {
    _id: ticket._id,
    number: ticket.number,
    subject: ticket.subject,
    type: ticket.type,
    priority: ticket.priority,
    status: ticket.status,
    requesterName: ticket.requesterName,
    assigneeId: ticket.assigneeId ?? null,
    assigneeName: ticket.assigneeName ?? null,
    lastMessageAt: ticket.lastMessageAt,
    lastMessagePreview: ticket.lastMessagePreview,
    lastReplyBy: ticket.lastReplyBy,
    accessUntil: ticket.accessUntil ?? null,
    accessRequestedAt: ticket.accessRequestedAt ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

// ------------------------------------------------------------------ client

export const generateUploadUrl = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await uploadUrlFor("support", args.workspaceId);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    subject: v.string(),
    description: v.string(),
    type: supportType,
    priority: supportPriority,
    urgentReason: v.optional(v.string()),
    link: v.optional(v.string()),
    linkLabel: v.optional(v.string()),
    attachments: v.array(supportAttachment),
    diagnostics: v.optional(
      v.object({
        page: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        platform: v.optional(v.string()),
        appVersion: v.optional(v.string()),
        screen: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const principal = await requireWorkspace(ctx, args.workspaceId);
    const requester = await requesterOf(ctx, principal, args.workspaceId);

    const subject = args.subject.trim().slice(0, SUPPORT_LIMITS.subject);
    if (!subject) throw new ConvexError("Give the ticket a subject.");
    const description = checkBody(args.description);
    const urgentReason = args.urgentReason?.trim().slice(0, 500) || undefined;
    if (args.priority === "urgent" && !urgentReason) {
      throw new ConvexError("Say why this is urgent.");
    }
    const attachments = checkAttachments(args.attachments, args.workspaceId);
    const link = args.link?.startsWith("/") ? args.link.slice(0, 300) : undefined;

    const now = Date.now();
    const settings = await readSettings(ctx);
    const ticketId = await ctx.db.insert("supportTickets", {
      workspaceId: args.workspaceId,
      number: await nextNumber(ctx),
      subject,
      description,
      type: args.type,
      priority: args.priority,
      urgentReason,
      status: "open",
      requesterKey: requester.key,
      requesterName: requester.name,
      requesterEmail: requester.email,
      link,
      linkLabel: link ? args.linkLabel?.trim().slice(0, 120) : undefined,
      diagnostics: args.diagnostics,
      tags: [],
      clientUnread: false,
      staffUnread: true,
      lastMessageAt: now,
      lastMessagePreview: preview(description),
      lastReplyBy: "client",
      ...dueDates(settings, args.priority, now),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("supportMessages", {
      ticketId,
      workspaceId: args.workspaceId,
      author: "client",
      authorKey: requester.key,
      authorName: requester.name,
      body: description,
      internal: false,
      attachments,
      createdAt: now,
    });
    const ticket = (await ctx.db.get("supportTickets", ticketId))!;
    await logEvent(ctx, ticket, "created", requester.name);
    await notifyStaff(
      ctx,
      ticket,
      `New ${ticket.priority === "urgent" ? "urgent " : ""}ticket ${ticketRef(ticket.number)}`,
      `${subject}\n\n${preview(description, 400)}`
    );
    await ctx.scheduler.runAfter(0, internal.supportSend.toClient, {
      ticketId,
      title: `We have your ticket ${ticketRef(ticket.number)}`,
      message: `Thanks — "${subject}" is with our support team. We will reply here and by email.`,
    });
    return { ticketId, number: ticket.number };
  },
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    filter: v.union(v.literal("active"), v.literal("done"), v.literal("all")),
  },
  handler: async (ctx, args) => {
    const principal = await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("supportTickets")
      .withIndex("by_workspace_and_updatedAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(300);
    return rows
      .filter((ticket) => clientSees(principal, ticket))
      .filter((ticket) =>
        args.filter === "all"
          ? true
          : args.filter === "active"
            ? ACTIVE_STATUSES.includes(ticket.status)
            : !ACTIVE_STATUSES.includes(ticket.status)
      )
      .map((ticket) => ({ ...ticketRow(ticket), unread: ticket.clientUnread }));
  },
});

export const unreadCount = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const principal = await getPrincipal(ctx);
    if (!principal || principal.role === "admin") return 0;
    await requireWorkspace(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("supportTickets")
      .withIndex("by_workspace_and_updatedAt", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(100);
    return rows.filter(
      (ticket) =>
        clientSees(principal, ticket) &&
        (ticket.clientUnread || (ticket.accessRequestedAt !== undefined && !ticket.accessUntil))
    ).length;
  },
});

export const get = query({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket) return null;
    const principal = await getPrincipal(ctx);
    if (!principal) return null;
    try {
      await requireWorkspace(ctx, ticket.workspaceId);
    } catch {
      return null;
    }
    if (!clientSees(principal, ticket)) return null;

    const [messages, events, vault] = await Promise.all([
      ctx.db
        .query("supportMessages")
        .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
        .take(500),
      ctx.db
        .query("supportEvents")
        .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
        .take(500),
      ctx.db
        .query("supportVault")
        .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
        .take(20),
    ]);
    const settings = await readSettings(ctx);
    const canGrant = principal.role === "workspace" || principal.role === "user";

    return {
      ...ticketRow(ticket),
      description: ticket.description,
      urgentReason: ticket.urgentReason ?? null,
      link: ticket.link ?? null,
      linkLabel: ticket.linkLabel ?? null,
      accessGrantedAt: ticket.accessGrantedAt ?? null,
      accessGrantedBy: ticket.accessGrantedBy ?? null,
      accessRequestNote: ticket.accessRequestNote ?? null,
      resolvedAt: ticket.resolvedAt ?? null,
      rating: ticket.rating ?? null,
      ratingComment: ticket.ratingComment ?? null,
      unread: ticket.clientUnread,
      reopenUntil: ticket.resolvedAt ? ticket.resolvedAt + settings.reopenDays * DAY : null,
      canGrant,
      messages: await Promise.all(
        messages
          .filter((message) => !message.internal)
          .map(async (message) => ({
            _id: message._id,
            author: message.author,
            authorName: message.authorName,
            mine: message.authorKey === principalKey(principal),
            body: message.body,
            attachments: await withUrls(message.attachments),
            createdAt: message.createdAt,
          }))
      ),
      events: events.map((event) => ({
        _id: event._id,
        kind: event.kind,
        actorName: event.actorName,
        detail: event.detail ?? null,
        createdAt: event.createdAt,
      })),
      vault: vault.map((entry) => ({
        _id: entry._id,
        label: entry.label,
        username: entry.username ?? null,
        note: entry.note ?? null,
        createdAt: entry.createdAt,
      })),
    };
  },
});

export const reply = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    body: v.string(),
    attachments: v.array(supportAttachment),
  },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireClientTicket(ctx, args.ticketId);
    const attachments = checkAttachments(args.attachments, ticket.workspaceId);
    const body = checkBody(args.body, attachments.length > 0);
    if (ticket.status === "closed") {
      throw new ConvexError(
        `This ticket is closed. Open a new one and mention ${ticketRef(ticket.number)}.`
      );
    }
    const settings = await readSettings(ctx);
    const now = Date.now();
    if (ticket.status === "resolved" && (ticket.resolvedAt ?? 0) + settings.reopenDays * DAY < now) {
      throw new ConvexError(
        `This ticket was resolved too long ago to reopen. Open a new one and mention ${ticketRef(ticket.number)}.`
      );
    }
    const requester = await requesterOf(ctx, principal, ticket.workspaceId);
    await ctx.db.insert("supportMessages", {
      ticketId: ticket._id,
      workspaceId: ticket.workspaceId,
      author: "client",
      authorKey: requester.key,
      authorName: requester.name,
      body,
      internal: false,
      attachments,
      createdAt: now,
    });

    const status: SupportStatus =
      ticket.status === "open" || ticket.status === "in_progress"
        ? ticket.status
        : ticket.assigneeId
          ? "in_progress"
          : "open";
    await ctx.db.patch(ticket._id, {
      status,
      resolvedAt: status === ticket.status ? ticket.resolvedAt : undefined,
      staffUnread: true,
      clientUnread: false,
      lastMessageAt: now,
      lastMessagePreview: preview(body || attachments.map((file) => file.name).join(", ")),
      lastReplyBy: "client",
      updatedAt: now,
    });
    if (ticket.status === "resolved") await logEvent(ctx, ticket, "reopened", requester.name);
    await notifyStaff(
      ctx,
      ticket,
      `${requester.name} replied on ${ticketRef(ticket.number)}`,
      `${ticket.subject}\n\n${preview(body, 400)}`,
      ticket.assigneeId ? [ticket.assigneeId] : undefined
    );
  },
});

export const markRead = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const { ticket } = await requireClientTicket(ctx, args.ticketId);
    if (ticket.clientUnread) await ctx.db.patch(ticket._id, { clientUnread: false });
  },
});

export const resolve = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireClientTicket(ctx, args.ticketId);
    if (!ACTIVE_STATUSES.includes(ticket.status)) return;
    const now = Date.now();
    await ctx.db.patch(ticket._id, { status: "resolved", resolvedAt: now, updatedAt: now });
    const requester = await requesterOf(ctx, principal, ticket.workspaceId);
    await logEvent(ctx, ticket, "status", requester.name, "resolved");
    await ctx.scheduler.runAfter(0, internal.supportAccess.endAccess, {
      ticketId: ticket._id,
      reason: "revoked",
      actorName: requester.name,
    });
    await notifyStaff(
      ctx,
      ticket,
      `${requester.name} marked ${ticketRef(ticket.number)} resolved`,
      ticket.subject,
      ticket.assigneeId ? [ticket.assigneeId] : undefined
    );
  },
});

export const reopen = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireClientTicket(ctx, args.ticketId);
    if (ticket.status !== "resolved") return;
    const settings = await readSettings(ctx);
    const now = Date.now();
    if ((ticket.resolvedAt ?? 0) + settings.reopenDays * DAY < now) {
      throw new ConvexError("This ticket was resolved too long ago to reopen. Open a new one.");
    }
    await ctx.db.patch(ticket._id, {
      status: ticket.assigneeId ? "in_progress" : "open",
      resolvedAt: undefined,
      staffUnread: true,
      updatedAt: now,
    });
    const requester = await requesterOf(ctx, principal, ticket.workspaceId);
    await logEvent(ctx, ticket, "reopened", requester.name);
    await notifyStaff(
      ctx,
      ticket,
      `${ticketRef(ticket.number)} was reopened`,
      ticket.subject,
      ticket.assigneeId ? [ticket.assigneeId] : undefined
    );
  },
});

export const rate = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    rating: v.number(),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireClientTicket(ctx, args.ticketId);
    if (ticket.status !== "resolved" && ticket.status !== "closed") {
      throw new ConvexError("Rate a ticket once it is resolved.");
    }
    const rating = Math.round(args.rating);
    if (rating < 1 || rating > 5) throw new ConvexError("Pick one to five stars.");
    const comment = args.comment?.trim().slice(0, 1000) || undefined;
    await ctx.db.patch(ticket._id, { rating, ratingComment: comment });
    const requester = await requesterOf(ctx, principal, ticket.workspaceId);
    await logEvent(ctx, ticket, "rated", requester.name, `${rating}/5`);
  },
});

// ------------------------------------------------------------------- staff

const inboxView = v.union(
  v.literal("unassigned"),
  v.literal("mine"),
  v.literal("waiting"),
  v.literal("breaching"),
  v.literal("open"),
  v.literal("done"),
  v.literal("all")
);

async function byStatuses(ctx: QueryCtx, statuses: SupportStatus[], take: number) {
  const pages = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query("supportTickets")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
        .order("desc")
        .take(take)
    )
  );
  return pages.flat().sort((a, b) => b.updatedAt - a.updatedAt);
}

export const inbox = query({
  args: {
    view: inboxView,
    now: v.number(),
    search: v.optional(v.string()),
    workspaceId: v.optional(v.id("workspaces")),
    priority: v.optional(supportPriority),
    type: v.optional(supportType),
    assigneeId: v.optional(v.id("admins")),
  },
  handler: async (ctx, args) => {
    const principal = await requireScope(ctx, "support");
    const search = args.search?.trim();

    let tickets: Ticket[];
    if (search) {
      const byNumber = /^#?\d+$/.test(search)
        ? await ctx.db
            .query("supportTickets")
            .withIndex("by_number", (q) => q.eq("number", Number(search.replace("#", ""))))
            .take(1)
        : [];
      const bySubject = await ctx.db
        .query("supportTickets")
        .withSearchIndex("search_subject", (q) =>
          args.workspaceId
            ? q.search("subject", search).eq("workspaceId", args.workspaceId)
            : q.search("subject", search)
        )
        .take(50);
      tickets = [...byNumber, ...bySubject.filter((ticket) => ticket._id !== byNumber[0]?._id)];
    } else if (args.view === "mine") {
      tickets = (
        await ctx.db
          .query("supportTickets")
          .withIndex("by_assigneeId_and_updatedAt", (q) => q.eq("assigneeId", principal.adminId))
          .order("desc")
          .take(300)
      ).filter((ticket) => ACTIVE_STATUSES.includes(ticket.status));
    } else if (args.view === "done") {
      tickets = await byStatuses(ctx, ["resolved", "closed"], 150);
    } else if (args.view === "all") {
      tickets = await ctx.db.query("supportTickets").withIndex("by_updatedAt").order("desc").take(300);
    } else {
      tickets = await byStatuses(ctx, ACTIVE_STATUSES, 300);
      if (args.view === "unassigned") tickets = tickets.filter((ticket) => !ticket.assigneeId);
      if (args.view === "waiting") tickets = tickets.filter((ticket) => ticket.status === "waiting_client");
      if (args.view === "breaching") {
        const soon = args.now + 2 * 60 * 60 * 1000;
        tickets = tickets.filter(
          (ticket) =>
            ticket.slaBreached ||
            (!ticket.firstResponseAt && (ticket.firstResponseDueAt ?? Infinity) < soon) ||
            (ticket.resolutionDueAt ?? Infinity) < soon
        );
      }
    }

    tickets = tickets.filter(
      (ticket) =>
        (!args.workspaceId || ticket.workspaceId === args.workspaceId) &&
        (!args.priority || ticket.priority === args.priority) &&
        (!args.type || ticket.type === args.type) &&
        (!args.assigneeId || ticket.assigneeId === args.assigneeId)
    );

    const workspaces = new Map<Id<"workspaces">, Doc<"workspaces"> | null>();
    for (const ticket of tickets) {
      if (!workspaces.has(ticket.workspaceId)) {
        workspaces.set(ticket.workspaceId, await ctx.db.get("workspaces", ticket.workspaceId));
      }
    }

    return tickets.slice(0, 200).map((ticket) => {
      const workspace = workspaces.get(ticket.workspaceId);
      return {
        ...ticketRow(ticket),
        workspaceId: ticket.workspaceId,
        workspaceName: workspace?.name ?? "Deleted workspace",
        workspaceSlug: workspace?.slug ?? null,
        unread: ticket.staffUnread,
        tags: ticket.tags,
        firstResponseAt: ticket.firstResponseAt ?? null,
        firstResponseDueAt: ticket.firstResponseDueAt ?? null,
        resolutionDueAt: ticket.resolutionDueAt ?? null,
        slaBreached: ticket.slaBreached ?? false,
        canOpen: covers(principal, ticket.workspaceId),
      };
    });
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const principal = await getPrincipal(ctx);
    if (!hasScope(principal, "support") || principal?.role !== "admin") return null;
    const active = await byStatuses(ctx, ACTIVE_STATUSES, 300);
    return {
      unassigned: active.filter((ticket) => !ticket.assigneeId).length,
      mine: active.filter(
        (ticket) => ticket.assigneeId === principal.adminId && ticket.staffUnread
      ).length,
    };
  },
});

export const staffList = query({
  args: {},
  handler: async (ctx) => {
    await requireScope(ctx, "support");
    return await supportStaff(ctx);
  },
});

async function supportStaff(ctx: Ctx) {
  const [admins, roles] = await Promise.all([
    ctx.db.query("admins").take(300),
    ctx.db.query("adminRoles").take(100),
  ]);
  const supportRoles = new Set(
    roles.filter((role) => role.scopes.includes("support")).map((role) => role._id)
  );
  return admins
    .filter((admin) => admin.role !== "member" || (admin.roleId && supportRoles.has(admin.roleId)))
    .map((admin) => ({
      _id: admin._id,
      name: admin.name?.trim() || admin.email,
      email: admin.email,
      full: admin.role !== "member",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const staffGet = query({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const principal = await getPrincipal(ctx);
    if (principal?.role !== "admin" || !hasScope(principal, "support")) return null;
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket) return null;

    const [messages, events, vault, workspace, account, wallet, channels, others] =
      await Promise.all([
        ctx.db
          .query("supportMessages")
          .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
          .take(500),
        ctx.db
          .query("supportEvents")
          .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
          .take(500),
        ctx.db
          .query("supportVault")
          .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
          .take(20),
        ctx.db.get("workspaces", ticket.workspaceId),
        ctx.db
          .query("billingAccounts")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ticket.workspaceId))
          .first(),
        ctx.db
          .query("wallets")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ticket.workspaceId))
          .first(),
        ctx.db
          .query("channels")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", ticket.workspaceId))
          .take(20),
        ctx.db
          .query("supportTickets")
          .withIndex("by_workspace_and_updatedAt", (q) => q.eq("workspaceId", ticket.workspaceId))
          .order("desc")
          .take(20),
      ]);
    const plan = account?.planId ? await ctx.db.get("billingPlans", account.planId) : null;
    const isAssignee = ticket.assigneeId === principal.adminId;

    return {
      ...ticketRow(ticket),
      workspaceId: ticket.workspaceId,
      description: ticket.description,
      urgentReason: ticket.urgentReason ?? null,
      requesterEmail: ticket.requesterEmail ?? null,
      link: ticket.link ?? null,
      linkLabel: ticket.linkLabel ?? null,
      diagnostics: ticket.diagnostics ?? null,
      tags: ticket.tags,
      unread: ticket.staffUnread,
      firstResponseAt: ticket.firstResponseAt ?? null,
      firstResponseDueAt: ticket.firstResponseDueAt ?? null,
      resolutionDueAt: ticket.resolutionDueAt ?? null,
      slaBreached: ticket.slaBreached ?? false,
      resolvedAt: ticket.resolvedAt ?? null,
      accessGrantedAt: ticket.accessGrantedAt ?? null,
      accessGrantedBy: ticket.accessGrantedBy ?? null,
      accessRequestNote: ticket.accessRequestNote ?? null,
      rating: ticket.rating ?? null,
      ratingComment: ticket.ratingComment ?? null,
      me: principal.adminId,
      isAssignee,
      isFullAdmin: principal.scopes === null,
      canModify: hasScope(principal, "support", "modify"),
      canOpen: covers(principal, ticket.workspaceId),
      canReveal: Boolean(ticket.accessUntil) && (isAssignee || principal.scopes === null),
      workspace: workspace
        ? {
            name: workspace.name,
            slug: workspace.slug,
            stage: workspace.stageLabel ?? workspace.stage ?? null,
            status: workspace.status,
            plan: plan?.name ?? null,
            mode: account?.mode ?? null,
            trialEndsAt: account?.trialEndsAt ?? null,
            walletMicros: wallet?.balanceMicros ?? null,
            walletCurrency: wallet?.currency ?? null,
            channels: channels.map((channel) => ({
              _id: channel._id,
              name: channel.name,
              type: channel.type,
              status: channel.status,
              lastError: channel.lastError ?? null,
            })),
          }
        : null,
      related: others
        .filter((other) => other._id !== ticket._id)
        .slice(0, 8)
        .map((other) => ({
          _id: other._id,
          number: other.number,
          subject: other.subject,
          status: other.status,
          updatedAt: other.updatedAt,
        })),
      messages: await Promise.all(
        messages.map(async (message) => ({
          _id: message._id,
          author: message.author,
          authorName: message.authorName,
          mine: message.authorKey === `admin|${principal.adminId}`,
          internal: message.internal,
          body: message.body,
          attachments: await withUrls(message.attachments),
          createdAt: message.createdAt,
        }))
      ),
      events: events.map((event) => ({
        _id: event._id,
        kind: event.kind,
        actorName: event.actorName,
        detail: event.detail ?? null,
        createdAt: event.createdAt,
      })),
      vault: vault.map((entry) => ({
        _id: entry._id,
        label: entry.label,
        username: entry.username ?? null,
        note: entry.note ?? null,
        createdBy: entry.createdBy,
        createdAt: entry.createdAt,
      })),
    };
  },
});

export const staffUploadUrl = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const { ticket } = await requireStaffTicket(ctx, args.ticketId, "modify");
    return await uploadUrlFor("support", ticket.workspaceId);
  },
});

export const staffReply = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    body: v.string(),
    attachments: v.array(supportAttachment),
    internal: v.boolean(),
    status: v.optional(supportStatus),
  },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireStaffTicket(ctx, args.ticketId, "modify");
    const attachments = checkAttachments(args.attachments, ticket.workspaceId);
    const body = checkBody(args.body, attachments.length > 0);
    const name = await staffName(ctx, principal);
    const now = Date.now();

    await ctx.db.insert("supportMessages", {
      ticketId: ticket._id,
      workspaceId: ticket.workspaceId,
      author: "staff",
      authorKey: `admin|${principal.adminId}`,
      authorName: name,
      body,
      internal: args.internal,
      attachments,
      createdAt: now,
    });

    if (args.internal) {
      await ctx.db.patch(ticket._id, { updatedAt: now });
      return;
    }

    const status: SupportStatus =
      args.status ?? (ticket.status === "open" ? "in_progress" : ticket.status);
    const assign = !ticket.assigneeId;
    await ctx.db.patch(ticket._id, {
      status,
      staffUnread: false,
      clientUnread: true,
      lastMessageAt: now,
      lastMessagePreview: preview(body || attachments.map((file) => file.name).join(", ")),
      lastReplyBy: "staff",
      firstResponseAt: ticket.firstResponseAt ?? now,
      resolvedAt: status === "resolved" ? now : status === "closed" ? ticket.resolvedAt : undefined,
      closedAt: status === "closed" ? now : undefined,
      ...(assign ? { assigneeId: principal.adminId, assigneeName: name } : {}),
      updatedAt: now,
    });
    if (assign) await logEvent(ctx, ticket, "assigned", name, name);
    if (status !== ticket.status) {
      await logEvent(ctx, ticket, "status", name, status);
      if (status === "resolved" || status === "closed") {
        await ctx.scheduler.runAfter(0, internal.supportAccess.endAccess, {
          ticketId: ticket._id,
          reason: "revoked",
          actorName: name,
        });
      }
    }
    await notifyClient(
      ctx,
      ticket,
      status === "resolved"
        ? `${ticketRef(ticket.number)} is resolved`
        : status === "waiting_client"
          ? `${ticketRef(ticket.number)} needs your reply`
          : `New reply on ${ticketRef(ticket.number)}`,
      `${name}: ${preview(body, 400)}`
    );
  },
});

export const staffMarkRead = mutation({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireStaffTicket(ctx, args.ticketId);
    if (ticket.staffUnread && (!ticket.assigneeId || ticket.assigneeId === principal.adminId)) {
      await ctx.db.patch(ticket._id, { staffUnread: false });
    }
  },
});

async function applyUpdate(
  ctx: MutationCtx,
  ticket: Ticket,
  principal: Staff,
  name: string,
  changes: {
    status?: SupportStatus;
    priority?: Ticket["priority"];
    type?: Ticket["type"];
    assigneeId?: Id<"admins"> | null;
    tags?: string[];
  }
) {
  const now = Date.now();
  const patch: Partial<Ticket> = { updatedAt: now };

  if (changes.status && changes.status !== ticket.status) {
    patch.status = changes.status;
    if (changes.status === "resolved") patch.resolvedAt = now;
    if (changes.status === "closed") {
      patch.closedAt = now;
      patch.resolvedAt = ticket.resolvedAt ?? now;
    }
    if (ACTIVE_STATUSES.includes(changes.status)) {
      patch.resolvedAt = undefined;
      patch.closedAt = undefined;
    }
    await logEvent(ctx, ticket, "status", name, changes.status);
    if (!ACTIVE_STATUSES.includes(changes.status)) {
      await ctx.scheduler.runAfter(0, internal.supportAccess.endAccess, {
        ticketId: ticket._id,
        reason: "revoked",
        actorName: name,
      });
    }
    await notifyClient(
      ctx,
      ticket,
      `${ticketRef(ticket.number)} is now ${labelOf(SUPPORT_STATUSES, changes.status).toLowerCase()}`,
      ticket.subject
    );
  }

  if (changes.priority && changes.priority !== ticket.priority) {
    patch.priority = changes.priority;
    const due = dueDates(await readSettings(ctx), changes.priority, ticket.createdAt);
    patch.firstResponseDueAt = due.firstResponseDueAt;
    patch.resolutionDueAt = due.resolutionDueAt;
    patch.slaBreached = undefined;
    await logEvent(ctx, ticket, "priority", name, labelOf(SUPPORT_PRIORITIES, changes.priority));
  }

  if (changes.type && changes.type !== ticket.type) patch.type = changes.type;

  if (changes.assigneeId !== undefined && changes.assigneeId !== (ticket.assigneeId ?? null)) {
    if (changes.assigneeId === null) {
      patch.assigneeId = undefined;
      patch.assigneeName = undefined;
      await logEvent(ctx, ticket, "assigned", name, "Unassigned");
    } else {
      const staff = (await supportStaff(ctx)).find((row) => row._id === changes.assigneeId);
      if (!staff) throw new ConvexError("That person cannot take support tickets.");
      patch.assigneeId = staff._id;
      patch.assigneeName = staff.name;
      if (ticket.status === "open") patch.status = "in_progress";
      await logEvent(ctx, ticket, "assigned", name, staff.name);
      if (staff._id !== principal.adminId) {
        await notifyStaff(
          ctx,
          ticket,
          `${name} assigned ${ticketRef(ticket.number)} to you`,
          ticket.subject,
          [staff._id]
        );
      }
    }
  }

  if (changes.tags) {
    patch.tags = [...new Set(changes.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
      .slice(0, SUPPORT_LIMITS.tags)
      .map((tag) => tag.slice(0, 30));
  }

  await ctx.db.patch(ticket._id, patch);
}

const updateFields = {
  status: v.optional(supportStatus),
  priority: v.optional(supportPriority),
  type: v.optional(supportType),
  assigneeId: v.optional(v.union(v.id("admins"), v.null())),
  tags: v.optional(v.array(v.string())),
};

export const update = mutation({
  args: { ticketId: v.id("supportTickets"), ...updateFields },
  handler: async (ctx, { ticketId, ...changes }) => {
    const { ticket, principal } = await requireStaffTicket(ctx, ticketId, "modify");
    await applyUpdate(ctx, ticket, principal, await staffName(ctx, principal), changes);
  },
});

export const bulkUpdate = mutation({
  args: { ticketIds: v.array(v.id("supportTickets")), ...updateFields },
  handler: async (ctx, { ticketIds, ...changes }) => {
    const principal = await requireModify(ctx, "support");
    if (ticketIds.length > 100) throw new ConvexError("Change up to 100 tickets at a time.");
    const name = await staffName(ctx, principal);
    for (const ticketId of ticketIds) {
      const ticket = await ctx.db.get("supportTickets", ticketId);
      if (ticket) await applyUpdate(ctx, ticket, principal, name, changes);
    }
  },
});

export const merge = mutation({
  args: { ticketId: v.id("supportTickets"), intoNumber: v.number() },
  handler: async (ctx, args) => {
    const { ticket, principal } = await requireStaffTicket(ctx, args.ticketId, "modify");
    const target = await ctx.db
      .query("supportTickets")
      .withIndex("by_number", (q) => q.eq("number", args.intoNumber))
      .unique();
    if (!target || target._id === ticket._id) throw new ConvexError("Pick another ticket to merge into.");
    if (target.workspaceId !== ticket.workspaceId) {
      throw new ConvexError("Only tickets from the same workspace can be merged.");
    }
    const name = await staffName(ctx, principal);
    const messages = await ctx.db
      .query("supportMessages")
      .withIndex("by_ticketId", (q) => q.eq("ticketId", ticket._id))
      .take(500);
    for (const message of messages) await ctx.db.patch(message._id, { ticketId: target._id });
    const now = Date.now();
    await ctx.db.insert("supportMessages", {
      ticketId: ticket._id,
      workspaceId: ticket.workspaceId,
      author: "staff",
      authorKey: `admin|${principal.adminId}`,
      authorName: name,
      body: `Merged into ${ticketRef(target.number)}. The conversation continues there.`,
      internal: false,
      attachments: [],
      createdAt: now,
    });
    await applyUpdate(ctx, ticket, principal, name, { status: "closed" });
    await ctx.db.patch(target._id, { staffUnread: true, updatedAt: now });
    await logEvent(ctx, target, "status", name, `merged ${ticketRef(ticket.number)}`);
    return { ticketId: target._id };
  },
});

export const heartbeat = mutation({
  args: { ticketId: v.id("supportTickets"), typing: v.boolean() },
  handler: async (ctx, args) => {
    const { principal } = await requireStaffTicket(ctx, args.ticketId);
    const existing = await ctx.db
      .query("supportViewers")
      .withIndex("by_ticketId_and_adminId", (q) =>
        q.eq("ticketId", args.ticketId).eq("adminId", principal.adminId)
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { typing: args.typing, seenAt: now });
    } else {
      await ctx.db.insert("supportViewers", {
        ticketId: args.ticketId,
        adminId: principal.adminId,
        name: await staffName(ctx, principal),
        typing: args.typing,
        seenAt: now,
      });
    }
  },
});

export const viewers = query({
  args: { ticketId: v.id("supportTickets"), now: v.number() },
  handler: async (ctx, args) => {
    const principal = await requireScope(ctx, "support");
    const rows = await ctx.db
      .query("supportViewers")
      .withIndex("by_ticketId_and_adminId", (q) => q.eq("ticketId", args.ticketId))
      .take(20);
    return rows
      .filter((row) => row.adminId !== principal.adminId && row.seenAt > args.now - VIEWER_WINDOW_MS)
      .map((row) => ({ name: row.name, typing: row.typing }));
  },
});

export const pruneViewers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("supportViewers")
      .withIndex("by_seenAt", (q) => q.lt("seenAt", Date.now() - 60 * 60 * 1000))
      .take(500);
    for (const row of stale) await ctx.db.delete(row._id);
  },
});

// --------------------------------------------------------------- internals

export const sendContext = internalQuery({
  args: { ticketId: v.id("supportTickets") },
  handler: async (ctx, args) => {
    const ticket = await ctx.db.get("supportTickets", args.ticketId);
    if (!ticket) return null;
    const workspace = await ctx.db.get("workspaces", ticket.workspaceId);
    const staff = await supportStaff(ctx);
    return { ticket, workspace, staff };
  },
});
