/**
 * Handover — who a conversation belongs to among the people, and the rules
 * that hand escalations to them.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findAgent, findMember, pickByName } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

const department = z.enum(["sales", "support", "accounts", "other"]);

const ruleBrief = (rule) => ({
  id: rule._id,
  name: rule.name,
  enabled: rule.enabled,
  agent: rule.agentName ?? "any",
  department: rule.department ?? "any",
  assignTo: rule.members.map((member) => member.name),
  pauseAgent: rule.pauseAgent,
  pauseMinutes: rule.pauseAgent ? (rule.pauseMinutes ?? 60) : null,
});

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "assign_conversation",
    {
      title: "Assign a conversation",
      description:
        "Gives a thread to a human agent on the team, or takes it off whoever has it when member is omitted. The thread gets a note saying who assigned it, and the team's phones are told.",
      inputSchema: {
        ...workspaceArg,
        conversationId: z.string().describe("From list_conversations"),
        member: z.string().optional().describe("Team member name or id. Omit to unassign"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handler(async ({ workspace, conversationId, member }) => {
      const found = await resolveWorkspace(workspace);
      const picked = member ? await findMember(found._id, member) : null;
      await call.mutation(api.conversations.assign, {
        conversationId,
        memberId: picked?._id ?? null,
      });
      return ok({ conversationId, assignedTo: picked?.name ?? null });
    })
  );

  server.registerTool(
    "list_handover_rules",
    {
      title: "List handover rules",
      description:
        "The rules that assign an escalated conversation to a person, in the order they are tried. The first enabled rule matching the escalating agent and department wins; several people on one rule take turns.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const rules = await call.query(api.handover.list, { workspaceId: found._id });
      return ok(rules.map(ruleBrief));
    })
  );

  server.registerTool(
    "save_handover_rule",
    {
      title: "Create or update a handover rule",
      description:
        "Creates a rule, or updates the one named by `rule`. When an agent escalates with escalate_to_human, the first matching rule assigns the conversation to its people and, with pauseAgent, stops the agent replying for pauseMinutes.",
      inputSchema: {
        ...workspaceArg,
        rule: z.string().optional().describe("Name or id of the rule to update. Omit to create"),
        name: z.string().min(1),
        agent: z.string().optional().describe("Only escalations by this agent. Omit for any"),
        department: department.optional().describe("Only this department. Omit for any"),
        assignTo: z.array(z.string()).min(1).describe("Team member names or ids; several take turns"),
        pauseAgent: z.boolean().optional().describe("Default true"),
        pauseMinutes: z.number().int().min(5).max(1440).optional().describe("Default 60"),
        enabled: z.boolean().optional().describe("Default true"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handler(async (input) => {
      const found = await resolveWorkspace(input.workspace);
      const agentId = input.agent ? (await findAgent(found._id, input.agent))._id : undefined;
      const memberIds = [];
      for (const wanted of input.assignTo) memberIds.push((await findMember(found._id, wanted))._id);
      const pauseAgent = input.pauseAgent ?? true;
      const fields = {
        name: input.name,
        agentId,
        department: input.department,
        memberIds,
        pauseAgent,
        pauseMinutes: pauseAgent ? input.pauseMinutes : undefined,
        enabled: input.enabled ?? true,
      };

      if (input.rule) {
        const rules = await call.query(api.handover.list, { workspaceId: found._id });
        const existing = rules.find((row) => row._id === input.rule) ??
          pickByName(rules, input.rule, "handover rule", ["name"]);
        await call.mutation(api.handover.update, { ruleId: existing._id, ...fields });
      } else {
        await call.mutation(api.handover.create, { workspaceId: found._id, ...fields });
      }
      const rules = await call.query(api.handover.list, { workspaceId: found._id });
      return ok(rules.map(ruleBrief));
    })
  );

  server.registerTool(
    "delete_handover_rule",
    {
      title: "Delete a handover rule",
      description: "Removes a handover rule. Conversations it already assigned keep their assignee.",
      inputSchema: {
        ...workspaceArg,
        rule: z.string().describe("Name or id of the rule"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    handler(async ({ workspace, rule }) => {
      const found = await resolveWorkspace(workspace);
      const rules = await call.query(api.handover.list, { workspaceId: found._id });
      const existing = rules.find((row) => row._id === rule) ??
        pickByName(rules, rule, "handover rule", ["name"]);
      await call.mutation(api.handover.remove, { ruleId: existing._id });
      return ok({ deleted: existing.name });
    })
  );
}
