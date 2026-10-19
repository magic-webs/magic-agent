/**
 * Operations — reading what the agents actually did.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findAgent } from "../lookup.mjs";
import { handler, money, ok, statusName } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_conversations",
    {
      title: "List conversations",
      description:
        "Recent threads. 'handedOff' means the front desk routed it on, and activeAgentName is whoever holds it now — the fastest way to see whether routing is working in the real world.",
      inputSchema: {
        ...workspaceArg,
        agent: z.string().optional().describe("Only threads that arrived at this agent"),
        status: z.enum(["open", "escalated", "resolved"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, agent, status, limit }) => {
      const found = await resolveWorkspace(workspace);
      const agentId = agent ? (await findAgent(found._id, agent))._id : undefined;

      const rows = await call.query(api.conversations.listByWorkspace, {
        workspaceId: found._id,
        agentId,
        limit: limit ?? 40,
      });

      return ok(
        rows
          .filter((row) => !status || statusName(row.status) === status)
          .map((row) => ({
            id: row._id,
            contact: row.contactLabel,
            channel: row.channelType,
            arrivedAt: row.agentName,
            heldBy: row.activeAgentName,
            handedOff: row.handedOff,
            assignedTo: row.assigneeName ?? null,
            status: statusName(row.status),
            messages: row.messageCount,
            lastMessageAt: new Date(row.lastMessageAt).toISOString(),
            preview: row.lastMessagePreview ?? null,
          }))
      );
    })
  );

  server.registerTool(
    "read_conversation",
    {
      title: "Read a conversation",
      description:
        "The full transcript of one thread, including the tool calls the agent made and the internal handoffs between agents. Use it to work out why an agent answered the way it did.",
      inputSchema: {
        ...workspaceArg,
        conversationId: z.string().describe("From list_conversations"),
        includeToolCalls: z.boolean().optional().describe("Default true"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ conversationId, includeToolCalls }) => {
      const detail = await call.query(api.conversations.getWithContact, {
        conversationId,
      });
      if (!detail) throw new Error("No such conversation.");

      const messages = await call.query(api.conversations.listMessages, {
        conversationId,
      });
      const withTools = includeToolCalls !== false;

      return ok({
        contact: {
          name: detail.contact?.name ?? null,
          phone: detail.contact?.phone ?? null,
          email: detail.contact?.email ?? null,
          company: detail.contact?.company ?? null,
          remark: detail.contact?.remark ?? null,
        },
        arrivedAt: detail.agent?.botName ?? null,
        assignedTo: detail.assignee?.name ?? null,
        status: statusName(detail.conversation.status),
        transcript: messages
          .filter((message) => withTools || message.kind === "text")
          .map((message) => {
            if (message.kind === "tool") {
              return {
                tool: message.toolName,
                ok: message.toolOk,
                input: message.toolInput,
                output: message.toolOutput,
              };
            }
            if (message.kind === "handoff") {
              return { handoff: message.text };
            }
            if (message.kind === "error") {
              return { error: message.text };
            }
            return {
              id: message._id,
              role: message.role,
              text: message.text,
              at: new Date(message.createdAt).toISOString(),
            };
          }),
      });
    })
  );

  server.registerTool(
    "send_message",
    {
      title: "Send a message in a conversation",
      description:
        "Replies to the customer in an existing thread, exactly as a reply typed in the inbox: it goes out on the thread's own channel (WhatsApp, Instagram, or the web chat) and keeps the agent quiet for a while so it does not talk over you. WhatsApp only delivers a free-text message within 24 hours of the customer's last message — outside it the send is refused. Read the thread with read_conversation first.",
      inputSchema: {
        conversationId: z.string().describe("From list_conversations"),
        text: z.string().min(1).describe("What the customer receives"),
        replyToMessageId: z
          .string()
          .optional()
          .describe("A message id from read_conversation, to quote it"),
        pauseMinutes: z
          .number()
          .int()
          .min(0)
          .max(1440)
          .optional()
          .describe("How long the agent stays quiet afterwards. Default 60"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    handler(async ({ conversationId, text, replyToMessageId, pauseMinutes }) => {
      const result = await call.action(api.conversations.sendManualReply, {
        conversationId,
        text,
        replyToMessageId,
        pauseMinutes,
      });
      if (!result.ok) throw new Error(result.error ?? "The message was not sent.");
      return ok({ sent: true, conversationId });
    })
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description:
        "Everyone who has talked to the agents, with who owns them and who is handling them.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const contacts = await call.query(api.contacts.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        contacts.map((contact) => ({
          id: contact._id,
          name: contact.name ?? null,
          phone: contact.phone ?? null,
          email: contact.email ?? null,
          company: contact.company ?? null,
          channel: contact.channelType,
          handledBy: contact.handledBy,
          remark: contact.remark ?? null,
          conversationId: contact.conversationId,
          lastSeenAt: new Date(contact.lastSeenAt).toISOString(),
        }))
      );
    })
  );

  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description:
        "Orders in the workspace's Orders record book, in the old order shape: the reference as orderNumber, the stage as status. list_records on the Orders book shows the same rows with every field.",
      inputSchema: {
        ...workspaceArg,
        status: z
          .enum([
            "new",
            "quoted",
            "confirmed",
            "in_progress",
            "completed",
            "cancelled",
          ])
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, status, limit }) => {
      const found = await resolveWorkspace(workspace);
      const orders = await call.query(api.orders.listByWorkspace, {
        workspaceId: found._id,
        status,
        limit: limit ?? 40,
      });
      return ok(
        orders.map((order) => ({
          orderNumber: order.orderNumber,
          status: order.status,
          customer: order.customer,
          items: order.items,
          delivery: order.delivery ?? null,
          notes: order.notes ?? null,
          source: order.source,
          createdAt: new Date(order.createdAt).toISOString(),
        }))
      );
    })
  );

  server.registerTool(
    "usage_summary",
    {
      title: "Token usage and cost",
      description:
        "What the workspace has spent on model calls, by day, agent and channel. Costs are exact where the model is in the price table and flagged when it is not.",
      inputSchema: {
        ...workspaceArg,
        days: z.number().int().min(1).max(90).optional().describe("Default 30"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, days }) => {
      const found = await resolveWorkspace(workspace);
      const summary = await call.query(api.usage.workspaceSummary, {
        workspaceId: found._id,
        days: days ?? 30,
        now: Date.now(),
      });
      return ok({ ...summary, totalCost: money(summary?.totalCostNanoUsd) });
    })
  );
}
