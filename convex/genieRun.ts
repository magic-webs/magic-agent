"use node";

import { v } from "convex/values";
import { generateText, isStepCount, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { aiGateway, gatewayOptions } from "./lib/gateway";
import { DEFAULT_CHAT_MODEL } from "./lib/shared";
import { parseSubject } from "./lib/auth";
import { signAccessToken } from "./auth";
import { toolDefinitions } from "../mcp/src/tools/index.mjs";
import { runWithIdentity } from "../mcp/src/convex.mjs";
import { FULL_INSTRUCTIONS } from "../mcp/src/instructions.mjs";

const MODEL = DEFAULT_CHAT_MODEL;
const MAX_STEPS = 16;
const TOKEN_TTL_S = 15 * 60;
const KEEP_MESSAGES = 60;
const MEMORY_RESULT_CHARS = 6_000;
const SHOWN_CHARS = 1_500;

/** Upload addresses are useless to a model that cannot PUT; files arrive already uploaded. */
const HIDDEN_TOOLS = new Set(["create_upload_url", "list_workspaces"]);

type Definition = {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, z.ZodType>;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  };
  run: (args: Record<string, unknown>) => Promise<{
    isError?: boolean;
    content?: { type: string; text?: string }[];
  }>;
};

type ActionRow = {
  toolCallId: string;
  tool: string;
  title?: string;
  input?: string;
  output?: string;
  readOnly?: boolean;
  state?: "pending" | "approved" | "declined" | "done" | "failed";
  approvalId?: string;
};

const DEFINITIONS = (toolDefinitions("workspace") as Definition[]).filter(
  (definition) => !HIDDEN_TOOLS.has(definition.name)
);
const BY_NAME = new Map(DEFINITIONS.map((definition) => [definition.name, definition]));

const isReadOnly = (name: string) =>
  BY_NAME.get(name)?.config.annotations?.readOnlyHint === true;
const isDestructive = (name: string) =>
  BY_NAME.get(name)?.config.annotations?.destructiveHint === true;
const titleOf = (name: string) => BY_NAME.get(name)?.config.title ?? name;

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildTools(slug: string): ToolSet {
  const tools: ToolSet = {};
  for (const definition of DEFINITIONS) {
    const shape = { ...definition.config.inputSchema };
    delete shape.workspace;
    tools[definition.name] = tool({
      description: definition.config.description ?? definition.config.title ?? definition.name,
      inputSchema: z.object(shape),
      execute: async (input: Record<string, unknown>) => {
        const result = await definition.run({ ...input, workspace: slug });
        const text = (result.content ?? [])
          .map((part) => part.text ?? "")
          .join("\n")
          .trim();
        if (result.isError) throw new Error(text || "That did not work.");
        return text || "Done.";
      },
    });
  }
  return tools;
}

function instructionsFor(
  workspace: { slug: string; name: string; ownerName: string | null; timezone: string; currency: string },
  autoApprove: boolean
) {
  const who = workspace.ownerName ?? workspace.name;
  return [
    `You are Genie, the assistant built into Magic Agent. You work inside the workspace "${workspace.name}" for ${who}, who runs it.`,
    "You set up and run the workspace by calling tools: agents, knowledge, catalogue, record books, leads, inbox, alerts, marketing, Instagram, payments.",
    "",
    "How to work:",
    "- You are already in this workspace. Never ask which workspace, and never pass one.",
    "- Look things up before changing them. Use the list and get tools rather than guessing names or ids.",
    autoApprove
      ? "- Changes run straight away, except deletions, which the user confirms on a card."
      : "- Every change is shown to the user as a card to approve before it runs. Call the tool directly to propose a change; do not ask 'shall I?' in text first.",
    "- When a change is declined, do not try it again. Say what you would do instead, or ask what they want.",
    "- Several small changes that belong together can be proposed at once.",
    "- Never invent a figure, price, id or result. If a tool did not return it, say you do not know.",
    "- Attached files are already uploaded. Pass a document's fileKey to upload_knowledge_file. Images are shown to you: read them yourself — a price list becomes import_products.",
    `- Money is in ${workspace.currency}; the workspace's timezone is ${workspace.timezone}.`,
    "",
    "How to reply:",
    "- Short. It is often read on a phone. Lead with the outcome, then the detail.",
    "- Plain Markdown: short lists and bold, no headings, no tables.",
    "- No preamble and no sign-off. Do not repeat what the approval cards already say.",
    "",
    "Platform notes:",
    FULL_INSTRUCTIONS,
  ].join("\n");
}

/** Image parts are stored as URL strings; the SDK reads a bare string as base64. */
function hydrate(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || typeof message.content === "string") return message;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image" && typeof part.image === "string" && /^https?:/.test(part.image)
          ? { ...part, image: new URL(part.image) }
          : part
      ),
    } as ModelMessage;
  });
}

/** Big tool results are worth reading once, not carrying in every later turn. */
function compact(messages: ModelMessage[]): ModelMessage[] {
  const shortened = messages.map((message) => {
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const output = part.output;
        if ((output.type === "text" || output.type === "error-text") && output.value.length > MEMORY_RESULT_CHARS) {
          return { ...part, output: { ...output, value: clip(output.value, MEMORY_RESULT_CHARS) } };
        }
        if (output.type === "json") {
          const text = asText(output.value);
          if (text.length > MEMORY_RESULT_CHARS) {
            return { ...part, output: { type: "text" as const, value: clip(text, MEMORY_RESULT_CHARS) } };
          }
        }
        return part;
      }),
    } as ModelMessage;
  });

  if (shortened.length <= KEEP_MESSAGES) return shortened;
  let start = shortened.length - KEEP_MESSAGES;
  while (start < shortened.length && shortened[start].role !== "user") start++;
  return start < shortened.length ? shortened.slice(start) : shortened.slice(-1);
}

function rowsFrom(content: ReadonlyArray<{ type: string } & Record<string, unknown>>): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const part of content) {
    if (part.type === "tool-call") {
      const name = String(part.toolName);
      rows.push({
        toolCallId: String(part.toolCallId),
        tool: name,
        title: titleOf(name),
        input: clip(asText(part.input), SHOWN_CHARS),
        readOnly: isReadOnly(name),
      });
    } else if (part.type === "tool-result") {
      rows.push({
        toolCallId: String(part.toolCallId),
        tool: String(part.toolName),
        output: clip(asText(part.output), SHOWN_CHARS),
        state: "done",
      });
    } else if (part.type === "tool-error") {
      const error = part.error instanceof Error ? part.error.message : asText(part.error);
      rows.push({
        toolCallId: String(part.toolCallId),
        tool: String(part.toolName),
        output: clip(error, SHOWN_CHARS),
        state: "failed",
      });
    } else if (part.type === "tool-approval-request" && !part.isAutomatic) {
      const call = part.toolCall as { toolCallId: string; toolName: string; input: unknown };
      rows.push({
        toolCallId: call.toolCallId,
        tool: call.toolName,
        title: titleOf(call.toolName),
        input: clip(asText(call.input), SHOWN_CHARS),
        readOnly: false,
        approvalId: String(part.approvalId),
        state: "pending",
      });
    }
  }
  return rows;
}

/** Results of calls approved last turn, which the SDK runs before the first step. */
function resultRows(messages: ModelMessage[]): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const output = part.output;
      if (output.type === "execution-denied") continue;
      const failed = output.type === "error-text" || output.type === "error-json";
      rows.push({
        toolCallId: part.toolCallId,
        tool: part.toolName,
        output: clip(asText("value" in output ? output.value : ""), SHOWN_CHARS),
        state: failed ? "failed" : "done",
      });
    }
  }
  return rows;
}

export const run = internalAction({
  args: { threadId: v.id("genieThreads"), run: v.number() },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.genie.context, { threadId: args.threadId });
    if (!context || context.run !== args.run) return null;

    const finish = (fields: { messages?: string; reply?: string; status: "idle" | "waiting" | "failed"; error?: string }) =>
      ctx.runMutation(internal.genie.finish, { threadId: args.threadId, run: args.run, ...fields });

    const parsed = parseSubject(context.subject);
    if (!parsed) {
      await finish({ status: "failed", error: "Sign in again to use Genie." });
      return null;
    }

    const record = async (rows: ActionRow[]) => {
      if (rows.length === 0) return;
      await ctx.runMutation(internal.genie.recordActions, {
        threadId: args.threadId,
        run: args.run,
        actions: rows,
      });
    };

    const history = JSON.parse(context.messages) as ModelMessage[];
    const identity = {
      kind: "minted",
      convexUrl: process.env.CONVEX_CLOUD_URL,
      session: {
        sessionToken: "",
        role: parsed.role,
        label: context.workspace.name,
        workspaceSlug: context.workspace.slug,
      },
      mint: () => signAccessToken(context.subject, TOKEN_TTL_S),
    };

    try {
      const autoApprove = context.autoApprove;
      const ask = async () =>
        generateText({
          model: aiGateway()(MODEL),
          providerOptions: await gatewayOptions(ctx, MODEL),
          instructions: instructionsFor(context.workspace, autoApprove),
          messages: hydrate(history),
          tools: buildTools(context.workspace.slug),
          toolApproval: ({ toolCall }) => {
            if (isReadOnly(toolCall.toolName)) return undefined;
            if (isDestructive(toolCall.toolName) || !autoApprove) return "user-approval";
            return undefined;
          },
          stopWhen: isStepCount(MAX_STEPS),
          timeout: { totalMs: 8 * 60_000 },
          temperature: 0.3,
          onStepEnd: async (step) => {
            await record(rowsFrom(step.content as never));
          },
        });
      const result = (await runWithIdentity(identity, ask)) as Awaited<ReturnType<typeof ask>>;

      await ctx.runMutation(internal.usage.record, {
        workspaceId: context.workspace._id,
        source: "genie",
        model: MODEL,
        kind: "chat",
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      });

      await record(resultRows(result.responseMessages as ModelMessage[]));
      const waiting = result.content.some(
        (part) => part.type === "tool-approval-request" && !part.isAutomatic
      );
      await record(rowsFrom(result.content as never));

      const messages = compact([...history, ...(result.responseMessages as ModelMessage[])]);
      await finish({
        messages: JSON.stringify(messages),
        reply: result.text.trim() || undefined,
        status: waiting ? "waiting" : "idle",
      });
    } catch (error) {
      console.error("genie: run failed", error);
      await finish({
        status: "failed",
        error: "Genie could not finish that. Try again in a moment.",
      });
    }
    return null;
  },
});
