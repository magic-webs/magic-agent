import { escapeHtml } from "./notifications";

const CATEGORY_LABEL = {
  update: "Product update",
  feature: "New feature",
  offer: "Offer",
  notice: "Service notice",
} as const;

export type BroadcastCategory = keyof typeof CATEGORY_LABEL;

export function categoryLabel(category: BroadcastCategory): string {
  return CATEGORY_LABEL[category];
}

function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#27272a">${escapeHtml(block).replace(/\r?\n/g, "<br>")}</p>`
    )
    .join("");
}

const BLOCKED_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const BLOCKED_TAGS = /<\/?(script|style|iframe|object|embed|noscript|template|svg|math|form|input|button|textarea|select|link|meta|base|frame|frameset|html|head|body|title)\b[^>]*>/gi;

/**
 * Markup an admin wrote, made safe to drop into the layout: a pasted full
 * document keeps only its body, and scripts, frames, forms, event handlers and
 * script URLs go.
 */
export function sanitizeEmailHtml(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(BLOCKED_WITH_CONTENT, "")
    .replace(BLOCKED_TAGS, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s(href|src|action|formaction|background)\s*=\s*(["']?)\s*(javascript|vbscript|data(?!:image\/(?:png|jpe?g|gif|webp);))[^"'\s>]*\2/gi,
      ' $1="#"'
    )
    .trim();
}

export function textToEmailHtml(text: string): string {
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\r?\n/g, "<br>")}</p>`)
    .join("\n");
}

export function safeLink(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function broadcastEmailHtml(message: {
  category: BroadcastCategory;
  heading: string;
  body: string;
  /** Replaces the text body with the admin's own markup. */
  bodyHtml?: string;
  imageUrl?: string;
  link?: string;
  linkLabel?: string;
  unsubscribeUrl?: string;
  brand: string;
}): string {
  const link = safeLink(message.link);
  const image = message.imageUrl
    ? `<img src="${escapeHtml(message.imageUrl)}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:8px;margin:0 0 20px">`
    : "";
  const button = link
    ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#0c7d3e;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px">${escapeHtml(message.linkLabel?.trim() || "Learn more")}</a>`
    : "";
  const unsubscribe = message.unsubscribeUrl
    ? ` · <a href="${escapeHtml(message.unsubscribeUrl)}" style="color:#71717a">Unsubscribe from offers</a>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
<tr><td style="padding:28px 20px 8px">
<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#0c7d3e">${escapeHtml(categoryLabel(message.category))}</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#18181b">${escapeHtml(message.heading)}</h1>
${image}${message.bodyHtml ? `<div style="font-size:15px;line-height:1.6;color:#27272a">${sanitizeEmailHtml(message.bodyHtml)}</div>` : paragraphs(message.body)}${button ? `<p style="margin:8px 0 12px">${button}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 20px 24px;border-top:1px solid #f4f4f5">
<p style="margin:0;font-size:12px;line-height:1.5;color:#71717a">You are receiving this because your business uses ${escapeHtml(message.brand)}${unsubscribe}</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
