import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { resolveGreeting } from "./lib/prompt";
import { isVoiceId, voiceIdFor } from "./lib/voices";

const callStatus = v.union(
  v.literal("listening"),
  v.literal("thinking"),
  v.literal("ready"),
  v.literal("silent"),
  v.literal("failed"),
  v.literal("ended")
);

export const lineByKey = internalQuery({
  args: { channelKey: v.string() },
  handler: async (ctx, args) => {
    if (!args.channelKey || args.channelKey.length > 64) return null;
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_channelKey", (q) => q.eq("channelKey", args.channelKey))
      .unique();
    if (!channel || channel.type !== "phone" || channel.status !== "active") return null;
    return { channelId: channel._id, workspaceId: channel.workspaceId };
  },
});

export const voiceFor = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get("channels", args.channelId);
    if (!channel) return null;
    const agent = await ctx.db.get("agents", channel.agentId);
    const workspace = await ctx.db.get("workspaces", channel.workspaceId);
    if (!agent || !workspace || agent.status === "paused") return null;
    const chosen = channel.phoneLine?.voiceId;
    const fixed = chosen && isVoiceId(chosen) ? chosen : undefined;
    return {
      workspaceId: workspace._id,
      channelId: channel._id,
      agentId: agent._id,
      voiceId: fixed ?? voiceIdFor(agent),
      fixedVoice: fixed !== undefined,
      greeting: channel.phoneLine?.greeting?.trim() || resolveGreeting(agent, workspace.name),
    };
  },
});

export const startCall = internalMutation({
  args: {
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
    callUuid: v.string(),
    caller: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("phoneCalls")
      .withIndex("by_callUuid", (q) => q.eq("callUuid", args.callUuid))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("phoneCalls", {
      ...args,
      status: "listening",
      silences: 0,
      turns: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getCall = internalQuery({
  args: { callId: v.id("phoneCalls") },
  handler: async (ctx, args) => await ctx.db.get("phoneCalls", args.callId),
});

export const setStatus = internalMutation({
  args: {
    callId: v.id("phoneCalls"),
    status: callStatus,
    replyUrl: v.optional(v.string()),
    silence: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get("phoneCalls", args.callId);
    if (!call || call.status === "ended") return null;
    const now = Date.now();
    await ctx.db.patch(args.callId, {
      status: args.status,
      updatedAt: now,
      ...(args.replyUrl !== undefined ? { replyUrl: args.replyUrl } : {}),
      ...(args.status === "thinking" ? { thinkingSince: now, turns: call.turns + 1 } : {}),
      ...(args.status === "ready" ? { silences: 0 } : {}),
      ...(args.silence ? { silences: call.silences + 1 } : {}),
    });
    return { silences: call.silences + (args.silence ? 1 : 0) };
  },
});

export const endCall = internalMutation({
  args: { callUuid: v.string() },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("phoneCalls")
      .withIndex("by_callUuid", (q) => q.eq("callUuid", args.callUuid))
      .unique();
    if (call) await ctx.db.patch(call._id, { status: "ended", updatedAt: Date.now() });
  },
});
