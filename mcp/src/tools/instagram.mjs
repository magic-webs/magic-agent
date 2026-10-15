/**
 * Instagram automation — comment rules, moderation and DM tools on a
 * connected Instagram account.
 */

import { z } from "zod";
import { workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { handler, ok } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const channelArg = {
  account: z
    .string()
    .optional()
    .describe(
      "The Instagram @username or channel id. Omit when the workspace has one Instagram account."
    ),
};

async function instagramAccount(workspaceId, wanted) {
  const overview = await call.query(api.instagramAutomation.overview, {
    workspaceId,
    since: Date.now() - 7 * DAY_MS,
  });
  const channels = overview.channels;
  if (channels.length === 0) {
    throw new Error("This workspace has no Instagram account. Connect one from the Channels page.");
  }
  if (!wanted) {
    if (channels.length === 1) return { channel: channels[0], overview };
    throw new Error(
      `Name the account: ${channels.map((channel) => `@${channel.username}`).join(", ")}.`
    );
  }
  const handle = wanted.replace(/^@/, "").toLowerCase();
  const channel = channels.find(
    (row) => row._id === wanted || row.username.toLowerCase() === handle
  );
  if (!channel) throw new Error(`No connected Instagram account matches "${wanted}".`);
  return { channel, overview };
}

function ruleBrief(rule, usernames) {
  return {
    id: rule._id,
    name: rule.name,
    account: usernames.get(rule.channelId) ? `@${usernames.get(rule.channelId)}` : null,
    enabled: rule.enabled,
    match: rule.match,
    keywords: rule.keywords,
    postIds: rule.posts.map((post) => post.id),
    publicReply: rule.publicReply,
    dm: rule.dm ?? null,
    oncePerUser: rule.oncePerUser,
    fired: rule.fired,
    lastFiredAt: rule.lastFiredAt ? new Date(rule.lastFiredAt).toISOString() : null,
  };
}

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_instagram_rules",
    {
      title: "List Instagram comment rules",
      description:
        "The comment rules on the workspace's Instagram accounts, with how often each fired, and the last 7 days' totals (comments, public replies, DMs, moderated, story mentions). Also says whether each account allows comment management — one connected before it was added must be reconnected from the app.",
      inputSchema: { ...workspaceArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace }) => {
      const found = await resolveWorkspace(workspace);
      const overview = await call.query(api.instagramAutomation.overview, {
        workspaceId: found._id,
        since: Date.now() - 7 * DAY_MS,
      });
      const rules = await call.query(api.instagramAutomation.listRules, {
        workspaceId: found._id,
      });
      const usernames = new Map(overview.channels.map((row) => [row._id, row.username]));
      return ok({
        accounts: overview.channels.map((row) => ({
          id: row._id,
          username: `@${row.username}`,
          status: row.status,
          canManageComments: row.canManageComments,
        })),
        lastSevenDays: overview.totals,
        rules: rules.map((rule) => ruleBrief(rule, usernames)),
      });
    })
  );

  server.registerTool(
    "save_instagram_rule",
    {
      title: "Create or update an Instagram comment rule",
      description:
        "When a comment matches, reply publicly under it, send the commenter one private DM, or both. A comment fires one rule: keyword rules before 'any', and rules for chosen posts before rules for every post. {{username}} in a reply or DM becomes the commenter's @handle. Whatever they DM back is answered by the account's agent. Pass `rule` to update an existing one; omitted fields keep their stored value.",
      inputSchema: {
        ...workspaceArg,
        ...channelArg,
        rule: z.string().optional().describe("Id or name of the rule to update. Omit to create."),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        match: z.enum(["any", "keywords"]).optional(),
        keywords: z.array(z.string()).optional().describe("Whole words, any case"),
        postIds: z
          .array(z.string())
          .optional()
          .describe("Instagram media ids to limit the rule to. Empty means every post."),
        publicReply: z
          .object({
            mode: z.enum(["off", "fixed", "ai"]),
            variants: z
              .array(z.string())
              .optional()
              .describe("For fixed: replies picked at random, each under 300 characters"),
          })
          .optional(),
        dm: z
          .object({
            text: z.string(),
            buttonTitle: z.string().optional().describe("Up to 20 characters"),
            buttonUrl: z.string().optional().describe("https link the button opens"),
          })
          .nullable()
          .optional()
          .describe("null turns the DM off"),
        oncePerUser: z.boolean().optional().describe("Answer each person's first matching comment only"),
      },
    },
    handler(async ({ workspace, account, rule, postIds, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const rules = await call.query(api.instagramAutomation.listRules, {
        workspaceId: found._id,
      });
      const existing = rule
        ? rules.find(
            (row) => row._id === rule || row.name.toLowerCase() === rule.toLowerCase()
          )
        : null;
      if (rule && !existing) throw new Error(`No Instagram rule matches "${rule}".`);

      const { channel } = existing && !account
        ? { channel: { _id: existing.channelId } }
        : await instagramAccount(found._id, account);

      const posts = postIds
        ? postIds.map((id) => existing?.posts.find((post) => post.id === id) ?? { id })
        : (existing?.posts ?? []);
      const name = fields.name ?? existing?.name;
      if (!name) throw new Error("A new rule needs a name.");

      const ruleId = await call.mutation(api.instagramAutomation.saveRule, {
        workspaceId: found._id,
        ruleId: existing?._id,
        channelId: channel._id,
        name,
        enabled: fields.enabled ?? existing?.enabled ?? true,
        match: fields.match ?? existing?.match ?? "keywords",
        keywords: fields.keywords ?? existing?.keywords ?? [],
        posts,
        publicReply: fields.publicReply
          ? { mode: fields.publicReply.mode, variants: fields.publicReply.variants ?? [] }
          : (existing?.publicReply ?? { mode: "off", variants: [] }),
        dm: fields.dm === null ? undefined : (fields.dm ?? existing?.dm),
        oncePerUser: fields.oncePerUser ?? existing?.oncePerUser ?? true,
      });
      return ok({ ruleId, saved: existing ? "updated" : "created" });
    })
  );

  server.registerTool(
    "delete_instagram_rule",
    {
      title: "Delete an Instagram comment rule",
      description: "Removes a comment rule. Its past activity stays in the log.",
      inputSchema: {
        ...workspaceArg,
        rule: z.string().describe("Id or name of the rule"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, rule }) => {
      const found = await resolveWorkspace(workspace);
      const rules = await call.query(api.instagramAutomation.listRules, {
        workspaceId: found._id,
      });
      const existing = rules.find(
        (row) => row._id === rule || row.name.toLowerCase() === rule.toLowerCase()
      );
      if (!existing) throw new Error(`No Instagram rule matches "${rule}".`);
      await call.mutation(api.instagramAutomation.removeRule, { ruleId: existing._id });
      return ok({ deleted: existing.name });
    })
  );

  server.registerTool(
    "get_instagram_settings",
    {
      title: "Get Instagram moderation and DM settings",
      description:
        "An Instagram account's comment moderation (hide or delete links, blocked words, AI screening), its reply to story mentions, and its ice breaker questions.",
      inputSchema: { ...workspaceArg, ...channelArg },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, account }) => {
      const found = await resolveWorkspace(workspace);
      const { channel } = await instagramAccount(found._id, account);
      const settings = await call.query(api.instagramAutomation.getSettings, {
        channelId: channel._id,
      });
      return ok({ account: `@${channel.username}`, ...settings });
    })
  );

  server.registerTool(
    "update_instagram_settings",
    {
      title: "Update Instagram moderation and DM settings",
      description:
        "Change any of: comment moderation, the DM sent to people who mention the account in their story ({{username}} becomes their handle), and up to four ice breaker questions shown to someone opening a DM for the first time. Sections left out keep their stored value; moderation and storyMention are merged with what is stored.",
      inputSchema: {
        ...workspaceArg,
        ...channelArg,
        moderation: z
          .object({
            enabled: z.boolean().optional(),
            action: z.enum(["hide", "delete"]).optional(),
            blockLinks: z.boolean().optional(),
            blockedWords: z.array(z.string()).optional(),
            screenWithAi: z
              .boolean()
              .optional()
              .describe("Also hide insults, hate, threats and spam a word list misses. Billed as AI usage."),
          })
          .optional(),
        storyMention: z
          .object({ enabled: z.boolean().optional(), message: z.string().optional() })
          .optional(),
        iceBreakers: z.array(z.string()).max(4).optional().describe("Questions, up to 80 characters each. [] removes them."),
      },
    },
    handler(async ({ workspace, account, moderation, storyMention, iceBreakers }) => {
      const found = await resolveWorkspace(workspace);
      const { channel } = await instagramAccount(found._id, account);
      const current = await call.query(api.instagramAutomation.getSettings, {
        channelId: channel._id,
      });
      await call.mutation(api.instagramAutomation.saveSettings, {
        channelId: channel._id,
        moderation: moderation ? { ...current.moderation, ...moderation } : undefined,
        storyMention: storyMention ? { ...current.storyMention, ...storyMention } : undefined,
        iceBreakers: iceBreakers?.map((question) => ({ question })),
      });
      return ok({
        saved: true,
        next: iceBreakers
          ? "Ice breakers are sent to Instagram in the background; get_instagram_settings shows whether Instagram took them."
          : undefined,
      });
    })
  );

  server.registerTool(
    "list_instagram_activity",
    {
      title: "List Instagram automation activity",
      description:
        "The latest comments and story mentions the automations saw, newest first: who, what they wrote, which rule fired, and what was done — replied, DM sent, hidden or deleted — or why nothing was.",
      inputSchema: {
        ...workspaceArg,
        limit: z.number().int().min(1).max(100).optional().describe("Default 25"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, limit }) => {
      const found = await resolveWorkspace(workspace);
      const page = await call.query(api.instagramAutomation.listActivity, {
        workspaceId: found._id,
        paginationOpts: { numItems: limit ?? 25, cursor: null },
      });
      return ok(
        page.page.map((row) => ({
          at: new Date(row.createdAt).toISOString(),
          kind: row.kind,
          from: row.fromUsername ? `@${row.fromUsername}` : row.fromId,
          text: row.text,
          rule: row.ruleName ?? null,
          actions: row.actions,
          publicReply: row.publicReply ?? null,
          dm: row.dmText ?? null,
          reason: row.reason ?? null,
          error: row.error ?? null,
        }))
      );
    })
  );
}
