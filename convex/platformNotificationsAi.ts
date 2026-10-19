"use node";

import { ConvexError, v } from "convex/values";
import { generateText, Output } from "ai";
import { z } from "zod";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { aiGateway, gatewayModelId, gatewayOptions } from "./lib/gateway";
import { platformFrom } from "./lib/notifications";
import { broadcastCategory, broadcastChannels, emailFormat } from "./schema/validators";

const draftSchema = z.object({
  category: z.enum(["update", "feature", "offer", "notice"]),
  title: z.string().describe("Push title and email heading, at most 65 characters"),
  body: z.string().describe("The lock-screen message, at most 178 characters"),
  emailSubject: z.string().describe("Email subject, at most 70 characters"),
  emailBody: z.string().describe("The email body in the requested format"),
  smsText: z.string().describe("The SMS"),
  linkLabel: z.string().describe("Button text, two to four words"),
});

export type NotificationDraft = z.infer<typeof draftSchema>;

const LANGUAGE = {
  english: "Write in clear, simple Indian English.",
  hindi: "Write in Hindi, in Devanagari script.",
  hinglish: "Write in Hinglish: conversational Hindi mixed with English, in Latin script.",
} as const;

export const draft = action({
  args: {
    brief: v.string(),
    category: v.optional(broadcastCategory),
    channels: broadcastChannels,
    emailFormat,
    language: v.union(v.literal("english"), v.literal("hindi"), v.literal("hinglish")),
  },
  handler: async (ctx, args): Promise<NotificationDraft> => {
    await ctx.runQuery(internal.platformNotifications.requireAuthor, {});
    const brief = args.brief.trim();
    if (brief.length < 5) throw new ConvexError("Describe what the notification is about.");
    if (brief.length > 4000) throw new ConvexError("Keep the brief under 4,000 characters.");

    const brand = platformFrom().fromName;
    const latin = args.language !== "hindi";
    const instructions = [
      `You write platform announcements for ${brand}, a platform where businesses run AI agents that answer their customers on WhatsApp, Instagram, web chat, RCS and Telegram, take orders, capture leads and send marketing.`,
      `The readers are the owners of those businesses — ${brand}'s customers, mostly small and mid-sized Indian businesses. Write to them as a helpful product team: warm, direct, specific about what changes for them, no hype and no exclamation marks in every line.`,
      LANGUAGE[args.language],
      "",
      "Never invent facts. Prices, discount percentages, dates, times, coupon codes, plan names, numbers and links that the brief does not give must be written as a short placeholder in square brackets, like [date] or [CODE], for the admin to fill in.",
      "",
      "Fields:",
      "- category: update (improvement to something existing), feature (something new), offer (a promotion), notice (maintenance, incidents, policy or account matters).",
      "- title: at most 65 characters, no trailing full stop.",
      "- body: at most 178 characters; must make sense alone on a lock screen.",
      "- emailSubject: at most 70 characters.",
      args.emailFormat === "html"
        ? "- emailBody: HTML only, using <p>, <h2>, <h3>, <ul>, <ol>, <li>, <strong>, <em>, <a href> and <br>. No <html>, <head>, <body>, <style>, scripts, images or inline colours. Do not repeat the title as a heading — the layout already shows it — and do not add a sign-off button; the layout adds one. 80 to 200 words."
        : "- emailBody: plain text, no markdown. Paragraphs separated by a blank line; list items start with '• '. Do not repeat the title on the first line. 80 to 200 words.",
      latin
        ? "- smsText: at most 160 characters, plain characters only and no emoji, starting with the brand name and a colon."
        : "- smsText: at most 70 characters, starting with the brand name and a colon.",
      "- linkLabel: two to four words for the button.",
      `Channels the admin will send on: ${
        Object.entries(args.channels)
          .filter(([, on]) => on)
          .map(([name]) => name)
          .join(", ") || "none chosen yet"
      }. Fill every field anyway.`,
    ].join("\n");

    const prompt = [
      args.category ? `This is a ${args.category} notification.` : "",
      `The brief:\n${brief}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const model = gatewayModelId(undefined);
    let object: NotificationDraft | null = null;
    let lastError: unknown = null;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const attempt of [0, 1]) {
      try {
        const result = await generateText({
          model: aiGateway()(model),
          providerOptions: await gatewayOptions(ctx, model),
          output: Output.object({ schema: draftSchema }),
          instructions:
            attempt === 0
              ? instructions
              : `${instructions}\n\nReturn only the object. No preamble and no markdown fence.`,
          prompt,
          temperature: attempt === 0 ? 0.7 : 0.4,
        });
        inputTokens += result.usage.inputTokens ?? 0;
        outputTokens += result.usage.outputTokens ?? 0;
        object = result.output;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    console.info("[platform-notifications] draft", { model, inputTokens, outputTokens });
    if (!object) {
      console.error("[platform-notifications] draft failed", lastError);
      throw new ConvexError("Could not write a draft just now. Try again.");
    }

    return {
      category: args.category ?? object.category,
      title: object.title.trim().slice(0, 120),
      body: object.body.trim(),
      emailSubject: object.emailSubject.trim(),
      emailBody: object.emailBody.trim(),
      smsText: object.smsText.trim(),
      linkLabel: object.linkLabel.trim(),
    };
  },
});
