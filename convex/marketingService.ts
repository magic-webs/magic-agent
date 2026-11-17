// What the marketing service asks Convex for while it sends: the sending
// channel and the plan and wallet checks, and the charge for what went out.
// Reached over the signed /marketing-service/* routes in http.ts.

import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { requireWorkspace } from "./lib/auth";
import { internalMutation } from "./functions";
import { sendingChannel } from "./marketing";
import { deskBlock } from "./lib/account";
import { billingEventFor, charge } from "./lib/charge";
import { templateBlock } from "./lib/wallet";

const category = v.union(v.literal("marketing"), v.literal("utility"), v.literal("authentication"));

export const context = internalQuery({
  args: { workspaceId: v.id("workspaces"), category },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    const channel = await sendingChannel(ctx, args.workspaceId);
    const desk = await ctx.db
      .query("agents")
      .withIndex("by_workspace_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", "marketing"))
      .first();
    return {
      workspaceName: workspace.name,
      timezone: workspace.timezone,
      locale: workspace.locale ?? null,
      agentId: desk?._id ?? null,
      deskModel: desk?.model ?? null,
      channelId: channel?._id ?? null,
      filesBaseUrl: process.env.R2_PUBLIC_URL ?? null,
      deskBlock: await deskBlock(ctx, args.workspaceId, "marketing"),
      walletBlock: await templateBlock(ctx, args.workspaceId, args.category),
      channel: channel?.whatsapp
        ? {
            apiBaseUrl: channel.whatsapp.apiBaseUrl,
            apiVersion: channel.whatsapp.apiVersion,
            phoneNumberId: channel.whatsapp.phoneNumberId,
            accessToken: channel.whatsapp.accessToken,
          }
        : null,
    };
  },
});

export const charges = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    channelId: v.optional(v.id("channels")),
    category,
    templateName: v.optional(v.string()),
    eventId: v.optional(v.id("marketingEvents")),
    items: v.array(v.object({ to: v.string(), wamid: v.optional(v.string()), preview: v.string() })),
  },
  handler: async (ctx, args) => {
    let charged = 0;
    for (const item of args.items) {
      // Retried deliveries must not bill the same message twice.
      if (item.wamid && (await billingEventFor(ctx, item.wamid))) continue;
      charged++;
      await charge(ctx, {
        workspaceId: args.workspaceId,
        channelId: args.channelId,
        to: item.to,
        category: args.category,
        source: "campaign",
        preview: item.preview,
        templateName: args.templateName,
        wamid: item.wamid,
        marketingEventId: args.eventId,
      });
    }
    return { charged };
  },
});

export const access = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const principal = await requireWorkspace(ctx, args.workspaceId);
    return { label: principal.label };
  },
});
