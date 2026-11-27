// Mirrors every wallet credit onto the partner panel's channel wallet, so the
// WhatsApp number's balance there moves with the Magic Agent wallet.

import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { errorText, providerError, request } from "./lib/panel";

const PAGE_SIZE = 20;
const MAX_PAGES = 50;

type PartnerChannel = {
  _id: string;
  basic_details?: { channel_identity?: string };
  billing?: { currency?: string };
  cloud?: { phone_number_id?: string };
  permanent_disabled?: boolean;
};

function partnerConfig() {
  const baseUrl = process.env.PARTNER_API_URL?.trim().replace(/\/$/, "");
  const token = process.env.PARTNER_API_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

async function partnerGet(
  config: { baseUrl: string; token: string },
  query: string
): Promise<PartnerChannel[]> {
  const response = await request(`${config.baseUrl}/api/v1/crm/channel?${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) {
    throw new Error(providerError(response.status, response.body, response.text));
  }
  const data = (response.body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as PartnerChannel[]) : [];
}

async function findChannel(
  config: { baseUrl: string; token: string },
  phoneNumberId: string,
  displayPhoneNumber: string | undefined
): Promise<PartnerChannel | null> {
  const pick = (rows: PartnerChannel[]) =>
    rows.find((row) => row.cloud?.phone_number_id === phoneNumberId && !row.permanent_disabled) ??
    rows.find((row) => row.cloud?.phone_number_id === phoneNumberId) ??
    null;

  const digits = displayPhoneNumber?.replace(/\D/g, "");
  if (digits) {
    const hit = pick(await partnerGet(config, `search=${encodeURIComponent(digits)}`));
    if (hit) return hit;
  }
  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await partnerGet(config, `page=${page}`);
    const hit = pick(rows);
    if (hit) return hit;
    if (rows.length < PAGE_SIZE) break;
  }
  return null;
}

export const context = internalQuery({
  args: { transactionId: v.id("walletTransactions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get("walletTransactions", args.transactionId);
    if (!row) return null;
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", row.workspaceId))
      .unique();
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", row.workspaceId))
      .collect();
    const whatsapp = channels
      .filter((channel) => channel.type === "whatsapp" && channel.whatsapp)
      .sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
    const channel = whatsapp[0]?.whatsapp;
    return {
      amountMicros: row.amountMicros,
      currency: wallet?.currency ?? "INR",
      synced: row.partnerSync?.status === "done",
      phoneNumberId: channel?.phoneNumberId ?? null,
      displayPhoneNumber: channel?.displayPhoneNumber,
    };
  },
});

export const record = internalMutation({
  args: {
    transactionId: v.id("walletTransactions"),
    status: v.union(v.literal("done"), v.literal("skipped"), v.literal("failed")),
    channelId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("walletTransactions", args.transactionId, {
      partnerSync: {
        status: args.status,
        channelId: args.channelId,
        error: args.error?.slice(0, 300),
        at: Date.now(),
      },
    });
    return null;
  },
});

export const sync = internalAction({
  args: { transactionId: v.id("walletTransactions") },
  handler: async (ctx, args): Promise<null> => {
    const done = (
      status: "done" | "skipped" | "failed",
      extra: { channelId?: string; error?: string } = {}
    ): Promise<null> =>
      ctx.runMutation(internal.partnerWallet.record, {
        transactionId: args.transactionId,
        status,
        ...extra,
      });

    const config = partnerConfig();
    if (!config) return await done("skipped", { error: "Partner API is not configured." });
    const row: {
      amountMicros: number;
      currency: string;
      synced: boolean;
      phoneNumberId: string | null;
      displayPhoneNumber?: string;
    } | null = await ctx.runQuery(internal.partnerWallet.context, args);
    if (!row || row.synced || row.amountMicros === 0) return null;
    if (!row.phoneNumberId) {
      return await done("skipped", { error: "No WhatsApp channel connected." });
    }

    try {
      const channel = await findChannel(config, row.phoneNumberId, row.displayPhoneNumber);
      if (!channel) {
        return await done("skipped", { error: "No partner channel for this number." });
      }
      const channelCurrency = channel.billing?.currency ?? "INR";
      if (channelCurrency !== row.currency) {
        return await done("skipped", {
          channelId: channel._id,
          error: `Partner channel bills in ${channelCurrency}, wallet in ${row.currency}.`,
        });
      }
      const response = await request(
        `${config.baseUrl}/api/v1/crm/channel/${encodeURIComponent(channel._id)}/wallet`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({
            module: "balance",
            action: row.amountMicros > 0 ? "deposit" : "withdraw",
            balance: Math.round(Math.abs(row.amountMicros) / 10_000) / 100,
          }),
        }
      );
      const success = (response.body as { success?: unknown } | null)?.success;
      if (!response.ok || success === false) {
        return await done("failed", {
          channelId: channel._id,
          error: providerError(response.status, response.body, response.text),
        });
      }
      return await done("done", { channelId: channel._id });
    } catch (error) {
      console.error("[partnerWallet] sync failed", error);
      return await done("failed", { error: errorText(error) });
    }
  },
});
