import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireWorkspace } from "./lib/auth";

const CAP = 200;

function capped(count: number): number | string {
  return count >= CAP ? `${CAP}+` : count;
}

async function readSetup(ctx: QueryCtx, workspaceId: Id<"workspaces">, now: number) {
  await requireWorkspace(ctx, workspaceId);
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return null;

  const [agents, channels, books, stages, tools, google, apps, payments, team] =
    await Promise.all([
      ctx.db
        .query("agents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("channels")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("recordBooks")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("leadStages")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("tools")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .take(CAP),
      ctx.db
        .query("integrationConnections")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("appConnections")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("paymentConnections")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .first(),
      ctx.db
        .query("teamMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .take(CAP),
    ]);

  const [sources, products, openGaps, templates, account, wallet] = await Promise.all([
    ctx.db
      .query("knowledgeSources")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(CAP),
    ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(CAP),
    ctx.db
      .query("knowledgeGaps")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "open")
      )
      .take(CAP),
    ctx.db
      .query("marketingTemplates")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(CAP),
    ctx.db
      .query("billingAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first(),
    ctx.db
      .query("wallets")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first(),
  ]);
  const plan = account?.planId ? await ctx.db.get("billingPlans", account.planId) : null;

  const agentName = new Map(agents.map((a) => [a._id as string, a.botName]));
  const profile = {
    tagline: workspace.tagline,
    description: workspace.description,
    industry: workspace.industry,
    website: workspace.website,
    supportEmail: workspace.supportEmail,
    supportPhone: workspace.supportPhone,
    address: workspace.address,
    logo: workspace.logoUrl ?? workspace.logoKey ?? workspace.logoStorageId,
  };
  const days = (at: number | undefined) =>
    at === undefined ? null : Math.round((at - now) / 86_400_000);

  return {
    workspace: {
      name: workspace.name,
      industry: workspace.industry ?? null,
      timezone: workspace.timezone,
      currency: workspace.currency,
    },
    companyProfile: {
      filled: Object.keys(profile).filter((k) => profile[k as keyof typeof profile]),
      missing: Object.keys(profile).filter((k) => !profile[k as keyof typeof profile]),
      facts: workspace.facts.length,
      welcomeMenu: Boolean(workspace.welcomeMenu),
    },
    agents: agents.map((a) => ({
      name: a.botName,
      role: a.role,
      kind: a.kind ?? "specialist",
      status: a.status,
      hasRoutingDescription: Boolean(a.routingDescription?.trim()),
      knowledgeEnabled: a.knowledgeEnabled,
      recordBooks: (a.recordBooks ?? [])
        .map((id) => books.find((b) => b._id === id)?.pluralName)
        .filter(Boolean),
      customTools: tools.filter((t) => t.agentId === a._id).length,
    })),
    channels: channels.map((c) => ({
      type: c.type,
      name: c.name,
      status: c.status,
      answeredBy: c.humanOnly ? "team only" : (agentName.get(c.agentId) ?? "missing agent"),
      lastError: c.status === "error" ? (c.lastError ?? null) : null,
      daysSinceLastMessage: c.lastInboundAt
        ? Math.round((now - c.lastInboundAt) / 86_400_000)
        : null,
    })),
    knowledgeBase: {
      sources: capped(sources.length),
      ready: sources.filter((s) => s.status === "ready").length,
      processing: sources.filter((s) => s.status === "pending" || s.status === "processing").length,
      failed: sources
        .filter((s) => s.status === "failed")
        .map((s) => ({ title: s.title, reason: s.failureReason ?? null })),
      openKnowledgeGaps: capped(openGaps.length),
    },
    catalogue: { products: capped(products.length) },
    recordBooks: books
      .filter((b) => b.status !== "archived")
      .map((b) => ({
        name: b.pluralName,
        status: b.status,
        fields: b.fields.length,
        stages: b.stages,
        switchedOnFor: agents
          .filter((a) => a.recordBooks?.includes(b._id))
          .map((a) => a.botName),
      })),
    leadStages: stages.map((s) => s.name),
    whatsappTemplates: templates.map((t) => ({
      name: t.name,
      occasion: t.occasion,
      metaStatus: t.metaStatus ?? "not submitted",
      rejectedReason: t.metaRejectedReason ?? null,
    })),
    integrations: [
      ...google.map((g) => ({ name: g.integration, status: g.status })),
      ...apps.map((a) => ({ name: a.app, status: a.status })),
      ...(payments ? [{ name: `razorpay (${payments.mode})`, status: payments.status }] : []),
    ],
    team: { members: capped(team.length) },
    billing: account
      ? {
          plan: plan?.name ?? null,
          mode: account.mode,
          trialEndsInDays: account.mode === "trial" ? days(account.trialEndsAt) : null,
          walletBalance: wallet ? wallet.balanceMicros / 1_000_000 : null,
        }
      : null,
  };
}

export const setup = internalQuery({
  args: { workspaceId: v.id("workspaces"), now: v.number() },
  handler: (ctx, { workspaceId, now }) => readSetup(ctx, workspaceId, now),
});

export const suggestions = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }): Promise<string[]> => {
    const setup = await readSetup(ctx, workspaceId, 0);
    if (!setup) return [];
    const out: string[] = [];
    const errored = setup.channels.find((c) => c.status === "error");
    if (errored) out.push(`Why is my ${errored.name} channel showing an error?`);
    if (!setup.channels.length) out.push("How do I connect WhatsApp?");
    const draft = setup.agents.find((a) => a.status === "draft" && a.kind === "specialist");
    if (draft) out.push(`How do I make ${draft.name} live?`);
    const unrouted = setup.agents.find(
      (a) => a.kind === "specialist" && a.status === "active" && !a.hasRoutingDescription
    );
    if (unrouted) out.push(`Why isn't ${unrouted.name} getting any chats?`);
    const idleBook = setup.recordBooks.find((b) => !b.switchedOnFor.length);
    if (idleBook) out.push(`Why aren't any ${idleBook.name} being filed?`);
    if (setup.knowledgeBase.failed.length) out.push("Why did my knowledge source fail?");
    if (setup.whatsappTemplates.some((t) => t.metaStatus.toLowerCase() === "rejected")) {
      out.push("Why was my WhatsApp template rejected?");
    }
    if (setup.companyProfile.missing.length > 3) out.push("What's missing from my company profile?");
    return [
      ...out,
      "What should I set up next?",
      "How does the front desk route chats?",
      "How do I send a festival greeting?",
    ].slice(0, 4);
  },
});
