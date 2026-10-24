/**
 * The knowledge base agents search before answering, and the gaps in it:
 * questions an agent could not answer, waiting for the team to add the answer.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findAgent, findKnowledge, pickByName } from "../lookup.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

async function findGap(workspaceId, wanted) {
  const gaps = await call.query(api.knowledgeGaps.listByWorkspace, {
    workspaceId,
    status: "open",
  });
  if (gaps.some((g) => g._id === wanted)) return gaps.find((g) => g._id === wanted);
  return pickByName(gaps, wanted, "open knowledge gap", ["question"]);
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_knowledge",
    {
      title: "List knowledge sources",
      description:
        "What agents can retrieve from. A source scoped to an agent is private to it; an unscoped one is available to every agent in the workspace. Status must reach 'ready' before it is searchable.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const sources = await call.query(api.knowledge.listByWorkspace, {
        workspaceId: found._id,
      });
      return ok(
        sources.map((source) => ({
          id: source._id,
          title: source.title,
          kind: source.kind,
          status: source.status,
          scope: source.agentId ? "one agent" : "whole workspace",
          agentName: source.agentName ?? null,
          chunks: source.chunkCount,
          characters: source.charCount,
          tags: source.tags,
          url: source.url ?? null,
          failureReason: source.failureReason ?? null,
        }))
      );
    })
  );

  server.registerTool(
    "add_knowledge",
    {
      title: "Add knowledge",
      description:
        "Add a policy, FAQ, spec sheet or web page to the knowledge base. It is chunked and embedded in the background, so it becomes searchable a few seconds later — check list_knowledge for status 'ready'. Uploading files is the dashboard's job; this takes text. For a web page, do not hand over the bare URL: fetch the page yourself, keep its readable content (headings, prose, prices, FAQs — no navigation, footers or scripts), and save that as kind text with the page's address in url.",
      inputSchema: {
        ...workspaceArg,
        title: z.string().describe("How this source is labelled in citations"),
        kind: z
          .enum(["text", "faq"])
          .describe(
            "text for prose and web pages, faq for question/answer pairs"
          ),
        content: z
          .string()
          .describe(
            "The text itself. For a web page, the page's content as you fetched it, as plain text or markdown."
          ),
        url: z
          .string()
          .optional()
          .describe(
            "The address the content was taken from, kept on the source for citations. It is not fetched."
          ),
        agent: z
          .string()
          .optional()
          .describe(
            "Scope this source to one agent. Omit to make it available to every agent."
          ),
        tags: z.array(z.string()).optional(),
      },
    },
    handler(async ({ workspace, title, kind, content, url, agent, tags }) => {
      const found = await resolveWorkspace(workspace);
      const scoped = agent ? await findAgent(found._id, agent) : null;

      const sourceId = await call.mutation(api.knowledge.addSource, {
        workspaceId: found._id,
        agentId: scoped?._id,
        title,
        kind,
        rawText: content,
        url,
        tags,
      });
      return ok({
        sourceId,
        note: "Embedding runs in the background. Check list_knowledge for status 'ready'.",
      });
    })
  );

  server.registerTool(
    "list_knowledge_gaps",
    {
      title: "List knowledge gaps",
      description:
        "What the knowledge base needs fixing: questions an agent could not answer (kind unanswered — repeats are grouped, so askCount says how often it came up) and agent replies the team marked as wrong (kind wrong_answer, with the reply in wrongReply). Fix either with answer_knowledge_gap, most asked first.",
      inputSchema: {
        ...workspaceArg,
        status: z
          .enum(["open", "answered", "dismissed"])
          .optional()
          .describe("Defaults to open. answered means fixed."),
        kind: z.enum(["unanswered", "wrong_answer"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, status, kind }) => {
      const found = await resolveWorkspace(workspace);
      const gaps = await call.query(api.knowledgeGaps.listByWorkspace, {
        workspaceId: found._id,
        status: status ?? "open",
        kind,
      });
      return ok(
        gaps.map((gap) => ({
          id: gap._id,
          kind: gap.kind,
          question: gap.question,
          wrongReply: gap.wrongReply ?? null,
          note: gap.note ?? null,
          customerMessage: gap.customerMessage ?? null,
          askCount: gap.askCount,
          firstAskedAt: new Date(gap.firstAskedAt).toISOString(),
          lastAskedAt: new Date(gap.lastAskedAt).toISOString(),
          agentName: gap.agentName ?? null,
          conversationIds: gap.conversationIds,
          answeredBy: gap.sourceTitle ?? null,
        }))
      );
    })
  );

  server.registerTool(
    "answer_knowledge_gap",
    {
      title: "Answer a knowledge gap",
      description:
        "Add the answer to an open knowledge gap. It is saved as an FAQ knowledge source, so every agent (or the one named) answers it from now on, and the gap is marked answered. For a wrong answer it is saved as a correction, which agents follow over any other source that disagrees. Only write an answer the business has actually given you — never make one up.",
      inputSchema: {
        ...workspaceArg,
        gap: z.string().describe("Gap id, or its question text"),
        answer: z.string().describe("The answer, as the agent should give it"),
        question: z
          .string()
          .optional()
          .describe("A clearer wording of the question, if the stored one needs it"),
        agent: z
          .string()
          .optional()
          .describe("Make the answer private to one agent. Omit for every agent."),
      },
    },
    handler(async ({ workspace, gap, answer, question, agent }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findGap(found._id, gap);
      const scoped = agent ? await findAgent(found._id, agent) : null;
      const { sourceId } = await call.mutation(api.knowledgeGaps.answer, {
        gapId: target._id,
        answer,
        question,
        agentId: scoped?._id,
      });
      return ok({
        sourceId,
        note: "Saved as an FAQ source. Embedding runs in the background — check list_knowledge for status 'ready'.",
      });
    })
  );

  server.registerTool(
    "mark_answer_wrong",
    {
      title: "Mark an agent reply as wrong",
      description:
        "Flag one of an agent's replies as wrong, by its message id from read_conversation. It shows as a wrong answer in the knowledge gaps, linked to the knowledge sources the reply was built from. Pass correctAnswer to fix it in the same call — saved as a correction FAQ that overrides what disagrees with it. Only use an answer the business has actually given you.",
      inputSchema: {
        ...workspaceArg,
        message: z.string().describe("The agent reply's message id, from read_conversation"),
        note: z.string().optional().describe("What was wrong with it"),
        correctAnswer: z.string().optional(),
        question: z
          .string()
          .optional()
          .describe("The question the correction answers. Defaults to the customer message the reply was answering."),
        agent: z
          .string()
          .optional()
          .describe("Make the correction private to one agent. Omit for every agent."),
      },
    },
    handler(async ({ workspace, message, note, correctAnswer, question, agent }) => {
      const found = await resolveWorkspace(workspace);
      const gapId = await call.mutation(api.knowledgeGaps.markWrong, {
        messageId: message,
        note,
      });
      if (!correctAnswer) {
        return ok({ gapId, note: "Marked wrong. Fix it later with answer_knowledge_gap." });
      }
      const scoped = agent ? await findAgent(found._id, agent) : null;
      const { sourceId } = await call.mutation(api.knowledgeGaps.answer, {
        gapId,
        answer: correctAnswer,
        question,
        note,
        agentId: scoped?._id,
      });
      return ok({ gapId, sourceId, note: "Marked wrong and corrected." });
    })
  );

  server.registerTool(
    "dismiss_knowledge_gap",
    {
      title: "Dismiss a knowledge gap",
      description:
        "Mark a gap as not worth answering — spam, or not something the business does. Later asks of the same question stay dismissed.",
      inputSchema: {
        ...workspaceArg,
        gap: z.string().describe("Gap id, or its question text"),
      },
    },
    handler(async ({ workspace, gap }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findGap(found._id, gap);
      await call.mutation(api.knowledgeGaps.dismiss, { gapId: target._id });
      return ok(`Dismissed "${target.question}".`);
    })
  );

  server.registerTool(
    "delete_knowledge",
    {
      title: "Delete a knowledge source",
      description:
        "Permanently delete a source and everything embedded from it. Agents stop being able to retrieve it immediately.",
      inputSchema: {
        ...workspaceArg,
        source: z.string().describe("Source title or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, source }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findKnowledge(found._id, source);
      await call.mutation(api.knowledge.remove, { sourceId: target._id });
      return ok(`Deleted "${target.title}".`);
    })
  );
}
