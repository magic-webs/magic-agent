import { ConvexError, v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireModify, requireScope } from "./lib/auth";
import {
  PLATFORM_NOTIFICATION_FOLDER,
  deleteFile,
  fileUrl,
  platformNotificationUploadUrl,
} from "./lib/files";
import { normaliseEmail, normalisePhone, platformEmail } from "./lib/notifications";
import { safeLink, sanitizeEmailHtml } from "./lib/platformEmail";
import { smsAvailable, smsConfig } from "./lib/sms";
import {
  broadcastAudience,
  broadcastCategory,
  broadcastChannel,
  broadcastChannels,
  emailFormat,
  workspaceStage,
} from "./schema/validators";

type Audience = Infer<typeof broadcastAudience>;
type Stage = Infer<typeof workspaceStage>;

const PAGE = 20;
const MAX_WORKSPACES = 2000;
const MAX_USERS = 5000;
const STAGES: Stage[] = ["account_setup", "development", "testing", "feedback", "live", "custom"];

const emptyStats = () => ({ sent: 0, failed: 0, skipped: 0 });

export type Target = {
  workspaceId: Id<"workspaces">;
  name: string;
  emails: string[];
  phone: string | null;
  tokens: string[];
};

function stageOf(workspace: Doc<"workspaces">): Stage {
  return STAGES.find((stage) => stage === workspace.stage) ?? "account_setup";
}

async function inAudience(
  ctx: QueryCtx,
  workspace: Doc<"workspaces">,
  audience: Audience,
  reach: Id<"workspaces">[] | undefined | null
): Promise<boolean> {
  if (workspace.status !== "active") return false;
  if (reach && !reach.includes(workspace._id)) return false;
  if (audience.kind === "stages") return (audience.stages ?? []).includes(stageOf(workspace));
  if (audience.kind === "workspaces") return (audience.workspaceIds ?? []).includes(workspace._id);
  if (audience.kind === "plans") {
    const account = await ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first();
    return Boolean(account?.planId && (audience.planIds ?? []).includes(account.planId));
  }
  return true;
}

async function targetFor(
  ctx: QueryCtx,
  workspace: Doc<"workspaces">,
  users: Doc<"users">[]
): Promise<Target> {
  const [members, account, tokens] = await Promise.all([
    ctx.db
      .query("teamMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(200),
    ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first(),
    ctx.db
      .query("pushTokens")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(500),
  ]);
  const owner = members.find((member) => member.isOwner);

  const emails = new Set<string>();
  for (const raw of [
    owner?.email,
    workspace.supportEmail,
    account?.billingEmail,
    ...users.filter((user) => user.workspaceIds.includes(workspace._id)).map((user) => user.email),
  ]) {
    const email = raw ? normaliseEmail(raw) : null;
    if (email) emails.add(email);
  }

  const rawPhone = [owner?.phone, workspace.supportPhone, account?.billingPhone].find(
    (value) => value?.trim()
  );

  return {
    workspaceId: workspace._id,
    name: workspace.name,
    emails: [...emails],
    phone: rawPhone ? normalisePhone(rawPhone, "91") : null,
    tokens: tokens.filter((token) => token.disabledAt === undefined).map((token) => token.token),
  };
}

function configured() {
  return { push: true, email: platformEmail() !== null, sms: smsAvailable() };
}

function summary(row: Doc<"platformBroadcasts">) {
  return {
    ...row,
    imageUrl: row.imageKey ? fileUrl(row.imageKey) : null,
  };
}

const contentValidator = v.object({
  title: v.string(),
  body: v.string(),
  category: broadcastCategory,
  channels: broadcastChannels,
  emailSubject: v.optional(v.string()),
  emailBody: v.optional(v.string()),
  emailFormat: v.optional(emailFormat),
  smsText: v.optional(v.string()),
  smsTemplateId: v.optional(v.string()),
  imageKey: v.optional(v.string()),
  link: v.optional(v.string()),
  linkLabel: v.optional(v.string()),
  audience: broadcastAudience,
});

const trimmed = (value: string | undefined) => value?.trim() || undefined;

function cleanContent(args: Infer<typeof contentValidator>) {
  const title = args.title.trim();
  const body = args.body.trim();
  if (!title) throw new ConvexError("Give the notification a title.");
  if (title.length > 120) throw new ConvexError("Keep the title under 120 characters.");
  if (!body) throw new ConvexError("Write the message.");
  if (!args.channels.push && !args.channels.email && !args.channels.sms) {
    throw new ConvexError("Pick at least one channel.");
  }
  if (args.imageKey && !args.imageKey.startsWith(PLATFORM_NOTIFICATION_FOLDER)) {
    throw new ConvexError("That image was not uploaded here.");
  }
  const html = args.emailFormat === "html";
  const emailBody = trimmed(html ? sanitizeEmailHtml(args.emailBody ?? "") : args.emailBody);
  if (emailBody && emailBody.length > 100_000) throw new ConvexError("The email is too long.");
  const link = trimmed(args.link);
  if (link && !safeLink(link)) throw new ConvexError("The link must start with https://.");

  const audience = args.audience;
  if (audience.kind === "stages" && !audience.stages?.length) {
    throw new ConvexError("Pick at least one stage.");
  }
  if (audience.kind === "plans" && !audience.planIds?.length) {
    throw new ConvexError("Pick at least one plan.");
  }
  if (audience.kind === "workspaces" && !audience.workspaceIds?.length) {
    throw new ConvexError("Pick at least one workspace.");
  }

  return {
    title,
    body,
    category: args.category,
    channels: args.channels,
    emailSubject: trimmed(args.emailSubject),
    emailBody,
    emailFormat: html && emailBody ? ("html" as const) : ("text" as const),
    smsText: trimmed(args.smsText),
    smsTemplateId: trimmed(args.smsTemplateId),
    imageKey: args.imageKey,
    link: link ? safeLink(link) : undefined,
    linkLabel: trimmed(args.linkLabel),
    audience: {
      kind: audience.kind,
      stages: audience.kind === "stages" ? audience.stages : undefined,
      planIds: audience.kind === "plans" ? audience.planIds : undefined,
      workspaceIds: audience.kind === "workspaces" ? audience.workspaceIds : undefined,
    },
  };
}

function requireSendable(row: Doc<"platformBroadcasts">) {
  const ready = configured();
  if (row.channels.email && !ready.email) {
    throw new ConvexError("Email is not configured on the deployment (ZEPTOMAIL_TOKEN).");
  }
  if (row.channels.sms && !smsConfig(row.smsTemplateId)) {
    throw new ConvexError("SMS is not configured on the deployment (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID).");
  }
}

// ------------------------------------------------------------------ reads

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireScope(ctx, "notifications");
    const result = await ctx.db
      .query("platformBroadcasts")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(summary) };
  },
});

export const get = query({
  args: { id: v.id("platformBroadcasts") },
  handler: async (ctx, args) => {
    await requireScope(ctx, "notifications");
    const row = await ctx.db.get("platformBroadcasts", args.id);
    return row ? summary(row) : null;
  },
});

export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireScope(ctx, "notifications");
    const plans = await ctx.db.query("billingPlans").withIndex("by_sortOrder").take(100);
    return {
      configured: configured(),
      plans: plans.map((plan) => ({ _id: plan._id, name: plan.name, status: plan.status })),
    };
  },
});

export const audience = query({
  args: { audience: broadcastAudience },
  handler: async (ctx, args) => {
    const principal = await requireScope(ctx, "notifications");
    const [workspaces, users] = await Promise.all([
      ctx.db.query("workspaces").take(MAX_WORKSPACES),
      ctx.db.query("users").take(MAX_USERS),
    ]);
    const emails = new Set<string>();
    const phones = new Set<string>();
    let count = 0;
    let devices = 0;
    for (const workspace of workspaces) {
      if (!(await inAudience(ctx, workspace, args.audience, principal.workspaceIds))) continue;
      const target = await targetFor(ctx, workspace, users);
      count += 1;
      devices += target.tokens.length;
      for (const email of target.emails) emails.add(email);
      if (target.phone) phones.add(target.phone);
    }
    return { workspaces: count, emails: emails.size, phones: phones.size, devices };
  },
});

export const deliveries = query({
  args: {
    id: v.id("platformBroadcasts"),
    status: v.union(v.literal("failed"), v.literal("skipped"), v.literal("sent"), v.literal("pending")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireScope(ctx, "notifications");
    const result = await ctx.db
      .query("platformDeliveries")
      .withIndex("by_broadcast_and_status", (q) =>
        q.eq("broadcastId", args.id).eq("status", args.status)
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const names = new Map<string, string>();
    for (const row of result.page) {
      if (names.has(row.workspaceId)) continue;
      const workspace = await ctx.db.get("workspaces", row.workspaceId);
      names.set(row.workspaceId, workspace?.name ?? "Deleted workspace");
    }
    return {
      ...result,
      page: result.page.map((row) => ({
        _id: row._id,
        channel: row.channel,
        recipient: row.channel === "push" ? "App devices" : row.recipient,
        workspace: names.get(row.workspaceId) ?? "",
        status: row.status,
        detail: row.detail ?? null,
        updatedAt: row.updatedAt,
      })),
    };
  },
});

// ------------------------------------------------------------------ writes

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireModify(ctx, "notifications");
    return await platformNotificationUploadUrl();
  },
});

export const save = mutation({
  args: { id: v.optional(v.id("platformBroadcasts")), ...contentValidator.fields },
  handler: async (ctx, { id, ...args }) => {
    const principal = await requireModify(ctx, "notifications");
    const fields = cleanContent(args);
    const now = Date.now();

    if (id) {
      const row = await ctx.db.get("platformBroadcasts", id);
      if (!row) throw new ConvexError("That notification no longer exists.");
      if (row.status !== "draft" && row.status !== "scheduled") {
        throw new ConvexError("A notification that has started sending cannot be edited.");
      }
      if (row.imageKey && row.imageKey !== fields.imageKey) await deleteFile(ctx, row.imageKey);
      await ctx.db.patch("platformBroadcasts", id, { ...fields, updatedAt: now });
      return id;
    }

    const admin = await ctx.db.get("admins", principal.adminId);
    return await ctx.db.insert("platformBroadcasts", {
      ...fields,
      reach: principal.workspaceIds ?? undefined,
      status: "draft",
      workspaces: 0,
      push: emptyStats(),
      email: emptyStats(),
      sms: emptyStats(),
      createdBy: principal.adminId,
      createdByName: admin?.name?.trim() || principal.label,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const duplicate = mutation({
  args: { id: v.id("platformBroadcasts") },
  handler: async (ctx, args) => {
    const principal = await requireModify(ctx, "notifications");
    const row = await ctx.db.get("platformBroadcasts", args.id);
    if (!row) throw new ConvexError("That notification no longer exists.");
    const admin = await ctx.db.get("admins", principal.adminId);
    const now = Date.now();
    return await ctx.db.insert("platformBroadcasts", {
      title: `${row.title} (copy)`.slice(0, 120),
      body: row.body,
      category: row.category,
      channels: row.channels,
      emailSubject: row.emailSubject,
      emailBody: row.emailBody,
      emailFormat: row.emailFormat,
      smsText: row.smsText,
      smsTemplateId: row.smsTemplateId,
      link: row.link,
      linkLabel: row.linkLabel,
      audience: row.audience,
      reach: principal.workspaceIds ?? undefined,
      status: "draft",
      workspaces: 0,
      push: emptyStats(),
      email: emptyStats(),
      sms: emptyStats(),
      createdBy: principal.adminId,
      createdByName: admin?.name?.trim() || principal.label,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("platformBroadcasts") },
  handler: async (ctx, args) => {
    await requireModify(ctx, "notifications");
    const row = await ctx.db.get("platformBroadcasts", args.id);
    if (!row) return null;
    if (row.status !== "draft") {
      throw new ConvexError("Only a draft can be deleted. Cancel a scheduled one instead.");
    }
    await deleteFile(ctx, row.imageKey);
    await ctx.db.delete("platformBroadcasts", args.id);
    return null;
  },
});

export const send = mutation({
  args: { id: v.id("platformBroadcasts"), at: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireModify(ctx, "notifications");
    const row = await ctx.db.get("platformBroadcasts", args.id);
    if (!row) throw new ConvexError("That notification no longer exists.");
    if (row.status !== "draft" && row.status !== "scheduled") {
      throw new ConvexError("This notification has already been sent.");
    }
    requireSendable(row);

    const now = Date.now();
    if (args.at && args.at > now + 60_000) {
      await ctx.db.patch("platformBroadcasts", args.id, {
        status: "scheduled",
        scheduledAt: args.at,
        updatedAt: now,
      });
      return { status: "scheduled" as const };
    }

    await ctx.db.patch("platformBroadcasts", args.id, {
      status: "sending",
      scheduledAt: undefined,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.platformNotificationsSend.run, { broadcastId: args.id });
    return { status: "sending" as const };
  },
});

export const cancel = mutation({
  args: { id: v.id("platformBroadcasts") },
  handler: async (ctx, args) => {
    await requireModify(ctx, "notifications");
    const row = await ctx.db.get("platformBroadcasts", args.id);
    if (!row) throw new ConvexError("That notification no longer exists.");
    if (row.status === "scheduled") {
      await ctx.db.patch("platformBroadcasts", args.id, {
        status: "draft",
        scheduledAt: undefined,
        updatedAt: Date.now(),
      });
      return null;
    }
    if (row.status !== "sending") throw new ConvexError("Only a scheduled or sending notification can be stopped.");
    await ctx.db.patch("platformBroadcasts", args.id, {
      status: "cancelled",
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ------------------------------------------------------------------ sending

export const requireAuthor = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireModify(ctx, "notifications");
    return null;
  },
});

export const testContext = internalQuery({
  args: { id: v.id("platformBroadcasts") },
  handler: async (ctx, args) => {
    const principal = await requireModify(ctx, "notifications");
    const row = await ctx.db.get("platformBroadcasts", args.id);
    if (!row) throw new ConvexError("That notification no longer exists.");
    return { broadcast: row, email: principal.label };
  },
});

export const claimDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("platformBroadcasts")
      .withIndex("by_status_and_scheduledAt", (q) =>
        q.eq("status", "scheduled").lte("scheduledAt", now)
      )
      .take(10);
    for (const [index, row] of due.entries()) {
      await ctx.db.patch("platformBroadcasts", row._id, {
        status: "sending",
        startedAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(index * 2000, internal.platformNotificationsSend.run, {
        broadcastId: row._id,
      });
    }
  },
});

export const page = internalQuery({
  args: { broadcastId: v.id("platformBroadcasts"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get("platformBroadcasts", args.broadcastId);
    if (!broadcast || broadcast.status !== "sending") return null;

    const result = await ctx.db
      .query("workspaces")
      .paginate({ numItems: PAGE, cursor: args.cursor });
    const users = await ctx.db.query("users").take(MAX_USERS);
    const targets: Target[] = [];
    for (const workspace of result.page) {
      if (!(await inAudience(ctx, workspace, broadcast.audience, broadcast.reach))) continue;
      targets.push(await targetFor(ctx, workspace, users));
    }
    return {
      broadcast,
      imageUrl: broadcast.imageKey ? fileUrl(broadcast.imageKey) : null,
      targets,
      nextCursor: result.continueCursor,
      done: result.isDone,
    };
  },
});

/**
 * Takes the recipients nobody has had this notification at yet. Someone on
 * several workspaces is one recipient, and a retried page sends nothing twice.
 */
export const claim = internalMutation({
  args: {
    broadcastId: v.id("platformBroadcasts"),
    items: v.array(
      v.object({ workspaceId: v.id("workspaces"), channel: broadcastChannel, recipient: v.string() })
    ),
  },
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get("platformBroadcasts", args.broadcastId);
    if (!broadcast || broadcast.status !== "sending") return null;
    const offer = broadcast.category === "offer";
    const now = Date.now();
    const seen = new Set<string>();
    const claimed: {
      workspaceId: Id<"workspaces">;
      channel: Infer<typeof broadcastChannel>;
      recipient: string;
      optOutToken?: string;
    }[] = [];
    const skipped = { email: 0, sms: 0 };

    for (const item of args.items) {
      const key = `${item.channel}:${item.recipient}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = await ctx.db
        .query("platformDeliveries")
        .withIndex("by_broadcast_and_channel_and_recipient", (q) =>
          q.eq("broadcastId", args.broadcastId).eq("channel", item.channel).eq("recipient", item.recipient)
        )
        .first();
      if (existing) continue;

      let optOutToken: string | undefined;
      if (offer && item.channel !== "push") {
        const channel = item.channel;
        const optOut = await ctx.db
          .query("platformOptOuts")
          .withIndex("by_channel_and_address", (q) =>
            q.eq("channel", channel).eq("address", item.recipient)
          )
          .first();
        if (optOut?.optedOutAt) {
          await ctx.db.insert("platformDeliveries", {
            broadcastId: args.broadcastId,
            workspaceId: item.workspaceId,
            channel: item.channel,
            recipient: item.recipient,
            status: "skipped",
            detail: "Unsubscribed from offers",
            createdAt: now,
            updatedAt: now,
          });
          skipped[channel] += 1;
          continue;
        }
        optOutToken = optOut?.token;
        if (!optOutToken && channel === "email") {
          optOutToken = crypto.randomUUID().replace(/-/g, "");
          await ctx.db.insert("platformOptOuts", {
            channel,
            address: item.recipient,
            token: optOutToken,
            createdAt: now,
          });
        }
      }

      await ctx.db.insert("platformDeliveries", {
        broadcastId: args.broadcastId,
        workspaceId: item.workspaceId,
        channel: item.channel,
        recipient: item.recipient,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      claimed.push({ ...item, optOutToken });
    }

    if (skipped.email || skipped.sms) {
      await ctx.db.patch("platformBroadcasts", args.broadcastId, {
        email: { ...broadcast.email, skipped: broadcast.email.skipped + skipped.email },
        sms: { ...broadcast.sms, skipped: broadcast.sms.skipped + skipped.sms },
      });
    }
    return claimed;
  },
});

const result = v.object({
  channel: broadcastChannel,
  recipient: v.string(),
  status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
  detail: v.optional(v.string()),
  sent: v.optional(v.number()),
  failed: v.optional(v.number()),
});

export const record = internalMutation({
  args: {
    broadcastId: v.id("platformBroadcasts"),
    results: v.array(result),
    inbox: v.array(v.id("workspaces")),
    workspaces: v.number(),
    nextCursor: v.string(),
    done: v.boolean(),
  },
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get("platformBroadcasts", args.broadcastId);
    if (!broadcast) return;
    const now = Date.now();
    const stats = {
      push: { ...broadcast.push },
      email: { ...broadcast.email },
      sms: { ...broadcast.sms },
    };

    for (const item of args.results) {
      const row = await ctx.db
        .query("platformDeliveries")
        .withIndex("by_broadcast_and_channel_and_recipient", (q) =>
          q.eq("broadcastId", args.broadcastId).eq("channel", item.channel).eq("recipient", item.recipient)
        )
        .first();
      if (row) {
        await ctx.db.patch("platformDeliveries", row._id, {
          status: item.status,
          detail: item.detail?.slice(0, 300),
          updatedAt: now,
        });
      }
      const bucket = stats[item.channel];
      if (item.channel === "push") {
        bucket.sent += item.sent ?? 0;
        bucket.failed += item.failed ?? 0;
        if (item.status === "skipped") bucket.skipped += 1;
      } else {
        bucket[item.status] += 1;
      }
    }

    for (const workspaceId of args.inbox) {
      await ctx.db.insert("pushInbox", {
        workspaceId,
        event: "platform_announcement",
        title: broadcast.title,
        body: broadcast.body,
        link: broadcast.link,
        createdAt: now,
      });
    }

    const stopped = broadcast.status !== "sending";
    await ctx.db.patch("platformBroadcasts", args.broadcastId, {
      ...stats,
      workspaces: broadcast.workspaces + args.workspaces,
      cursor: args.nextCursor,
      ...(args.done && !stopped ? { status: "sent" as const, finishedAt: now } : {}),
      updatedAt: now,
    });
  },
});

export const fail = internalMutation({
  args: { broadcastId: v.id("platformBroadcasts"), error: v.string() },
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get("platformBroadcasts", args.broadcastId);
    if (!broadcast || broadcast.status !== "sending") return;
    await ctx.db.patch("platformBroadcasts", args.broadcastId, {
      status: "failed",
      error: args.error.slice(0, 500),
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// ------------------------------------------------------------------ opt-out

export const optOutInfo = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("platformOptOuts")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) return null;
    const [name, domain] = row.address.split("@");
    const masked = domain ? `${name.slice(0, 2)}•••@${domain}` : `•••${row.address.slice(-4)}`;
    return { address: masked, optedOut: row.optedOutAt !== undefined };
  },
});

export const optOut = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("platformOptOuts")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) return false;
    if (row.optedOutAt === undefined) {
      await ctx.db.patch("platformOptOuts", row._id, { optedOutAt: Date.now() });
    }
    return true;
  },
});
