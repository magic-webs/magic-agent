import { v } from "convex/values";
import { query, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { resolveGreeting } from "./lib/prompt";
import { logoSrcFor } from "./lib/branding";
import { isVoiceId, voiceIdFor } from "./lib/voices";

export const DEFAULT_VOICE_WIDGET: NonNullable<Doc<"channels">["voiceWidget"]> = {
  style: "orb",
  position: "bottom-right",
  size: "medium",
  colors: ["#7c3aed", "#06b6d4"],
  captions: true,
};

export function normalizeVoiceSession(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 12 || trimmed.length > 64) return null;
  return /^voice-[a-z0-9]+$/i.test(trimmed) ? trimmed : null;
}

async function voiceChannel(
  ctx: QueryCtx,
  channelKey: string
): Promise<Doc<"channels"> | null> {
  if (!channelKey || channelKey.length > 64) return null;
  const channel = await ctx.db
    .query("channels")
    .withIndex("by_channelKey", (q) => q.eq("channelKey", channelKey))
    .unique();
  if (!channel || channel.type !== "voice" || channel.status !== "active") return null;
  return channel;
}

export const embedConfig = query({
  args: { channelKey: v.string() },
  handler: async (ctx, args) => {
    const channel = await voiceChannel(ctx, args.channelKey);
    if (!channel) return null;
    const { position, size, colors } = channel.voiceWidget ?? DEFAULT_VOICE_WIDGET;
    return { position, size, colors };
  },
});

export const bootstrap = query({
  args: { channelKey: v.string() },
  handler: async (ctx, args) => {
    const channel = await voiceChannel(ctx, args.channelKey);
    if (!channel) return null;
    const agent = await ctx.db.get("agents", channel.agentId);
    const workspace = await ctx.db.get("workspaces", channel.workspaceId);
    if (!agent || !workspace) return null;
    const settings = channel.voiceWidget ?? DEFAULT_VOICE_WIDGET;
    return {
      workspaceName: workspace.name,
      botName: agent.botName,
      logoSrc: await logoSrcFor(ctx, workspace),
      style: settings.style ?? "orb",
      position: settings.position,
      size: settings.size,
      colors: settings.colors,
      captions: settings.captions,
    };
  },
});

export const resolve = internalQuery({
  args: { channelKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const channel = await voiceChannel(ctx, args.channelKey);
    const sessionId = normalizeVoiceSession(args.sessionId);
    if (!channel || !sessionId) return null;
    const agent = await ctx.db.get("agents", channel.agentId);
    const workspace = await ctx.db.get("workspaces", channel.workspaceId);
    if (!agent || !workspace || agent.status === "paused") return null;
    const chosen = channel.voiceWidget?.voiceId;
    const channelVoice = chosen && isVoiceId(chosen) ? chosen : undefined;
    return {
      sessionId,
      channelId: channel._id,
      agentId: agent._id,
      workspaceId: workspace._id,
      voiceId: channelVoice ?? voiceIdFor(agent),
      fixedVoice: channelVoice !== undefined,
      greeting: channel.voiceWidget?.greeting?.trim() || resolveGreeting(agent, workspace.name),
    };
  },
});
