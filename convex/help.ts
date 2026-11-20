"use node";

import { ConvexError, v } from "convex/values";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { aiGateway, gatewayOptions } from "./lib/gateway";
import { DEFAULT_CHAT_MODEL } from "./lib/shared";
import { HELP_GUIDE } from "./lib/helpGuide";

const MAX_TURNS = 12;
const MAX_CHARS = 2000;

const INSTRUCTIONS = [
  "You are the Magic Agent help desk, answering the owner of a business that uses Magic Agent.",
  "Answer questions about how to use Magic Agent from the USER MANUAL below.",
  "",
  "Rules:",
  "- If the manual does not cover it, say so and suggest raising a support ticket from Support in the profile menu (bottom of the sidebar).",
  "- Never invent menus, buttons, prices or features. Use the exact names the manual uses, and say where to find things, e.g. Build → Record books.",
  "- Call get_workspace_setup only when the answer depends on this user's own workspace: something of theirs not working, what to set up next, or a question naming their agents, channels, record books, templates, plan or balance. Do not call it for general how-to questions.",
  "- With the setup, make the answer specific: name their agents, channels and record books, and point out what explains the problem (an agent still in draft, a specialist with no routing description, a record book not switched on for any agent, a channel in error, a template not approved, a failed knowledge source). Only state facts that are in it.",
  "- You can read the setup but cannot change anything. Explain how they can do it.",
  "- You cannot see customer conversations, contacts or orders. For those, point them to the Inbox, Leads or the agent's chat.",
  "- Be brief: a sentence or two, or a short numbered list of steps.",
  "- Formatting: **bold** for screen, menu and button names, and plain numbered or dashed lists. No headings, tables or links.",
  "- Politely decline anything unrelated to Magic Agent.",
  "",
  "USER MANUAL:",
  HELP_GUIDE,
].join("\n");

export const ask = action({
  args: {
    workspaceId: v.id("workspaces"),
    page: v.optional(v.string()),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        text: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ answer: string }> => {
    await ctx.runQuery(internal.authDb.assertWorkspace, {
      workspaceId: args.workspaceId,
    });

    const messages = args.messages
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: m.text.trim().slice(0, MAX_CHARS) }))
      .filter((m) => m.content);
    if (messages.at(-1)?.role !== "user") throw new ConvexError("Ask a question first.");

    const page = args.page?.slice(0, 200);
    const last = messages[messages.length - 1];
    if (page) last.content = `[On console page ${page}]\n${last.content}`;

    const model = DEFAULT_CHAT_MODEL;
    const result = await generateText({
      model: aiGateway()(model),
      providerOptions: await gatewayOptions(ctx, model),
      instructions: INSTRUCTIONS,
      messages,
      tools: {
        get_workspace_setup: tool({
          description:
            "Read how this user's workspace is set up right now: company profile, agents, channels, knowledge base, catalogue, record books, lead stages, WhatsApp templates, integrations, team and billing. Read-only; no customer data.",
          inputSchema: z.object({}),
          execute: () =>
            ctx.runQuery(internal.helpDb.setup, {
              workspaceId: args.workspaceId,
              now: Date.now(),
            }),
        }),
      },
      stopWhen: isStepCount(3),
      temperature: 0.2,
    });

    return { answer: result.text.trim() };
  },
});
