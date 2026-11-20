/**
 * Every tool group, in the order they are registered.
 *
 * Order is the order a client lists them in, so it reads as a tour of the
 * platform: what you can see, then agents, what they sell, what they collect,
 * what they know,
 * where customers reach them, what they can call, what they did, where each
 * lead has got to, who gets told when something happens, what the marketing
 * desk sends — and last the admin tools most callers will never be allowed to
 * use.
 */

import { register as context } from "./context.mjs";
import { register as agents } from "./agents.mjs";
import { register as catalogue } from "./catalogue.mjs";
import { register as records } from "./records.mjs";
import { register as payments } from "./payments.mjs";
import { register as knowledge } from "./knowledge.mjs";
import { register as uploads } from "./uploads.mjs";
import { register as channels } from "./channels.mjs";
import { register as customTools } from "./custom-tools.mjs";
import { register as operations } from "./operations.mjs";
import { register as handover } from "./handover.mjs";
import { register as leads } from "./leads.mjs";
import { register as notifications } from "./notifications.mjs";
import { register as marketing } from "./marketing.mjs";
import { register as instagram } from "./instagram.mjs";
import { register as admin } from "./admin.mjs";

const GROUPS = [
  { title: "Context", register: context },
  { title: "Agents", register: agents },
  { title: "Catalogue", register: catalogue },
  { title: "Records", register: records },
  { title: "Payments", register: payments },
  { title: "Knowledge", register: knowledge },
  { title: "Uploads", register: uploads },
  { title: "Channels", register: channels },
  { title: "Custom tools", register: customTools },
  { title: "Operations", register: operations },
  { title: "Handover", register: handover },
  { title: "Leads", register: leads },
  { title: "Notifications", register: notifications },
  { title: "Marketing", register: marketing },
  { title: "Instagram", register: instagram },
  { title: "Platform administration", register: admin, admin: true },
];

function groupsFor(scope) {
  return scope === "workspace" ? GROUPS.filter((group) => !group.admin) : GROUPS;
}

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {"full" | "workspace"} [scope]
 */
export function registerAll(server, scope = "full") {
  for (const group of groupsFor(scope)) group.register(server);
}

/**
 * Every tool's name and description, grouped, without building a server.
 *
 * @param {"full" | "workspace"} [scope]
 */
export function toolCatalogue(scope = "full") {
  return groupsFor(scope).map((group) => {
    const tools = [];
    group.register({
      registerTool(name, config) {
        tools.push({
          name,
          title: config.title ?? name,
          description: config.description ?? "",
          readOnly: config.annotations?.readOnlyHint === true,
          destructive: config.annotations?.destructiveHint === true,
        });
      },
    });
    return { title: group.title, admin: group.admin === true, tools };
  }).filter((group) => group.tools.length > 0);
}

/**
 * Every tool with its handler, for running them in-process instead of over
 * MCP — Genie calls these from a Convex action.
 *
 * @param {"full" | "workspace"} [scope]
 */
export function toolDefinitions(scope = "workspace") {
  const tools = [];
  for (const group of groupsFor(scope)) {
    group.register({
      registerTool(name, config, run) {
        tools.push({ name, group: group.title, config, run });
      },
    });
  }
  return tools;
}
