import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { requireWorkspace } from "./lib/auth";
import { ensureFollowUpDesk, ensureMarketingDesk, ensureRouter } from "./agents";
import { queueSource } from "./knowledge";
import { tidyWelcomeMenu } from "./lib/welcomeMenu";

// The workspace of a website built on Magicwebs, set up from the site itself.
// Magicwebs calls this as the site's owner when the workspace is made and
// again on every publish, so it only fills what is missing and keeps the
// knowledge base in step with the pages: the company details and facts the
// owner has not given yet (Magicwebs reads them from the site and from what
// the original website declares about itself), a front desk, a follow-up desk
// and a marketing desk, a welcome menu, and one knowledge source per page.
//
// The welcome menu matters because these workspaces have no specialists, so
// the automatic menu (built from specialists) is empty. Without one, a widget
// visitor who gives their name and number gets no reply until they type a
// question. Magicwebs sends options drawn from the site's pages; tapping one
// sends its title, and the front desk answers it from the knowledge base.

const WEBSITE_TAG = "website";
const pageTag = (path: string) => `page:${path}`;
const MAX_PAGE_TEXT = 60_000;
const MAX_PAGES = 40;

const profileShape = v.object({
  description: v.optional(v.string()),
  tagline: v.optional(v.string()),
  industry: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
  supportEmail: v.optional(v.string()),
  supportPhone: v.optional(v.string()),
  address: v.optional(v.string()),
  website: v.optional(v.string()),
});

async function dropSource(ctx: MutationCtx, source: Doc<"knowledgeSources">) {
  const chunks = await ctx.db
    .query("knowledgeChunks")
    .withIndex("by_source", (q) => q.eq("sourceId", source._id))
    .collect();
  for (const chunk of chunks) await ctx.db.delete(chunk._id);
  await ctx.db.delete(source._id);
}

async function refreshSource(ctx: MutationCtx, source: Doc<"knowledgeSources">, title: string, rawText: string) {
  const chunks = await ctx.db
    .query("knowledgeChunks")
    .withIndex("by_source", (q) => q.eq("sourceId", source._id))
    .collect();
  for (const chunk of chunks) await ctx.db.delete(chunk._id);
  await ctx.db.patch(source._id, {
    title,
    rawText,
    charCount: rawText.length,
    status: "pending",
    chunkCount: 0,
    failureReason: undefined,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.ingest.processSource, { sourceId: source._id });
}

export const setUp = mutation({
  args: {
    workspaceSlug: v.string(),
    profile: profileShape,
    facts: v.optional(v.array(v.object({ key: v.string(), value: v.string() }))),
    pages: v.array(v.object({ path: v.string(), title: v.string(), text: v.string() })),
    /** Saved only while the workspace has no welcome menu, so the owner's own menu wins. */
    welcomeMenu: v.optional(
      v.object({
        body: v.optional(v.string()),
        options: v.array(v.object({ title: v.string(), description: v.optional(v.string()) })),
      })
    ),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug))
      .unique();
    if (!workspace) throw new ConvexError("Workspace not found");
    await requireWorkspace(ctx, workspace._id);

    // Company details: only what is still empty, so the owner's own words win.
    const patch: Partial<Doc<"workspaces">> = {};
    const { logoUrl, ...fields } = args.profile;
    for (const [key, value] of Object.entries(fields) as [keyof typeof fields, string | undefined][]) {
      const clean = value?.trim();
      if (clean && !workspace[key]) patch[key] = clean.slice(0, key === "description" ? 2000 : 300);
    }
    const logo = logoUrl?.trim();
    if (logo && /^https:\/\//i.test(logo) && !workspace.logoUrl && !workspace.logoKey && !workspace.logoStorageId) {
      patch.logoUrl = logo.slice(0, 1000);
    }
    const known = new Set(workspace.facts.map((fact) => fact.key.trim().toLowerCase()));
    const newFacts = (args.facts ?? [])
      .map((fact) => ({ key: fact.key.trim().slice(0, 80), value: fact.value.trim().slice(0, 500) }))
      .filter((fact) => fact.key && fact.value && !known.has(fact.key.toLowerCase()));
    if (newFacts.length) patch.facts = [...workspace.facts, ...newFacts].slice(0, 60);
    if (args.welcomeMenu && !workspace.welcomeMenu) {
      // An empty body falls back to the default greeting when the menu is sent.
      const menu = tidyWelcomeMenu({ enabled: true, body: args.welcomeMenu.body ?? "", options: args.welcomeMenu.options });
      if (menu.options.length) patch.welcomeMenu = menu;
    }
    if (Object.keys(patch).length) {
      await ctx.db.patch(workspace._id, { ...patch, updatedAt: Date.now() });
    }

    const frontDesk = await ensureRouter(ctx, workspace._id);
    const marketing = await ensureMarketingDesk(ctx, workspace._id);
    const followUp = await ensureFollowUpDesk(ctx, workspace._id);

    // Knowledge: one text source per page, tagged so later runs find it again.
    const existing = (
      await ctx.db
        .query("knowledgeSources")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect()
    ).filter((source) => source.tags.includes(WEBSITE_TAG));
    const byPage = new Map(
      existing.flatMap((source) => {
        const tag = source.tags.find((t) => t.startsWith("page:"));
        return tag ? [[tag, source] as const] : [];
      })
    );

    let added = 0;
    let updated = 0;
    const kept = new Set<Id<"knowledgeSources">>();
    for (const page of args.pages.slice(0, MAX_PAGES)) {
      const text = page.text.trim().slice(0, MAX_PAGE_TEXT);
      if (text.length < 40) continue;
      const tag = pageTag(page.path);
      const title = `Website: ${page.title.trim() || page.path} (${page.path})`;
      const source = byPage.get(tag);
      if (source) {
        kept.add(source._id);
        if (source.rawText !== text || source.title !== title) {
          await refreshSource(ctx, source, title, text);
          updated += 1;
        }
      } else {
        await queueSource(ctx, {
          workspaceId: workspace._id,
          agentId: undefined,
          title,
          kind: "text",
          tags: [WEBSITE_TAG, tag],
          rawText: text,
        });
        added += 1;
      }
    }

    let removed = 0;
    for (const source of existing) {
      if (!kept.has(source._id) && byPage.has(source.tags.find((t) => t.startsWith("page:")) ?? "")) {
        await dropSource(ctx, source);
        removed += 1;
      }
    }

    return {
      profile: Object.keys(patch),
      frontDeskCreated: frontDesk.created,
      marketingCreated: marketing.created,
      followUpCreated: followUp.created,
      welcomeMenuCreated: Boolean(patch.welcomeMenu),
      knowledge: { added, updated, removed },
    };
  },
});

const CHAT_LEADS_SCAN = 500;
const CHAT_LEAD_MESSAGE = 500;

/**
 * The website chat's leads, newest first, for Magicwebs to list beside its
 * form submissions: every web visitor who left a name, number or email, with
 * their conversation and the first thing they asked after the intake questions.
 */
export const chatLeads = query({
  args: { workspaceSlug: v.string() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug))
      .unique();
    if (!workspace) throw new ConvexError("Workspace not found");
    await requireWorkspace(ctx, workspace._id);

    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(CHAT_LEADS_SCAN);

    const leads = [];
    for (const contact of contacts) {
      if (contact.channelType !== "web" || !(contact.name || contact.phone || contact.email)) continue;
      const conversation = await ctx.db
        .query("conversations")
        .withIndex("by_contact_agent", (q) => q.eq("contactId", contact._id))
        .first();
      let message: string | undefined;
      if (conversation) {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
          .take(20);
        // The intake's own answers (name, number) are not what they came for.
        const asked = messages.find(
          (m) => m.role === "user" && (conversation.intakeAt === undefined || m.createdAt > conversation.intakeAt)
        );
        message = asked?.text?.slice(0, CHAT_LEAD_MESSAGE);
      }
      leads.push({
        contactId: contact._id,
        conversationId: conversation?._id ?? null,
        name: contact.name ?? null,
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        company: contact.company ?? null,
        message: message ?? null,
        createdAt: contact.createdAt,
      });
    }
    return leads;
  },
});
