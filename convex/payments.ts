import { ConvexError, v } from "convex/values";
import {
  action,
  internalQuery,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { publicSiteUrl } from "./lib/publicUrl";
import { maskSecret, randomKey, readableError } from "./lib/shared";
import { openSecret, sealSecret, secretBoxReady } from "./lib/secretBox";
import { razorpay, RazorpayError, toSeconds, fromSeconds } from "./lib/razorpay";
import {
  DEFAULT_LINK_EXPIRY_HOURS,
  formatMoney,
  isFinalStatus,
  MAX_LINK_EXPIRY_HOURS,
  parseAmount,
  PAYMENT_TOOL_NAMES,
  paymentPhone,
  razorpayKeyMode,
  razorpayWebhookUrl,
  type PaymentLinkStatus,
} from "./lib/payments";
import { normaliseEmail } from "./lib/notifications";
import { paymentLinkStatus } from "./schema/payments";

const DEFAULT_PAID_STAGE = "Confirmed";

async function connectionFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"paymentConnections"> | null> {
  return await ctx.db
    .query("paymentConnections")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

async function recordByReference(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  reference: string
): Promise<Doc<"records"> | null> {
  const find = (value: string) =>
    ctx.db
      .query("records")
      .withIndex("by_workspace_reference", (q) =>
        q.eq("workspaceId", workspaceId).eq("reference", value)
      )
      .first();
  const trimmed = reference.trim();
  return (await find(trimmed)) ?? (await find(trimmed.toUpperCase()));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const connection = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const row = await connectionFor(ctx, args.workspaceId);
    return {
      available: secretBoxReady(),
      connection: row
        ? {
            keyId: maskSecret(row.keyId) ?? row.keyId,
            mode: row.mode,
            webhookUrl: razorpayWebhookUrl(publicSiteUrl(), row.inboundKey),
            webhookSecret: row.webhookSecret,
            currency: row.currency,
            notifySms: row.notifySms,
            notifyEmail: row.notifyEmail,
            expiryHours: row.expiryHours,
            paidStage: row.paidStage ?? DEFAULT_PAID_STAGE,
            status: row.status,
            lastError: row.lastError,
            lastWebhookAt: row.lastWebhookAt,
            connectedAt: row.createdAt,
          }
        : null,
    };
  },
});

export const isConnected = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return Boolean(await connectionFor(ctx, args.workspaceId));
  },
});

export const listLinks = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(paymentLinkStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = args.status
      ? await ctx.db
          .query("paymentLinks")
          .withIndex("by_workspace_status", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("status", args.status!)
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("paymentLinks")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
          .order("desc")
          .take(limit);

    const agentNames = new Map<string, string>();
    for (const row of rows) {
      if (row.agentId && !agentNames.has(row.agentId)) {
        const agent = await ctx.db.get("agents", row.agentId);
        agentNames.set(row.agentId, agent?.name ?? "Agent");
      }
    }

    return rows.map((row) => ({
      id: row._id,
      razorpayLinkId: row.razorpayLinkId,
      url: row.shortUrl,
      amountPaise: row.amountPaise,
      amountPaidPaise: row.amountPaidPaise,
      currency: row.currency,
      description: row.description,
      status: row.status,
      customer: row.customer,
      recordId: row.recordId,
      recordReference: row.recordReference,
      conversationId: row.conversationId,
      source: row.source,
      agentName: row.agentId ? agentNames.get(row.agentId) : undefined,
      razorpayPaymentId: row.razorpayPaymentId,
      method: row.method,
      expiresAt: row.expiresAt,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
    }));
  },
});

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

export const connect = action({
  args: {
    workspaceId: v.id("workspaces"),
    keyId: v.string(),
    keySecret: v.string(),
  },
  handler: async (ctx, args): Promise<{ mode: "live" | "test" }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });

    const keyId = args.keyId.trim();
    const keySecret = args.keySecret.trim();
    const mode = razorpayKeyMode(keyId);
    if (!mode) {
      throw new ConvexError(
        "That isn't a Razorpay Key ID. It starts with rzp_live_ or rzp_test_ — find it under Account & Settings → API Keys."
      );
    }
    if (!keySecret) throw new ConvexError("Paste the Key Secret too.");

    try {
      await razorpay({ keyId, keySecret }, "GET", "/payment_links?count=1");
    } catch (error) {
      if (error instanceof RazorpayError && error.status === 401) {
        throw new ConvexError(
          "Razorpay rejected those keys. Check that the Key ID and Key Secret are from the same pair."
        );
      }
      throw new ConvexError(
        readableError(error instanceof Error ? error.message : "Razorpay could not be reached.")
      );
    }

    await ctx.runMutation(internal.payments.saveConnection, {
      workspaceId: args.workspaceId,
      keyId,
      keySecret: await sealSecret(keySecret),
      mode,
      inboundKey: `${randomKey(16)}${randomKey(16)}`,
      webhookSecret: randomKey(32),
    });
    return { mode };
  },
});

export const saveConnection = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    keyId: v.string(),
    keySecret: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    inboundKey: v.string(),
    webhookSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await connectionFor(ctx, args.workspaceId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        keyId: args.keyId,
        keySecret: args.keySecret,
        mode: args.mode,
        status: "connected",
        lastError: undefined,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("paymentConnections", {
      workspaceId: args.workspaceId,
      provider: "razorpay",
      keyId: args.keyId,
      keySecret: args.keySecret,
      mode: args.mode,
      inboundKey: args.inboundKey,
      webhookSecret: args.webhookSecret,
      currency: "INR",
      notifySms: true,
      notifyEmail: true,
      expiryHours: DEFAULT_LINK_EXPIRY_HOURS,
      status: "connected",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateSettings = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    notifySms: v.optional(v.boolean()),
    notifyEmail: v.optional(v.boolean()),
    expiryHours: v.optional(v.number()),
    paidStage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const row = await connectionFor(ctx, args.workspaceId);
    if (!row) throw new ConvexError("Razorpay is not connected.");
    await ctx.db.patch(row._id, {
      ...(args.notifySms === undefined ? {} : { notifySms: args.notifySms }),
      ...(args.notifyEmail === undefined ? {} : { notifyEmail: args.notifyEmail }),
      ...(args.expiryHours === undefined
        ? {}
        : { expiryHours: clampHours(args.expiryHours) }),
      ...(args.paidStage === undefined
        ? {}
        : { paidStage: args.paidStage.trim() || undefined }),
      updatedAt: Date.now(),
    });
  },
});

export const disconnect = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const row = await connectionFor(ctx, args.workspaceId);
    if (row) await ctx.db.delete(row._id);

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const agent of agents) {
      const enabled = agent.integrationTools ?? [];
      const kept = enabled.filter((name) => !PAYMENT_TOOL_NAMES.includes(name));
      if (kept.length === enabled.length) continue;
      await ctx.db.patch(agent._id, { integrationTools: kept, updatedAt: Date.now() });
    }
  },
});

function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_LINK_EXPIRY_HOURS;
  return Math.min(Math.max(Math.round(hours), 1), MAX_LINK_EXPIRY_HOURS);
}

// ---------------------------------------------------------------------------
// Internal reads
// ---------------------------------------------------------------------------

export const secrets = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const row = await connectionFor(ctx, args.workspaceId);
    if (!row) return null;
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    return { ...row, workspaceName: workspace?.name ?? "" };
  },
});

export const forAgent = internalQuery({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args): Promise<string[]> => {
    const agent = await ctx.db.get("agents", args.agentId);
    const enabled = (agent?.integrationTools ?? []).filter((name) =>
      PAYMENT_TOOL_NAMES.includes(name)
    );
    if (!agent || enabled.length === 0) return [];
    const row = await connectionFor(ctx, agent.workspaceId);
    return row ? enabled : [];
  },
});

export const byInboundKey = internalQuery({
  args: { inboundKey: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("paymentConnections")
      .withIndex("by_inboundKey", (q) => q.eq("inboundKey", args.inboundKey))
      .unique();
    return row ? { id: row._id, webhookSecret: row.webhookSecret } : null;
  },
});

export const recordForReference = internalQuery({
  args: { workspaceId: v.id("workspaces"), reference: v.string() },
  handler: async (ctx, args) => {
    const record = await recordByReference(ctx, args.workspaceId, args.reference);
    if (!record) return null;
    const total = record.values.find((pair) => pair.key === "total")?.value;
    return {
      id: record._id,
      reference: record.reference,
      total: parseAmount(total),
      person: record.person,
      conversationId: record.conversationId,
      contactId: record.contactId,
    };
  },
});

export const linksForLookup = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.optional(v.id("conversations")),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"paymentLinks">[]> => {
    const reference = args.reference?.trim();
    if (reference && /^plink_/i.test(reference)) {
      const row = await ctx.db
        .query("paymentLinks")
        .withIndex("by_razorpay_link", (q) => q.eq("razorpayLinkId", reference))
        .unique();
      return row && row.workspaceId === args.workspaceId ? [row] : [];
    }
    if (reference) {
      const record = await recordByReference(ctx, args.workspaceId, reference);
      if (!record) return [];
      return await ctx.db
        .query("paymentLinks")
        .withIndex("by_record", (q) => q.eq("recordId", record._id))
        .order("desc")
        .take(5);
    }
    if (!args.conversationId) return [];
    return await ctx.db
      .query("paymentLinks")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(5);
  },
});

export const linkInWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces"), linkId: v.id("paymentLinks") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("paymentLinks", args.linkId);
    return row && row.workspaceId === args.workspaceId ? row : null;
  },
});

// ---------------------------------------------------------------------------
// Writing links
// ---------------------------------------------------------------------------

export const insertLink = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    connectionId: v.id("paymentConnections"),
    razorpayLinkId: v.string(),
    referenceId: v.string(),
    shortUrl: v.string(),
    amountPaise: v.number(),
    currency: v.string(),
    description: v.string(),
    customer: v.object({
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
    }),
    recordId: v.optional(v.id("records")),
    recordReference: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
    agentId: v.optional(v.id("agents")),
    source: v.union(v.literal("agent"), v.literal("team")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("paymentLinks", {
      ...args,
      amountPaidPaise: 0,
      status: "created",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markConnectionError = internalMutation({
  args: { connectionId: v.id("paymentConnections"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      status: "error",
      lastError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });
  },
});

export const applyLinkStatus = internalMutation({
  args: {
    connectionId: v.id("paymentConnections"),
    razorpayLinkId: v.string(),
    status: paymentLinkStatus,
    amountPaidPaise: v.optional(v.number()),
    paymentId: v.optional(v.string()),
    method: v.optional(v.string()),
    fromWebhook: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.fromWebhook) {
      await ctx.db.patch(args.connectionId, { lastWebhookAt: now });
    }

    const link = await ctx.db
      .query("paymentLinks")
      .withIndex("by_razorpay_link", (q) => q.eq("razorpayLinkId", args.razorpayLinkId))
      .unique();
    if (!link || link.connectionId !== args.connectionId) return { applied: false };

    if (link.status === "paid" && args.status !== "paid") return { applied: false };

    const becamePaid = args.status === "paid" && link.status !== "paid";
    const lapsed =
      (args.status === "expired" || args.status === "cancelled") &&
      link.status !== args.status;
    const amountPaidPaise =
      args.amountPaidPaise ?? (args.status === "paid" ? link.amountPaise : link.amountPaidPaise);

    await ctx.db.patch(link._id, {
      status: args.status,
      amountPaidPaise,
      razorpayPaymentId: args.paymentId ?? link.razorpayPaymentId,
      method: args.method ?? link.method,
      paidAt: becamePaid ? now : link.paidAt,
      updatedAt: now,
    });

    const amount = formatMoney(becamePaid ? amountPaidPaise : link.amountPaise, link.currency);

    if ((becamePaid || lapsed) && link.conversationId) {
      await ctx.db.insert("messages", {
        workspaceId: link.workspaceId,
        conversationId: link.conversationId,
        role: "system",
        kind: "note",
        text: becamePaid
          ? `Payment received: ${amount} for “${link.description}”${args.paymentId ? ` (${args.paymentId})` : ""}.`
          : `Payment link for ${amount} ${args.status === "expired" ? "expired" : "was cancelled"} unpaid.`,
        createdAt: now,
      });
    }

    if (becamePaid && link.recordId) {
      const record = await ctx.db.get("records", link.recordId);
      const book = record ? await ctx.db.get("recordBooks", record.bookId) : null;
      if (record && book) {
        const connection = await ctx.db.get("paymentConnections", args.connectionId);
        const target = connection?.paidStage ?? DEFAULT_PAID_STAGE;
        const targetIndex = book.stages.indexOf(target);
        const currentIndex = record.stage ? book.stages.indexOf(record.stage) : -1;
        const moveStage = targetIndex >= 0 && currentIndex < targetIndex;
        const line = `Paid ${amount} via Razorpay${args.paymentId ? ` (${args.paymentId})` : ""}.`;

        await ctx.db.patch(record._id, {
          stage: moveStage ? target : record.stage,
          notes: record.notes ? `${record.notes}\n${line}` : line,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.records.announce, {
          recordId: record._id,
          event: moveStage ? "stage_changed" : "updated",
          previousStage: moveStage ? record.stage : undefined,
          byAgent: true,
        });
      }
    }

    return { applied: true };
  },
});

// ---------------------------------------------------------------------------
// Razorpay calls, shared by the agent tools, the console and the MCP server
// ---------------------------------------------------------------------------

type RazorpayLink = {
  id: string;
  short_url: string;
  status: string;
  amount: number;
  amount_paid?: number;
  currency?: string;
  expire_by?: number;
  payments?: Array<{ payment_id?: string; method?: string; status?: string }> | null;
};

async function requireSecrets(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const row = await ctx.runQuery(internal.payments.secrets, { workspaceId });
  if (!row) throw new ConvexError("Razorpay is not connected for this workspace.");
  return {
    row,
    config: { keyId: row.keyId, keySecret: await openSecret(row.keySecret) },
  };
}

async function razorpayCall<T>(
  ctx: ActionCtx,
  connectionId: Id<"paymentConnections">,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RazorpayError && error.status === 401) {
      await ctx.runMutation(internal.payments.markConnectionError, {
        connectionId,
        error: "Razorpay rejected the saved keys.",
      });
      throw new ConvexError(
        "Razorpay rejected the company's keys. The team needs to reconnect Razorpay."
      );
    }
    throw new ConvexError(
      readableError(error instanceof Error ? error.message : "Razorpay could not be reached.")
    );
  }
}

const knownStatus = (status: string): PaymentLinkStatus =>
  (["created", "partially_paid", "paid", "expired", "cancelled"] as const).find(
    (value) => value === status
  ) ?? "created";

export type CreatedPaymentLink = {
  id: Id<"paymentLinks">;
  razorpayLinkId: string;
  url: string;
  amount: string;
  amountPaise: number;
  currency: string;
  expiresAt?: number;
  reference?: string;
};

export async function createPaymentLink(
  ctx: ActionCtx,
  input: {
    workspaceId: Id<"workspaces">;
    amount?: number | null;
    description: string;
    customer: { name?: string; phone?: string; email?: string };
    recordReference?: string;
    expiresInHours?: number;
    conversationId?: Id<"conversations">;
    contactId?: Id<"contacts">;
    agentId?: Id<"agents">;
    source: "agent" | "team";
  }
): Promise<CreatedPaymentLink> {
  const { row, config } = await requireSecrets(ctx, input.workspaceId);

  const reference = input.recordReference?.trim();
  const record = reference
    ? await ctx.runQuery(internal.payments.recordForReference, {
        workspaceId: input.workspaceId,
        reference,
      })
    : null;
  if (reference && !record) {
    throw new ConvexError(`There is no record with the reference ${reference}.`);
  }

  const amount = input.amount ?? record?.total ?? null;
  if (amount === null || amount <= 0) {
    throw new ConvexError(
      record
        ? `${record.reference} has no total, so send the amount to charge.`
        : "Send the amount to charge."
    );
  }
  const amountPaise = Math.round(amount * 100);
  if (amountPaise < 100) throw new ConvexError("The smallest amount Razorpay takes is 1.00.");

  const description = input.description.trim().slice(0, 2000);
  if (!description) throw new ConvexError("Say what the payment is for.");

  const name = input.customer.name?.trim() || record?.person?.name || undefined;
  const phone = paymentPhone(input.customer.phone || record?.person?.phone);
  const email =
    normaliseEmail(input.customer.email || record?.person?.email || "") ?? undefined;

  const hours = clampHours(input.expiresInHours ?? row.expiryHours);
  const expiresAt = Date.now() + hours * 3600 * 1000;
  const referenceId = `ma_${randomKey(20)}`;

  const created = await razorpayCall(ctx, row._id, () =>
    razorpay<RazorpayLink>(config, "POST", "/payment_links", {
      amount: amountPaise,
      currency: row.currency,
      accept_partial: false,
      description,
      reference_id: referenceId,
      expire_by: toSeconds(expiresAt),
      ...(name || phone || email
        ? {
            customer: {
              ...(name ? { name } : {}),
              ...(phone ? { contact: phone } : {}),
              ...(email ? { email } : {}),
            },
          }
        : {}),
      notify: { sms: row.notifySms && Boolean(phone), email: row.notifyEmail && Boolean(email) },
      reminder_enable: true,
      notes: {
        workspace: row.workspaceName.slice(0, 250),
        ...(record ? { reference: record.reference } : {}),
      },
    })
  );

  const id = await ctx.runMutation(internal.payments.insertLink, {
    workspaceId: input.workspaceId,
    connectionId: row._id,
    razorpayLinkId: created.id,
    referenceId,
    shortUrl: created.short_url,
    amountPaise,
    currency: row.currency,
    description,
    customer: { name, phone, email },
    recordId: record?.id,
    recordReference: record?.reference,
    conversationId: input.conversationId ?? record?.conversationId,
    contactId: input.contactId ?? record?.contactId,
    agentId: input.agentId,
    source: input.source,
    expiresAt: fromSeconds(created.expire_by) ?? expiresAt,
  });

  return {
    id,
    razorpayLinkId: created.id,
    url: created.short_url,
    amount: formatMoney(amountPaise, row.currency),
    amountPaise,
    currency: row.currency,
    expiresAt,
    reference: record?.reference,
  };
}

export async function refreshPaymentLink(
  ctx: ActionCtx,
  link: Doc<"paymentLinks">
): Promise<PaymentLinkStatus> {
  if (isFinalStatus(link.status)) return link.status;
  const { row, config } = await requireSecrets(ctx, link.workspaceId);
  const remote = await razorpayCall(ctx, row._id, () =>
    razorpay<RazorpayLink>(config, "GET", `/payment_links/${link.razorpayLinkId}`)
  );
  const status = knownStatus(remote.status);
  const payment = remote.payments?.find((entry) => entry.status === "captured");
  await ctx.runMutation(internal.payments.applyLinkStatus, {
    connectionId: row._id,
    razorpayLinkId: link.razorpayLinkId,
    status,
    amountPaidPaise: remote.amount_paid,
    paymentId: payment?.payment_id,
    method: payment?.method,
    fromWebhook: false,
  });
  return status;
}

export const createLink = action({
  args: {
    workspaceId: v.id("workspaces"),
    amount: v.optional(v.number()),
    description: v.string(),
    customerName: v.optional(v.string()),
    customerPhone: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    recordReference: v.optional(v.string()),
    expiresInHours: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CreatedPaymentLink> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    return await createPaymentLink(ctx, {
      workspaceId: args.workspaceId,
      amount: args.amount,
      description: args.description,
      customer: {
        name: args.customerName,
        phone: args.customerPhone,
        email: args.customerEmail,
      },
      recordReference: args.recordReference || undefined,
      expiresInHours: args.expiresInHours,
      source: "team",
    });
  },
});

export const refreshLink = action({
  args: { workspaceId: v.id("workspaces"), linkId: v.id("paymentLinks") },
  handler: async (ctx, args): Promise<{ status: PaymentLinkStatus }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    const link = await ctx.runQuery(internal.payments.linkInWorkspace, args);
    if (!link) throw new ConvexError("Payment link not found.");
    return { status: await refreshPaymentLink(ctx, link) };
  },
});

export const cancelLink = action({
  args: { workspaceId: v.id("workspaces"), linkId: v.id("paymentLinks") },
  handler: async (ctx, args): Promise<{ status: PaymentLinkStatus }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    const link = await ctx.runQuery(internal.payments.linkInWorkspace, args);
    if (!link) throw new ConvexError("Payment link not found.");
    if (isFinalStatus(link.status)) return { status: link.status };

    const { row, config } = await requireSecrets(ctx, link.workspaceId);
    const remote = await razorpayCall(ctx, row._id, () =>
      razorpay<RazorpayLink>(config, "POST", `/payment_links/${link.razorpayLinkId}/cancel`)
    );
    const status = knownStatus(remote.status);
    await ctx.runMutation(internal.payments.applyLinkStatus, {
      connectionId: row._id,
      razorpayLinkId: link.razorpayLinkId,
      status,
      amountPaidPaise: remote.amount_paid,
      fromWebhook: false,
    });
    return { status };
  },
});
