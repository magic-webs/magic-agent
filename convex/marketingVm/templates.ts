import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ensureMarketingDesk } from "../agents";
import { marketingThread, sendingChannel, writeMarketingMessage } from "../marketing";
import { billingEventFor, charge } from "../lib/charge";
import { deleteFile, newFileKey, r2, uploadUrlFor } from "../lib/files";
import { normalisePhone } from "../lib/notifications";
import { HEADER_MEDIA_TYPES, type HeaderMedia } from "../lib/templateParts";

const ownKey = (workspaceId: Id<"workspaces">, key: string) => key.startsWith(`templates/${workspaceId}/`);

export const uploadUrl = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (_ctx, args) => await uploadUrlFor("templates", args.workspaceId),
});

export const deleteMedia = internalMutation({
  args: { workspaceId: v.id("workspaces"), keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const key of args.keys) if (ownKey(args.workspaceId, key)) await deleteFile(ctx, key);
    return null;
  },
});

export const storeMedia = internalAction({
  args: { workspaceId: v.id("workspaces"), type: v.union(v.literal("image"), v.literal("video")), url: v.string() },
  handler: async (ctx, args): Promise<HeaderMedia | null> => {
    try {
      const response = await fetch(args.url);
      if (!response.ok) return null;
      const mimeType =
        response.headers.get("content-type")?.split(";")[0].trim() || (args.type === "image" ? "image/jpeg" : "video/mp4");
      const allowed = HEADER_MEDIA_TYPES[args.type];
      if (!(allowed.mimeTypes as readonly string[]).includes(mimeType)) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > allowed.maxBytes) return null;
      const key = await r2.store(ctx, bytes, { key: newFileKey("templates", args.workspaceId), type: mimeType });
      return { type: args.type, key, mimeType };
    } catch {
      return null;
    }
  },
});

export const panel = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    const channel = await sendingChannel(ctx, args.workspaceId);
    return {
      business: workspace?.name ?? "",
      filesBaseUrl: process.env.R2_PUBLIC_URL ?? null,
      panel: channel?.whatsapp
        ? {
            apiBaseUrl: channel.whatsapp.apiBaseUrl,
            apiVersion: channel.whatsapp.apiVersion,
            accessToken: channel.whatsapp.accessToken,
            wabaId: channel.whatsapp.wabaId ?? null,
          }
        : null,
    };
  },
});

export const draftContext = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const { agentId } = await ensureMarketingDesk(ctx, args.workspaceId);
    const agent = await ctx.db.get("agents", agentId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!agent || !workspace) throw new ConvexError("Workspace not found");
    return {
      agent: {
        _id: agent._id,
        jobDescription: agent.jobDescription,
        rules: agent.rules,
        guardrails: agent.guardrails,
        tone: agent.tone,
        model: agent.model,
        temperature: agent.temperature,
      },
      workspace: {
        name: workspace.name,
        industry: workspace.industry ?? null,
        description: workspace.description ?? null,
        tagline: workspace.tagline ?? null,
      },
    };
  },
});

export const testTarget = internalQuery({
  args: { workspaceId: v.id("workspaces"), to: v.string(), countryCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("notificationSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const to = normalisePhone(args.to, args.countryCode?.trim() || settings?.defaultCountryCode || "91");
    const contact = to
      ? await ctx.db
          .query("contacts")
          .withIndex("by_workspace_external", (q) => q.eq("workspaceId", args.workspaceId).eq("externalId", to))
          .unique()
      : null;
    const channel = await sendingChannel(ctx, args.workspaceId);
    return {
      to,
      contactId: contact?._id ?? null,
      entryAgentId: channel?.agentId ?? null,
      person: contact
        ? {
            name: contact.name ?? null,
            externalId: contact.externalId,
            phone: contact.phone ?? null,
            email: contact.email ?? null,
            company: contact.company ?? null,
            birthday: contact.birthday ?? null,
            attributes: contact.attributes.slice(0, 40),
          }
        : null,
    };
  },
});

export const recordTest = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    to: v.string(),
    category: v.union(v.literal("marketing"), v.literal("utility"), v.literal("authentication")),
    text: v.string(),
    templateName: v.optional(v.string()),
    wamid: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    agentId: v.optional(v.id("agents")),
    channelId: v.optional(v.id("channels")),
    entryAgentId: v.optional(v.id("agents")),
    shown: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (args.wamid && (await billingEventFor(ctx, args.wamid))) return null;
    const now = Date.now();
    const thread = args.contactId
      ? await marketingThread(ctx, { contactId: args.contactId, entryAgentId: args.entryAgentId })
      : null;
    await charge(ctx, {
      workspaceId: args.workspaceId,
      conversationId: thread?._id,
      to: args.to,
      category: args.category,
      source: "campaign",
      preview: `Test · ${args.text}`,
      templateName: args.templateName,
      wamid: args.wamid,
    });
    if (thread) {
      await writeMarketingMessage(ctx, thread, {
        text: args.text,
        agentId: args.agentId,
        now,
        wamid: args.wamid,
        shown: args.shown ?? null,
      });
    }
    return null;
  },
});
