/**
 * Payments — Razorpay payment links the agents and the team send.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

const rupees = (paise, currency) =>
  `${currency} ${(paise / 100).toFixed(2)}`;

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "get_payment_settings",
    {
      title: "Razorpay connection",
      description:
        "Whether the workspace has Razorpay connected, in live or test mode, its webhook URL and when Razorpay last reported a payment. Keys are connected from the Integrations page, never here.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.query(api.payments.connection, {
        workspaceId: found._id,
      });
      const connection = result.connection;
      return ok(
        connection
          ? {
              connected: true,
              mode: connection.mode,
              keyId: connection.keyId,
              status: connection.status,
              lastError: connection.lastError ?? null,
              webhookUrl: connection.webhookUrl,
              lastWebhookAt: iso(connection.lastWebhookAt),
              notifySms: connection.notifySms,
              notifyEmail: connection.notifyEmail,
              expiryHours: connection.expiryHours,
              paidStage: connection.paidStage,
            }
          : { connected: false }
      );
    })
  );

  server.registerTool(
    "list_payment_links",
    {
      title: "List payment links",
      description:
        "Razorpay payment links sent from the workspace, newest first, with amount, status (created = open, paid, partially_paid, expired, cancelled), the customer and the order reference they pay for.",
      inputSchema: {
        ...workspaceArg,
        status: z
          .enum(["created", "partially_paid", "paid", "expired", "cancelled"])
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, status, limit }) => {
      const found = await resolveWorkspace(workspace);
      const links = await call.query(api.payments.listLinks, {
        workspaceId: found._id,
        status,
        limit: limit ?? 40,
      });
      return ok(
        links.map((link) => ({
          linkId: link.razorpayLinkId,
          url: link.url,
          amount: rupees(link.amountPaise, link.currency),
          paid: rupees(link.amountPaidPaise, link.currency),
          status: link.status,
          description: link.description,
          reference: link.recordReference ?? null,
          customer: link.customer,
          createdBy: link.source === "agent" ? (link.agentName ?? "agent") : "team",
          method: link.method ?? null,
          paidAt: iso(link.paidAt),
          expiresAt: iso(link.expiresAt),
          createdAt: iso(link.createdAt),
        }))
      );
    })
  );

  server.registerTool(
    "create_payment_link",
    {
      title: "Create a payment link",
      description:
        "Create a Razorpay payment link in the workspace's own account. Pass an order reference (e.g. ORD-0012) to match the payment to that record — the amount can then be left out to charge its total, and the record moves to the paid stage once it is paid. Razorpay also texts and emails the link to the customer when the workspace has that switched on.",
      inputSchema: {
        ...workspaceArg,
        description: z.string().describe("What it pays for, as the customer will see it"),
        amount: z
          .number()
          .positive()
          .optional()
          .describe("In rupees, e.g. 1499.5. Optional with an order reference that has a total."),
        reference: z.string().optional().describe("Order or record reference"),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        customerEmail: z.string().optional(),
        expiresInHours: z.number().int().min(1).max(720).optional(),
      },
    },
    handler(async ({ workspace, description, amount, reference, customerName, customerPhone, customerEmail, expiresInHours }) => {
      const found = await resolveWorkspace(workspace);
      const created = await call.action(api.payments.createLink, {
        workspaceId: found._id,
        description,
        amount,
        recordReference: reference,
        customerName,
        customerPhone,
        customerEmail,
        expiresInHours,
      });
      return ok({
        url: created.url,
        linkId: created.razorpayLinkId,
        amount: created.amount,
        reference: created.reference ?? null,
        expiresAt: iso(created.expiresAt),
      });
    })
  );
}
