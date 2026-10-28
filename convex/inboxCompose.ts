import { v, type Infer } from "convex/values";
import { query, action, internalQuery, type ActionCtx } from "./_generated/server";
import { mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { threadAccess } from "./lib/auth";
import { fileUrl, requireOwnKey, uploadUrlFor } from "./lib/files";
import { friendlySendError } from "./lib/sendErrors";
import { sendOnChannel } from "./lib/channelSend";
import { summarise, type Outbound } from "./lib/whatsappSend";
import { billingCategory, parseTemplate, templateComponents, templatePreview } from "./lib/notifications";
import { describeTemplate } from "./notifications";
import { templateBlock } from "./lib/wallet";

export const composedMessage = v.union(
  v.object({
    kind: v.literal("media"),
    media: v.union(v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("document")),
    key: v.string(),
    mimeType: v.string(),
    caption: v.optional(v.string()),
    filename: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("location"),
    latitude: v.number(),
    longitude: v.number(),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("contact"),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("buttons"),
    body: v.string(),
    buttons: v.array(v.string()),
    header: v.optional(v.string()),
    footer: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("list"),
    body: v.string(),
    buttonText: v.string(),
    sections: v.array(
      v.object({
        title: v.string(),
        rows: v.array(v.object({ title: v.string(), description: v.optional(v.string()) })),
      })
    ),
    header: v.optional(v.string()),
    footer: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("cta_url"),
    body: v.string(),
    displayText: v.string(),
    url: v.string(),
    footer: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("request_location"), body: v.string() }),
  v.object({
    kind: v.literal("template"),
    templateId: v.id("whatsappTemplates"),
    values: v.record(v.string(), v.string()),
    headerKey: v.optional(v.string()),
  })
);

type Composed = Infer<typeof composedMessage>;

const trimmed = (value: string | undefined) => value?.trim() || undefined;

/** The approved templates of the thread's own number, with their blanks. */
export const templatesForThread = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const access = await threadAccess(ctx, args.conversationId);
    const channelId = access?.conversation.channelId;
    if (!access || access.conversation.channelType !== "whatsapp" || !channelId) return [];
    const rows = await ctx.db
      .query("whatsappTemplates")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .take(500);
    return rows
      .map(describeTemplate)
      .sort((a, b) => Number(b.sendable) - Number(a.sendable) || a.name.localeCompare(b.name));
  },
});

export const generateUploadUrl = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const access = await threadAccess(ctx, args.conversationId);
    if (!access) throw new Error("This conversation is no longer available.");
    return await uploadUrlFor("inbox", access.conversation.workspaceId);
  },
});

export const templateForSend = internalQuery({
  args: { templateId: v.id("whatsappTemplates") },
  handler: async (ctx, args) => await ctx.db.get("whatsappTemplates", args.templateId),
});

export const walletBlockFor = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    category: v.union(v.literal("marketing"), v.literal("utility"), v.literal("authentication")),
  },
  handler: async (ctx, args) => await templateBlock(ctx, args.workspaceId, args.category),
});

async function toOutbound(
  ctx: ActionCtx,
  message: Composed,
  workspaceId: Id<"workspaces">,
  channelId: Id<"channels">
): Promise<Outbound | string> {
  switch (message.kind) {
    case "media":
      requireOwnKey(message.key, "inbox", workspaceId);
      return {
        kind: "media",
        media: message.media,
        source: { link: fileUrl(message.key) },
        mimeType: message.mimeType,
        caption: trimmed(message.caption),
        filename: trimmed(message.filename),
      };

    case "location":
      if (Math.abs(message.latitude) > 90 || Math.abs(message.longitude) > 180) {
        return "That location's coordinates are out of range.";
      }
      return {
        kind: "location",
        latitude: message.latitude,
        longitude: message.longitude,
        name: trimmed(message.name),
        address: trimmed(message.address),
      };

    case "contact": {
      const phone = message.phone.replace(/[^\d+]/g, "");
      if (!message.name.trim() || phone.replace("+", "").length < 6) {
        return "A contact card needs a name and a phone number.";
      }
      const email = trimmed(message.email);
      const company = trimmed(message.company);
      return {
        kind: "contacts",
        contacts: [
          {
            formattedName: message.name.trim(),
            firstName: message.name.trim(),
            phones: [{ phone, type: "CELL", waId: phone.replace("+", "") }],
            ...(email ? { emails: [{ email, type: "WORK" }] } : {}),
            ...(company ? { org: { company } } : {}),
          },
        ],
      };
    }

    case "buttons": {
      const titles = message.buttons.map((title) => title.trim()).filter(Boolean).slice(0, 3);
      if (!message.body.trim() || titles.length === 0) {
        return "Reply buttons need a message and at least one button.";
      }
      const header = trimmed(message.header);
      return {
        kind: "buttons",
        body: message.body.trim(),
        buttons: titles.map((title, index) => ({ id: `team_${index + 1}`, title })),
        ...(header ? { header: { type: "text", text: header } } : {}),
        footer: trimmed(message.footer),
      };
    }

    case "list": {
      let next = 0;
      const sections = message.sections
        .map((section) => ({
          title: section.title.trim(),
          rows: section.rows
            .filter((row) => row.title.trim())
            .map((row) => ({
              id: `team_row_${++next}`,
              title: row.title.trim(),
              description: trimmed(row.description),
            })),
        }))
        .filter((section) => section.rows.length > 0);
      if (!message.body.trim() || !message.buttonText.trim() || sections.length === 0) {
        return "A list needs a message, a button label and at least one row.";
      }
      if (next > 10) return "A list can hold at most 10 rows.";
      const header = trimmed(message.header);
      return {
        kind: "list",
        body: message.body.trim(),
        buttonText: message.buttonText.trim(),
        sections,
        ...(header ? { header: { type: "text", text: header } } : {}),
        footer: trimmed(message.footer),
      };
    }

    case "cta_url":
      if (!/^https?:\/\/\S+\.\S+/i.test(message.url.trim())) {
        return "The link needs a full web address, starting with https://.";
      }
      if (!message.body.trim() || !message.displayText.trim()) {
        return "A link button needs a message and a label.";
      }
      return {
        kind: "cta_url",
        body: message.body.trim(),
        displayText: message.displayText.trim(),
        url: message.url.trim(),
        footer: trimmed(message.footer),
      };

    case "request_location":
      if (!message.body.trim()) return "Say why you are asking for their location.";
      return { kind: "request_location", body: message.body.trim() };

    case "template": {
      const row = await ctx.runQuery(internal.inboxCompose.templateForSend, {
        templateId: message.templateId,
      });
      if (!row || row.channelId !== channelId) {
        return "That template is not on this conversation's WhatsApp number.";
      }
      const described = describeTemplate(row);
      if (!described.sendable) {
        return described.unsupported ?? "Only an approved template can be sent.";
      }
      let components: unknown = [];
      try {
        components = JSON.parse(row.components);
      } catch {
        components = [];
      }
      const parsed = parseTemplate(components);
      const values = { ...message.values };
      if (message.headerKey) {
        requireOwnKey(message.headerKey, "inbox", workspaceId);
        values["header:media"] = fileUrl(message.headerKey);
      }
      const missing = parsed.slots.find((slot) => !values[slot.key]?.trim());
      if (missing) return `Fill in ${missing.label} first.`;

      const category = billingCategory(row.category);
      const walletBlock = await ctx.runQuery(internal.inboxCompose.walletBlockFor, {
        workspaceId,
        category,
      });
      if (walletBlock) return walletBlock;

      const format = parsed.header?.format;
      const link = values["header:media"];
      const headerText =
        format === "TEXT"
          ? (parsed.header?.text ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, variable: string) =>
              values[`header:${variable}`] ?? ""
            )
          : undefined;
      return {
        kind: "template",
        templateName: row.name,
        languageCode: row.language,
        components: templateComponents(parsed, values),
        category,
        preview: templatePreview(parsed, values),
        ...(link && (format === "IMAGE" || format === "VIDEO")
          ? { headerMedia: { type: format === "IMAGE" ? "image" : "video", link } }
          : {}),
        headerText: trimmed(headerText),
        footer: parsed.footer,
        buttons: parsed.buttons.map((button) => ({
          type: button.type === "URL" ? "url" : button.type === "PHONE_NUMBER" ? "phone" : "quick_reply",
          text: button.text,
        })),
      };
    }
  }
}

/**
 * Anything WhatsApp carries besides prose, sent by hand from the inbox. Lands
 * on the thread as a rich message from the team, and takes the thread over
 * the way a typed reply does.
 */
export const sendManualRich = action({
  args: {
    conversationId: v.id("conversations"),
    message: composedMessage,
    teamMemberId: v.optional(v.id("teamMembers")),
    pauseMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const context = await ctx.runQuery(internal.conversations.manualSendContext, {
      conversationId: args.conversationId,
    });
    if (!context) return { ok: false, error: "This conversation is no longer available." };
    if (context.channelType !== "whatsapp" || !context.channelId || !context.externalId) {
      return { ok: false, error: "These messages can only go out on a WhatsApp thread." };
    }

    const outbound = await toOutbound(ctx, args.message, context.workspaceId, context.channelId);
    if (typeof outbound === "string") return { ok: false, error: outbound };

    const result = await sendOnChannel(ctx, "whatsapp", {
      channelId: context.channelId,
      to: context.externalId,
      message: outbound,
      source: "human",
      conversationId: args.conversationId,
    });
    if (!result.ok) {
      return { ok: false, error: friendlySendError("whatsapp", result.error) };
    }

    // The raw components are Meta's, not the transcript's.
    const shown = outbound.kind === "template" ? { ...outbound, components: undefined } : outbound;
    await ctx.runMutation(internal.conversations.recordManualReply, {
      workspaceId: context.workspaceId,
      conversationId: args.conversationId,
      agentId: context.agentId,
      text: summarise(outbound),
      payload: JSON.stringify(shown),
      teamMemberId: context.memberId ?? args.teamMemberId,
      pauseMinutes: args.pauseMinutes,
      sent: { wamid: result.wamid },
    });
    return { ok: true };
  },
});
