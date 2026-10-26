import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
import { deleteFile, fileUrl, requireOwnKey, uploadUrlFor } from "./lib/files";
import { welcomeMenuShape } from "./schema/workspaces";
import {
  defaultWelcomeBody,
  optionsFromAgents,
  tidyWelcomeMenu,
  type WelcomeMenu,
} from "./lib/welcomeMenu";

async function specialistOptions(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return optionsFromAgents(
    agents
      .filter(
        (agent) =>
          (agent.kind === "specialist" || agent.kind === undefined) &&
          agent.status === "active" &&
          agent.acceptsHandoff !== false
      )
      .sort((a, b) => a.createdAt - b.createdAt)
  );
}

function resolve(workspace: Doc<"workspaces">, automatic: WelcomeMenu["options"]) {
  const saved = workspace.welcomeMenu;
  const custom = Boolean(saved && saved.options.length > 0);
  return {
    enabled: saved?.enabled ?? true,
    body: saved?.body.trim() || defaultWelcomeBody(workspace.name),
    header: saved?.header,
    footer: saved?.footer,
    buttonText: saved?.buttonText,
    headerImageKey: saved?.headerImageKey,
    options: custom ? saved!.options : automatic,
    automaticOptions: !custom,
  };
}

export const get = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (!workspace) return null;
    const automatic = await specialistOptions(ctx, args.workspaceId);
    const saved = workspace.welcomeMenu;
    const keys = [
      saved?.headerImageKey,
      ...(saved?.options ?? []).map((option) => option.imageKey),
    ].filter((key): key is string => Boolean(key));
    return {
      saved: saved ?? null,
      images: Object.fromEntries(keys.map((key) => [key, fileUrl(key)])),
      effective: resolve(workspace, automatic),
      agentOptions: automatic,
      defaultBody: defaultWelcomeBody(workspace.name),
    };
  },
});

export const save = mutation({
  args: { workspaceId: v.id("workspaces"), menu: welcomeMenuShape },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const menu = tidyWelcomeMenu(args.menu);
    const keys = (value: WelcomeMenu | undefined) =>
      [value?.headerImageKey, ...(value?.options ?? []).map((option) => option.imageKey)].filter(
        (key): key is string => Boolean(key)
      );
    for (const key of keys(menu)) requireOwnKey(key, "welcome", args.workspaceId);

    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    const kept = new Set(keys(menu));
    for (const key of keys(workspace?.welcomeMenu)) {
      if (!kept.has(key)) await deleteFile(ctx, key);
    }
    await ctx.db.patch(args.workspaceId, { welcomeMenu: menu, updatedAt: Date.now() });
    return menu;
  },
});

export async function liveWelcomeMenu(ctx: QueryCtx, workspace: Doc<"workspaces">) {
  if (workspace.welcomeMenu?.enabled === false) return null;
  const menu = resolve(workspace, await specialistOptions(ctx, workspace._id));
  return menu.options.length > 0 ? menu : null;
}

export const forTurn = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    return workspace ? await liveWelcomeMenu(ctx, workspace) : null;
  },
});

export const returnToFrontDesk = internalMutation({
  args: { conversationId: v.id("conversations"), agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation || conversation.activeAgentId === args.agentId) return;
    await ctx.db.patch(args.conversationId, { activeAgentId: args.agentId });
  },
});

export const generateUploadUrl = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await uploadUrlFor("welcome", args.workspaceId);
  },
});
