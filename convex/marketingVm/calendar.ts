import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { sendingChannel } from "../marketing";

const BILLING_SCAN = 8000;

type OverviewInfo = {
  timezone: string;
  desk: { _id: Id<"agents">; botName: string } | null;
  channel: { name: string; phone: string | null } | null;
  filesBaseUrl: string | null;
};

export const overviewInfo = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<OverviewInfo | null> => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    const desk = await ctx.db
      .query("agents")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", "marketing"))
      .first();
    const channel = await sendingChannel(ctx, args.workspaceId);
    return {
      timezone: workspace.timezone,
      desk: desk ? { _id: desk._id, botName: desk.botName } : null,
      channel: channel ? { name: channel.name, phone: channel.whatsapp?.displayPhoneNumber ?? null } : null,
      filesBaseUrl: process.env.R2_PUBLIC_URL ?? null,
    };
  },
});

export const spend = internalQuery({
  args: { workspaceId: v.id("workspaces"), since: v.number() },
  handler: async (ctx, args): Promise<{ micros: number; currency: string | null; partial: boolean }> => {
    const billing = await ctx.db
      .query("billingEvents")
      .withIndex("by_workspace_createdAt", (q) => q.eq("workspaceId", args.workspaceId).gte("createdAt", args.since))
      .take(BILLING_SCAN);
    let micros = 0;
    let currency: string | null = null;
    for (const row of billing) {
      if (row.source !== "campaign") continue;
      micros += row.amountMicros;
      currency = row.currency;
    }
    return { micros, currency, partial: billing.length >= BILLING_SCAN };
  },
});

export const birthdayWorkspaces = internalQuery({
  args: { workspaceIds: v.array(v.id("workspaces")) },
  handler: async (ctx, args): Promise<Array<{ workspaceId: Id<"workspaces">; timezone: string; active: boolean }>> => {
    const out: Array<{ workspaceId: Id<"workspaces">; timezone: string; active: boolean }> = [];
    for (const workspaceId of args.workspaceIds.slice(0, 500)) {
      const workspace = await ctx.db.get("workspaces", workspaceId);
      if (!workspace) continue;
      out.push({ workspaceId, timezone: workspace.timezone, active: workspace.status === "active" });
    }
    return out;
  },
});
