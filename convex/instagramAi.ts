"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { z } from "zod";
import { aiGateway, gatewayModelId, gatewayOptions } from "./lib/gateway";
import { DEFAULT_CHAT_MODEL } from "./lib/shared";
import { PUBLIC_REPLY_LIMIT } from "./lib/instagram";

const screenSchema = z.object({
  block: z.boolean().describe("True only when the comment should be hidden."),
  reason: z
    .string()
    .describe("Three to six words on why, e.g. 'Insults another user'. Empty when not blocked."),
});

async function recordUsage(
  ctx: ActionCtx,
  args: { workspaceId: Id<"workspaces">; agentId: Id<"agents"> },
  model: string,
  usage: { inputTokens?: number; outputTokens?: number }
) {
  await ctx.runMutation(internal.usage.record, {
    workspaceId: args.workspaceId,
    agentId: args.agentId,
    source: "instagram",
    channelType: "instagram",
    model,
    kind: "chat",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  });
}

/** A reason to hide the comment, or null to leave it up. */
export const screenComment = internalAction({
  args: { workspaceId: v.id("workspaces"), agentId: v.id("agents"), text: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const model = DEFAULT_CHAT_MODEL;
    try {
      const result = await generateText({
        model: aiGateway()(model),
        providerOptions: await gatewayOptions(ctx, model),
        output: Output.object({ schema: screenSchema }),
        instructions: [
          "You moderate comments on a business's Instagram posts.",
          "Block a comment only when it is abusive, hateful, sexually explicit, a threat, a scam, or spam promoting something else.",
          "Never block a complaint, a question, criticism of the business, or a comment in another language just for being negative or unfamiliar.",
        ].join("\n"),
        prompt: `Comment: ${args.text.slice(0, 1500)}`,
        temperature: 0,
      });
      await recordUsage(ctx, args, model, result.usage);
      return result.output.block ? result.output.reason.trim() || "Flagged by AI" : null;
    } catch (error) {
      console.error("[instagram] comment screen failed", error);
      return null;
    }
  },
});

export const writeReply = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    comment: v.string(),
    username: v.optional(v.string()),
    caption: v.optional(v.string()),
    sendsDm: v.boolean(),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const context = await ctx.runQuery(internal.instagramAutomation.aiContext, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
    });
    if (!context) return null;
    const { agent, workspace } = context;
    const tone = agent.tone;
    const model = gatewayModelId(agent.model || DEFAULT_CHAT_MODEL);

    const instructions = [
      `You reply to comments on ${workspace.name}'s Instagram posts${
        workspace.industry ? ` (${workspace.industry})` : ""
      }.`,
      workspace.description ? `About the business: ${workspace.description}` : "",
      `Tone: ${tone.traits.join(", ") || "warm"}; ${tone.formality}; emoji ${tone.emoji}.`,
      tone.mirrorUserLanguage
        ? "Reply in the language the comment is written in."
        : tone.languages.length
          ? `Write in ${tone.languages[0]}.`
          : "",
      agent.guardrails.length
        ? `Never:\n${agent.guardrails.map((rule) => `- ${rule}`).join("\n")}`
        : "",
      "",
      "The reply is public, under the comment. One or two short sentences, no hashtags, no links.",
      "Never state a price, a discount, stock or a date — nothing you were not told.",
      args.sendsDm
        ? "The person is also being sent a DM right now, so tell them to check their DMs."
        : "If they ask for details, invite them to send a DM.",
      "Return only the reply text.",
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = [
      args.caption ? `The post's caption: ${args.caption}` : "",
      `${args.username ? `@${args.username}` : "Someone"} commented: ${args.comment.slice(0, 1500)}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const result = await generateText({
        model: aiGateway()(model),
        providerOptions: await gatewayOptions(ctx, model),
        instructions,
        prompt,
        temperature: agent.temperature,
      });
      await recordUsage(ctx, args, model, result.usage);
      const text = result.text.trim().replace(/^["']|["']$/g, "");
      return text ? text.slice(0, PUBLIC_REPLY_LIMIT) : null;
    } catch (error) {
      console.error("[instagram] reply draft failed", error);
      return null;
    }
  },
});
