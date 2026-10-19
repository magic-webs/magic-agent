/**
 * Channels — the surfaces a customer reaches an agent through.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { APP_URL, SITE_URL } from "../config.mjs";
import { api, call } from "../convex.mjs";
import { findAgent, findChannel } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_channels",
    {
      title: "List channels",
      description:
        "Where the workspace is reachable. Web channels come with the embed snippet to paste into a site; WhatsApp channels come with the callback URL to configure in Meta; RCS channels with the callback URL to give the RCS provider; Telegram channels with the bot's t.me link (its webhook is set automatically); Instagram channels are connected from the Channels page. Access tokens are never returned.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const channels = await call.query(api.channels.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        channels.map((channel) => ({
          id: channel._id,
          name: channel.name,
          type: channel.type,
          status: channel.status,
          answeredBy: channel.agentName,
          lastInboundAt: channel.lastInboundAt
            ? new Date(channel.lastInboundAt).toISOString()
            : null,
          lastError: channel.lastError ?? null,
          ...(channel.type === "web"
            ? {
                intake: channel.intake ?? "form",
                embedSnippet: `<script src="${APP_URL}/widget/${channel.channelKey}/embed.js" async></script>`,
                directLink: `${APP_URL}/widget/${channel.channelKey}`,
              }
            : channel.type === "instagram"
              ? {
                  username: channel.instagram?.username ?? null,
                  tokenExpiresAt: channel.instagram?.tokenExpiresAt
                    ? new Date(channel.instagram.tokenExpiresAt).toISOString()
                    : null,
                }
              : channel.type === "rcs"
                ? {
                    callbackUrl: `${SITE_URL}/rcs/${channel.channelKey}`,
                    displayPhoneNumber: channel.rcs?.displayPhoneNumber ?? null,
                    apiBaseUrl: channel.rcs?.apiBaseUrl ?? null,
                    hasAccessToken: channel.hasAccessToken,
                  }
              : channel.type === "telegram"
                ? {
                    botUsername: channel.telegram?.botUsername ?? null,
                    botLink: channel.telegram?.botUsername
                      ? `https://t.me/${channel.telegram.botUsername}`
                      : null,
                    hasAccessToken: channel.hasAccessToken,
                  }
              : {
                  callbackUrl: `${SITE_URL}/whatsapp/${channel.channelKey}`,
                  displayPhoneNumber: channel.whatsapp?.displayPhoneNumber ?? null,
                  phoneNumberId: channel.whatsapp?.phoneNumberId ?? null,
                  // What notification templates sync from.
                  wabaId: channel.whatsapp?.wabaId ?? null,
                  hasAccessToken: channel.hasAccessToken,
                }),
        }))
      );
    })
  );

  server.registerTool(
    "create_channel",
    {
      title: "Create channel",
      description:
        "Add a website widget, or connect a WhatsApp number, an RCS sender or a Telegram bot. Point it at the front desk unless you specifically want one agent to answer everything on it without routing. A web channel needs intake — ask the user which they want — and is live immediately; a WhatsApp one starts paused until its callback URL is configured in Meta; an RCS one is live once its callback URL is set with the provider; a Telegram one goes live by itself once Telegram accepts the bot token (check list_channels for lastError).",
      inputSchema: {
        ...workspaceArg,
        type: z.enum(["web", "whatsapp", "rcs", "telegram"]),
        name: z.string().describe("e.g. 'Homepage chat' or 'Sales line'"),
        agent: z
          .string()
          .optional()
          .describe("Who answers here. Defaults to the front desk."),
        intake: z
          .enum(["chat", "form"])
          .optional()
          .describe(
            "Web only, required: how the widget gets the visitor's name and number. chat asks for them inside the conversation; form shows a sign-in page before the chat opens."
          ),
        phoneNumberId: z.string().optional().describe("WhatsApp only, required"),
        accessToken: z.string().optional().describe("WhatsApp and RCS, required"),
        botToken: z.string().optional().describe("Telegram only, required: the token from @BotFather"),
        wabaId: z.string().optional(),
        businessId: z.string().optional(),
        displayPhoneNumber: z
          .string()
          .optional()
          .describe("WhatsApp or RCS: the number customers see"),
        apiBaseUrl: z
          .string()
          .optional()
          .describe("WhatsApp: change only when sending through a BSP proxy. RCS: defaults to https://crmapi.com.bot/api/v1"),
        apiVersion: z.string().optional(),
      },
    },
    handler(async ({ workspace, type, name, agent, intake, ...wa }) => {
      const found = await resolveWorkspace(workspace);

      let agentId;
      if (agent) {
        agentId = (await findAgent(found._id, agent))._id;
      } else {
        const router = await call.query(api.agents.findRouter, {
          workspaceId: found._id,
        });
        if (!router) {
          throw new Error(
            "This workspace has no front desk yet, and no agent was named. Call ensure_front_desk, or pass `agent`."
          );
        }
        agentId = router._id;
      }

      const channelId = await call.mutation(api.channels.create, {
        workspaceId: found._id,
        agentId,
        type,
        name,
        intake: type === "web" ? intake : undefined,
        whatsapp:
          type === "whatsapp"
            ? {
                phoneNumberId: wa.phoneNumberId ?? "",
                accessToken: wa.accessToken,
                wabaId: wa.wabaId,
                businessId: wa.businessId,
                displayPhoneNumber: wa.displayPhoneNumber,
                apiBaseUrl: wa.apiBaseUrl,
                apiVersion: wa.apiVersion,
              }
            : undefined,
        rcs:
          type === "rcs"
            ? {
                accessToken: wa.accessToken,
                apiBaseUrl: wa.apiBaseUrl,
                displayPhoneNumber: wa.displayPhoneNumber,
              }
            : undefined,
        telegram: type === "telegram" ? { botToken: wa.botToken } : undefined,
      });

      return ok({
        channelId,
        next:
          type === "web"
            ? "Call list_channels for the embed snippet."
            : type === "rcs"
              ? "Call list_channels for the callback URL to set as the inbound webhook with the RCS provider."
              : type === "telegram"
                ? "Call list_channels in a few seconds: status active and a botLink mean the bot is connected; otherwise lastError says why."
                : "Call list_channels for the callback URL to paste into Meta, then set status active with update_channel.",
      });
    })
  );

  server.registerTool(
    "update_channel",
    {
      title: "Update channel",
      description:
        "Rename a channel, repoint it at a different agent, or take it live / pause it. A paused channel silently ignores inbound messages. On a WhatsApp channel, also change its connection — the WABA ID notification templates sync from, the display number, a new access token. On an RCS channel, the access token, sender number or API base URL; on a Telegram channel, a new bot token (the webhook is re-registered). Omitted connection fields keep their stored value.",
      inputSchema: {
        ...workspaceArg,
        channel: z.string().describe("Channel name or id"),
        name: z.string().optional(),
        agent: z.string().optional().describe("Who answers here"),
        status: z.enum(["active", "paused"]).optional(),
        intake: z
          .enum(["chat", "form"])
          .optional()
          .describe(
            "Web only: chat asks for name and number inside the conversation; form shows a sign-in page first"
          ),
        wabaId: z
          .string()
          .optional()
          .describe("WhatsApp only: the business account id. Needed to sync templates."),
        displayPhoneNumber: z.string().optional().describe("WhatsApp or RCS"),
        phoneNumberId: z.string().optional().describe("WhatsApp only"),
        accessToken: z
          .string()
          .optional()
          .describe("WhatsApp or RCS: omit to keep the stored one"),
        botToken: z.string().optional().describe("Telegram only: omit to keep the stored one"),
        apiBaseUrl: z.string().optional().describe("WhatsApp or RCS"),
        apiVersion: z.string().optional().describe("WhatsApp only"),
      },
    },
    handler(async ({ workspace, channel, name, agent, status, intake, ...connection }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findChannel(found._id, channel);
      const agentId = agent ? (await findAgent(found._id, agent))._id : undefined;

      // The mutation replaces the WhatsApp connection whole, so a change to
      // one field sends the rest as stored. The token comes back masked, and
      // a masked or absent token is what tells the mutation to keep its own.
      const touched = Object.values(connection).some((value) => value !== undefined);
      let whatsapp;
      let provider = {};
      if (touched && target.type === "rcs") {
        provider = {
          rcs: {
            accessToken: connection.accessToken,
            apiBaseUrl: connection.apiBaseUrl ?? target.rcs?.apiBaseUrl,
            displayPhoneNumber: connection.displayPhoneNumber ?? target.rcs?.displayPhoneNumber,
          },
        };
      } else if (touched && target.type === "telegram") {
        if (!connection.botToken) {
          throw new Error(`${target.name} is a Telegram channel: only botToken can be changed.`);
        }
        provider = { telegram: { botToken: connection.botToken } };
      } else if (touched) {
        if (target.type !== "whatsapp" || !target.whatsapp) {
          throw new Error(`${target.name} is not a WhatsApp channel.`);
        }
        const stored = target.whatsapp;
        whatsapp = {
          apiBaseUrl: connection.apiBaseUrl ?? stored.apiBaseUrl,
          apiVersion: connection.apiVersion ?? stored.apiVersion,
          phoneNumberId: connection.phoneNumberId ?? stored.phoneNumberId,
          wabaId: connection.wabaId ?? stored.wabaId,
          businessId: stored.businessId,
          displayPhoneNumber: connection.displayPhoneNumber ?? stored.displayPhoneNumber,
          ...(connection.accessToken ? { accessToken: connection.accessToken } : {}),
        };
      }

      await call.mutation(api.channels.update, {
        channelId: target._id,
        name,
        agentId,
        status,
        intake,
        ...(whatsapp ? { whatsapp } : {}),
        ...provider,
      });
      return ok(`Updated ${target.name}.`);
    })
  );

  server.registerTool(
    "delete_channel",
    {
      title: "Delete channel",
      description:
        "Permanently delete a channel. A website widget stops loading, and a WhatsApp number, RCS sender or Telegram bot stops being answered.",
      inputSchema: {
        ...workspaceArg,
        channel: z.string().describe("Channel name or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, channel }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findChannel(found._id, channel);
      await call.mutation(api.channels.remove, { channelId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );
}
