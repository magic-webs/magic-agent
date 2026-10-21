/**
 * Charging one sent WhatsApp message: the ledger row, and the wallet debit.
 *
 * Its own file rather than a function in ./billing because that file is
 * imported by React for labels and formatting, and this one reaches the
 * wallet — and through it the scheduler and the generated API.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  aiPriceFor,
  aiReplyMicros,
  metaCategory,
  quote,
  workspaceCurrency,
  type BillingSource,
  type MessageCategory,
} from "./billing";
import { marketOf } from "./markets";
import { debitWallet, refundWallet } from "./wallet";

/** Clamped to what the ledger shows, so one long reply is not a long row. */
const PREVIEW_MAX = 140;

/**
 * Charge one sent message to its workspace, at the estimate.
 *
 * Called only after the provider accepted the message. The estimate assumes
 * Meta bills it; a message with a provider id is held as pending until the
 * status webhook says what Meta actually charged (`settle`), and one without
 * can never be matched, so it is settled at the estimate there and then.
 *
 * The amount comes off the wallet in the same transaction, so the balance and
 * the ledger cannot disagree about a message.
 */
export async function charge(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    conversationId?: Id<"conversations">;
    channelId?: Id<"channels">;
    to: string;
    category: MessageCategory;
    source: BillingSource;
    preview?: string;
    templateName?: string;
    wamid?: string;
    /** The AI charge on the agent reply this message carries. */
    aiEventId?: Id<"billingEvents">;
  }
): Promise<Id<"billingEvents">> {
  const now = Date.now();
  const priced = await quote(ctx, {
    workspaceId: args.workspaceId,
    market: marketOf(args.to),
    category: args.category,
    at: now,
  });
  const currency = priced.currency;

  const preview = args.preview?.replace(/\s+/g, " ").trim();
  const eventId = await ctx.db.insert("billingEvents", {
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    channelId: args.channelId,
    to: args.to,
    category: args.category,
    source: args.source,
    preview: preview ? preview.slice(0, PREVIEW_MAX) : undefined,
    templateName: args.templateName,
    currency,
    amountMicros: priced.amountMicros,
    rated: priced.rated,
    market: priced.market,
    metaCostMicros: priced.metaCostMicros,
    markupMicros: priced.markupMicros,
    wamid: args.wamid,
    status: args.wamid ? "pending" : "settled",
    createdAt: now,
  });

  await debitWallet(ctx, {
    workspaceId: args.workspaceId,
    currency,
    amountMicros: priced.amountMicros,
  });
  if (args.aiEventId) {
    await attachAi(ctx, args.workspaceId, eventId, args.aiEventId);
  }
  return eventId;
}

/** Show an AI charge as part of the WhatsApp message that carried the reply. */
async function attachAi(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  messageEventId: Id<"billingEvents">,
  aiEventId: Id<"billingEvents">
): Promise<void> {
  const ai = await ctx.db.get("billingEvents", aiEventId);
  if (!ai || ai.workspaceId !== workspaceId || ai.category !== "ai" || ai.mergedInto) {
    return;
  }
  await ctx.db.patch("billingEvents", messageEventId, { aiEventId });
  await ctx.db.patch("billingEvents", aiEventId, { mergedInto: messageEventId });
}

/**
 * Charge an agent's reply, on any channel, at its place in the conversation.
 * On WhatsApp the message itself is billed separately, as service, and the
 * two are shown to the account as one charge.
 *
 * `since` is when the turn started: a menu or buttons the agent sent during
 * it has already been billed, and carries the reply.
 */
export async function chargeAiReply(
  ctx: MutationCtx,
  args: { conversation: Doc<"conversations">; preview?: string; since?: number }
): Promise<Id<"billingEvents">> {
  const { conversation } = args;
  const now = Date.now();
  const reply = (conversation.aiReplyCount ?? 0) + 1;
  await ctx.db.patch("conversations", conversation._id, { aiReplyCount: reply });

  const contact = await ctx.db.get("contacts", conversation.contactId);
  const currency = await workspaceCurrency(ctx, conversation.workspaceId);
  const price = await aiPriceFor(ctx, conversation.workspaceId, currency);
  const amountMicros = price ? aiReplyMicros(price, reply) : 0;
  const preview = args.preview?.replace(/\s+/g, " ").trim();

  const eventId = await ctx.db.insert("billingEvents", {
    workspaceId: conversation.workspaceId,
    conversationId: conversation._id,
    channelId: conversation.channelId,
    to: contact?.externalId ?? "",
    category: "ai",
    replyNumber: reply,
    source: "agent",
    preview: preview ? preview.slice(0, PREVIEW_MAX) : undefined,
    currency,
    amountMicros,
    rated: price !== null,
    metaCostMicros: 0,
    markupMicros: amountMicros,
    status: "settled",
    settledAt: now,
    createdAt: now,
  });

  await debitWallet(ctx, {
    workspaceId: conversation.workspaceId,
    currency,
    amountMicros,
  });

  if (conversation.channelType === "whatsapp" && args.since !== undefined) {
    const since = args.since;
    const sent = await ctx.db
      .query("billingEvents")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", conversation.workspaceId).gte("createdAt", since)
      )
      .order("desc")
      .take(50);
    const carrier = sent.find(
      (row) =>
        row.conversationId === conversation._id &&
        row.category === "service" &&
        row.source === "agent" &&
        !row.aiEventId
    );
    if (carrier) {
      await attachAi(ctx, conversation.workspaceId, carrier._id, eventId);
    }
  }
  return eventId;
}

export async function billingEventFor(
  ctx: MutationCtx,
  wamid: string
): Promise<Doc<"billingEvents"> | null> {
  return await ctx.db
    .query("billingEvents")
    .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
    .first();
}

/** Move the wallet by what a repriced message changed by. */
async function rebill(
  ctx: MutationCtx,
  event: Doc<"billingEvents">,
  currency: string,
  amountMicros: number
) {
  if (currency === event.currency) {
    const delta = amountMicros - event.amountMicros;
    if (delta > 0) {
      await debitWallet(ctx, {
        workspaceId: event.workspaceId,
        currency,
        amountMicros: delta,
      });
    } else if (delta < 0) {
      await refundWallet(ctx, {
        workspaceId: event.workspaceId,
        currency,
        amountMicros: -delta,
      });
    }
    return;
  }
  await refundWallet(ctx, {
    workspaceId: event.workspaceId,
    currency: event.currency,
    amountMicros: event.amountMicros,
  });
  await debitWallet(ctx, {
    workspaceId: event.workspaceId,
    currency,
    amountMicros,
  });
}

/**
 * Reprice a held message by Meta's `pricing` on its status webhook: the
 * category Meta billed, at the rates in force when it was sent, or only the
 * free-message fee when Meta did not bill it at all.
 */
export async function settle(
  ctx: MutationCtx,
  event: Doc<"billingEvents">,
  pricing: { billable?: boolean; category?: string; type?: string }
): Promise<void> {
  if (event.status !== "pending" || event.category === "ai") return;
  const meta = metaCategory(pricing.category);
  const category = meta?.category ?? event.category;
  const priced = await quote(ctx, {
    workspaceId: event.workspaceId,
    market: event.market ?? marketOf(event.to),
    category,
    billable: pricing.billable !== false,
    international: meta?.international,
    at: event.createdAt,
  });
  const currency = priced.currency;
  await rebill(ctx, event, currency, priced.amountMicros);
  await ctx.db.patch("billingEvents", event._id, {
    category,
    currency,
    amountMicros: priced.amountMicros,
    rated: priced.rated,
    metaCostMicros: priced.metaCostMicros,
    markupMicros: priced.markupMicros,
    status: "settled",
    billable: pricing.billable !== false,
    pricingCategory: pricing.category,
    pricingType: pricing.type,
    settledAt: Date.now(),
  });
}

/** Meta does not charge for a message that was never delivered. */
export async function refund(
  ctx: MutationCtx,
  event: Doc<"billingEvents">
): Promise<void> {
  if (event.status === "refunded" || event.status === undefined) return;
  await refundWallet(ctx, {
    workspaceId: event.workspaceId,
    currency: event.currency,
    amountMicros: event.amountMicros,
  });
  await ctx.db.patch("billingEvents", event._id, {
    amountMicros: 0,
    metaCostMicros: 0,
    markupMicros: 0,
    status: "refunded",
    billable: false,
    settledAt: Date.now(),
  });
  // The reply never reached the customer, so neither is the AI charge on it.
  if (event.aiEventId) {
    const ai = await ctx.db.get("billingEvents", event.aiEventId);
    if (ai) await refund(ctx, ai);
  }
}
