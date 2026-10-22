// Applying the marketing desk's templates to Meta, through the WhatsApp panel
// the sending number is connected through, and following Meta's review.
//
//   owner saves "Diwali wishes" and presses Apply
//     -> apply posts it to {panel}/{version}/{waba}/message_templates in the
//        numbered form Meta reads, with a sample for every variable
//     -> Meta answers PENDING; the template waits, and nothing sends on it
//     -> the review sweep (convex/crons.ts) reads the panel's template list
//        every half hour until Meta decides, and "Check status" does the same
//        on demand
//     -> APPROVED, and it sends; REJECTED, and the reason is shown
//
// A template already approved and then edited is applied again as an edit to
// the same Meta template, not a second one beside it.
//
// fetch only, so the default runtime.

import { ConvexError, v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  exampleValues,
  metaBody,
  metaNameFor,
  templateProblems,
} from "./lib/marketing";
import {
  channelHeaders,
  discoverWaba,
  errorText,
  listTemplates,
  panelRoot,
  providerError,
  request,
  type Json,
  type PanelConfig,
  type PanelTemplate,
} from "./lib/panel";
import {
  HEADER_MEDIA_TYPES,
  metaParts,
  partsProblems,
  type HeaderMedia,
  type TemplateButton,
} from "./lib/templateParts";
import { fileUrl, newFileKey, r2 } from "./lib/files";

const NO_PANEL = "Connect a WhatsApp number under Channels first — templates are applied through it.";
const NO_WABA =
  "The WhatsApp channel has no WABA ID. Add it on the channel under Channels, then apply again.";

const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * The sample Meta reviews a media header against: a handle from Meta's
 * resumable upload, which the panel serves at `uploads` and `uploads/{id}`.
 * Meta refuses a template whose sample is a plain link, so a failed upload
 * stops the apply with its reason rather than sending one.
 */
async function mediaHandle(panel: PanelConfig, media: HeaderMedia): Promise<string> {
  const failed = (why: string) =>
    new ConvexError(`The header ${media.type} could not be sent to Meta for review — ${why}`);
  try {
    const file = await fetch(fileUrl(media.key));
    if (!file.ok) throw failed(`the file could not be read (HTTP ${file.status})`);
    const bytes = await file.arrayBuffer();
    const session = await request(
      `${panelRoot(panel)}/uploads?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(media.mimeType)}`,
      { method: "POST", headers: channelHeaders(panel) }
    );
    const id = ((session.body ?? {}) as Json).id;
    if (!session.ok || typeof id !== "string") {
      throw failed(providerError(session.status, session.body, session.text));
    }
    const upload = await request(
      `${panelRoot(panel)}/uploads/${id}`,
      {
        method: "POST",
        headers: {
          ...channelHeaders(panel),
          Authorization: `OAuth ${panel.accessToken}`,
          "Content-Type": media.mimeType,
          "file-offset": "0",
        },
        body: bytes,
      },
      UPLOAD_TIMEOUT_MS
    );
    const handle = ((upload.body ?? {}) as Json).h;
    if (!upload.ok || typeof handle !== "string") {
      throw failed(providerError(upload.status, upload.body, upload.text));
    }
    return handle;
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw failed(errorText(error));
  }
}

/** A language code Meta and the panel may write differently: "en_US" is "en-US". */
const sameLanguage = (a: string, b: string) =>
  a.toLowerCase().replace("-", "_") === b.toLowerCase().replace("-", "_");

export const apply = action({
  args: { templateId: v.id("marketingTemplates") },
  handler: async (ctx, args): Promise<{ status: string; name: string }> => {
    const { template, business, panel } = await ctx.runQuery(
      internal.marketing.applyContext,
      { templateId: args.templateId }
    );
    if (!panel) throw new ConvexError(NO_PANEL);
    if (template.metaStatus === "PENDING") {
      throw new ConvexError("Meta is still reviewing it. Apply again once it has decided.");
    }
    const problems = [...templateProblems(template.body), ...partsProblems(template)];
    if (problems.length > 0) throw new ConvexError(problems[0]);

    const text = metaBody(template.body);
    const samples = exampleValues(template.body, business, template.occasion);
    const body: Json = {
      type: "BODY",
      text,
      ...(samples.length ? { example: { body_text: [samples] } } : {}),
    };
    const parts: Json[] = metaParts(
      template,
      template.headerMedia ? await mediaHandle(panel, template.headerMedia) : undefined
    );
    const components = [
      ...parts.filter((part) => part.type === "HEADER"),
      body,
      ...parts.filter((part) => part.type !== "HEADER"),
    ];
    const category = (template.category ?? "marketing").toUpperCase();
    // The name it already goes by, when it has one: Meta keys a template on
    // its name and language, and an edit keeps both.
    const name = template.metaTemplateName ?? metaNameFor(template.name);

    let url: string;
    let payload: Json;
    if (template.metaTemplateId) {
      url = `${panelRoot(panel)}/${template.metaTemplateId}`;
      payload = { category, components };
    } else {
      const wabaId = panel.wabaId ?? (await discoverWaba(panel));
      if (!wabaId) throw new ConvexError(NO_WABA);
      url = `${panelRoot(panel)}/${wabaId}/message_templates`;
      payload = { name, category, language: template.languageCode, components };
    }

    let response;
    try {
      response = await request(url, {
        method: "POST",
        headers: channelHeaders(panel),
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new ConvexError(`Could not reach the WhatsApp panel: ${errorText(error)}`);
    }
    if (!response.ok) {
      throw new ConvexError(
        `Meta did not accept it — ${providerError(response.status, response.body, response.text)}`
      );
    }

    // Meta answers a new template with its id, status and category; an edit
    // with `success` alone, which means it has gone back into review.
    const answer = ((response.body ?? {}) as Json) ?? {};
    const inner = ((answer.data as Json | undefined) ?? answer) as Json;
    // The panel can answer 200 without creating anything; a new template
    // that Meta took always comes back with its id.
    if (!template.metaTemplateId && inner.id === undefined) {
      throw new ConvexError(
        `Meta did not create it — ${providerError(response.status, response.body, response.text)}`
      );
    }
    const status = typeof inner.status === "string" ? inner.status : "PENDING";
    await ctx.runMutation(internal.marketing.recordApplied, {
      templateId: template._id,
      metaTemplateName: name,
      metaTemplateId: inner.id !== undefined ? String(inner.id) : undefined,
      status,
      category: typeof inner.category === "string" ? inner.category : undefined,
    });
    return { status: status.toUpperCase(), name };
  },
});

type LinkedTemplate = {
  templateId: Id<"marketingTemplates">;
  metaTemplateName: string;
  languageCode: string;
  metaStatus: string | null;
  appliedAt: number | null;
};

/** Long enough for Meta's list to show a template it has just been sent. */
const LISTING_GRACE_MS = 15 * 60 * 1000;

const linkedTo = (row: PanelTemplate, templates: LinkedTemplate[]) =>
  templates.find(
    (template) =>
      row.name === template.metaTemplateName &&
      sameLanguage(row.language, template.languageCode)
  );

async function listPanel(panel: PanelConfig & { wabaId?: string | null }) {
  const wabaId = panel.wabaId ?? (await discoverWaba(panel));
  if (!wabaId) throw new ConvexError(NO_WABA);
  const listed = await listTemplates(panel, wabaId);
  if (!listed.ok) throw new ConvexError(listed.error);
  return listed.templates;
}

async function recordReviews(
  ctx: ActionCtx,
  templates: LinkedTemplate[],
  listed: PanelTemplate[]
): Promise<number> {
  const now = Date.now();
  const rows = templates.flatMap((template) => {
    const found = listed.find(
      (row) =>
        row.name === template.metaTemplateName &&
        sameLanguage(row.language, template.languageCode)
    );
    if (found) {
      return [
        {
          templateId: template.templateId,
          status: found.status,
          metaTemplateId: found.providerId,
          reason: found.rejectedReason,
          category: found.category,
        },
      ];
    }
    // Waiting on a review Meta has no record of: it never got there, and
    // would otherwise show as in review for good.
    const waiting = template.metaStatus === "PENDING" || template.metaStatus === "IN_APPEAL";
    return waiting && template.appliedAt !== null && now - template.appliedAt > LISTING_GRACE_MS
      ? [{ templateId: template.templateId, status: "MISSING" }]
      : [];
  });
  if (rows.length === 0) return 0;
  const { changed } = await ctx.runMutation(internal.marketing.recordReviews, { rows });
  return changed;
}

/**
 * Reads the panel's template list and records where each of this
 * workspace's templates stands. Returns how many changed.
 */
async function reviewWorkspace(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">
): Promise<number> {
  const context = await ctx.runQuery(internal.marketing.reviewContext, { workspaceId });
  if (!context.panel) throw new ConvexError(NO_PANEL);
  if (context.templates.length === 0) return 0;
  return await recordReviews(ctx, context.templates, await listPanel(context.panel));
}

const NAMED_VARIABLES = ["name", "message", "event", "date", "venue", "business"] as const;
const GONE = new Set(["DELETED", "DISABLED", "ARCHIVED", "PENDING_DELETION"]);

type Imported = {
  name: string;
  body: string;
  metaTemplateName: string;
  languageCode: string;
  category: "marketing" | "utility";
  metaStatus: string;
  metaTemplateId?: string;
  metaRejectedReason?: string;
  header?: string;
  footer?: string;
  buttons?: TemplateButton[];
  media?: { type: "image" | "video"; url: string };
};

/**
 * A template made in WhatsApp Manager, in the desk's terms — or null when it
 * needs something the desk cannot fill: named or repeated parameters, a
 * variable in the header or a button, or a kind of button it does not send.
 */
function fromPanel(row: PanelTemplate): Imported | null {
  const category = row.category.toLowerCase();
  if (category !== "marketing" && category !== "utility") return null;

  let components: Json[];
  try {
    components = JSON.parse(row.components) as Json[];
  } catch {
    return null;
  }
  const part = (type: string) =>
    components.find((c) => String(c.type ?? "").toUpperCase() === type);

  const bodyText = part("BODY")?.text;
  if (typeof bodyText !== "string" || !bodyText.trim()) return null;
  const variables = [...bodyText.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
  if (variables.length > NAMED_VARIABLES.length) return null;
  if (variables.some((value, index) => value !== String(index + 1))) return null;
  const body = bodyText.replace(
    /\{\{\s*(\d+)\s*\}\}/g,
    (_, n: string) => `{{${NAMED_VARIABLES[Number(n) - 1]}}}`
  );

  const imported: Imported = {
    name: row.name.replace(/_+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()),
    body,
    metaTemplateName: row.name,
    languageCode: row.language,
    category,
    metaStatus: row.status,
    metaTemplateId: row.providerId,
    metaRejectedReason: row.status === "REJECTED" ? row.rejectedReason : undefined,
  };

  const header = part("HEADER");
  if (header) {
    const format = String(header.format ?? "TEXT").toUpperCase();
    if (format === "TEXT") {
      const text = typeof header.text === "string" ? header.text : "";
      if (text.includes("{{")) return null;
      imported.header = text || undefined;
    } else if (format === "IMAGE" || format === "VIDEO") {
      const handles = (header.example as Json | undefined)?.header_handle;
      const url = Array.isArray(handles) ? handles[0] : undefined;
      if (typeof url !== "string") return null;
      imported.media = { type: format === "IMAGE" ? "image" : "video", url };
    } else {
      return null;
    }
  }

  const footer = part("FOOTER")?.text;
  if (typeof footer === "string") imported.footer = footer;

  const buttons = part("BUTTONS")?.buttons;
  const mapped: TemplateButton[] = [];
  for (const button of Array.isArray(buttons) ? (buttons as Json[]) : []) {
    const type = String(button.type ?? "").toUpperCase();
    const text = String(button.text ?? "");
    if (type === "QUICK_REPLY") {
      mapped.push({ type: "quick_reply", text });
    } else if (type === "URL" && typeof button.url === "string" && !button.url.includes("{{")) {
      mapped.push({ type: "url", text, url: button.url });
    } else if (type === "PHONE_NUMBER" && typeof button.phone_number === "string") {
      mapped.push({ type: "phone", text, phone: button.phone_number });
    } else {
      return null;
    }
  }
  if (mapped.length > 0) imported.buttons = mapped;
  return imported;
}

/** Copies a header sample from Meta into the workspace's own files. */
async function storeMedia(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  media: { type: "image" | "video"; url: string }
): Promise<HeaderMedia | null> {
  try {
    const response = await fetch(media.url);
    if (!response.ok) return null;
    const mimeType =
      response.headers.get("content-type")?.split(";")[0].trim() ||
      (media.type === "image" ? "image/jpeg" : "video/mp4");
    const allowed = HEADER_MEDIA_TYPES[media.type];
    if (!(allowed.mimeTypes as readonly string[]).includes(mimeType)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > allowed.maxBytes) return null;
    const key = await r2.store(ctx, bytes, {
      key: newFileKey("templates", workspaceId),
      type: mimeType,
    });
    return { type: media.type, key, mimeType };
  } catch {
    return null;
  }
}

/**
 * "Sync templates" on the Templates tab: every template in the business
 * account comes in, and the ones already here take Meta's latest standing.
 */
export const sync = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<{ total: number; imported: number; skipped: number; changed: number }> => {
    await ctx.runQuery(internal.marketing.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    const context = await ctx.runQuery(internal.marketing.reviewContext, {
      workspaceId: args.workspaceId,
    });
    if (!context.panel) throw new ConvexError(NO_PANEL);
    const listed = (await listPanel(context.panel)).filter((row) => !GONE.has(row.status));
    const changed = await recordReviews(ctx, context.templates, listed);

    const ready = [];
    let skipped = 0;
    for (const row of listed) {
      if (linkedTo(row, context.templates)) continue;
      const found = fromPanel(row);
      if (!found) {
        skipped++;
        continue;
      }
      const { media, ...template } = found;
      if (!media) {
        ready.push(template);
        continue;
      }
      const headerMedia = await storeMedia(ctx, args.workspaceId, media);
      if (!headerMedia) {
        skipped++;
        continue;
      }
      ready.push({ ...template, headerMedia });
    }

    const { imported } = ready.length
      ? await ctx.runMutation(internal.marketing.importTemplates, {
          workspaceId: args.workspaceId,
          templates: ready,
        })
      : { imported: 0 };
    return { total: listed.length, imported, skipped, changed };
  },
});

/** "Check status" on the Templates tab. */
export const checkStatus = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ changed: number }> => {
    await ctx.runQuery(internal.marketing.assertWorkspace, {
      workspaceId: args.workspaceId,
    });
    return { changed: await reviewWorkspace(ctx, args.workspaceId) };
  },
});

/** The review sweep's per-workspace call. Quiet on failure: it runs again. */
export const checkReviews = internalAction({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<null> => {
    try {
      await reviewWorkspace(ctx, args.workspaceId);
    } catch (error) {
      console.warn("[marketing] template review check failed", args.workspaceId, errorText(error));
    }
    return null;
  },
});
