import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";
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
    return {
      saved: workspace.welcomeMenu ?? null,
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
