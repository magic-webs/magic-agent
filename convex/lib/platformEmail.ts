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

export function signupCodeEmailHtml(message: {
  code: string;
  name: string;
  businessName: string;
  /** Unset when billing is off: there is no trial or credit to promise. */
  perks: { trialDays: number; bonus: string | null } | null;
  /** Where the icons are served from; without it they are left out. */
  site?: string;
  brand: string;
}): string {
  const asset = (file: string) => (message.site ? `${message.site}/images/${file}` : null);
  const icon = (file: string, size: number, style = "") => {
    const src = asset(`email/${file}`);
    return src
      ? `<img src="${escapeHtml(src)}" width="${size}" height="${size}" alt="" style="display:block;border:0;${style}">`
      : "";
  };
  const logo = asset("logo.png");
  const brand = escapeHtml(message.brand);

  const perk = (file: string, title: string, body: string) => `
<tr>
<td width="40" valign="top" style="padding:0 14px 16px 0">${icon(file, 40)}</td>
<td valign="top" style="padding:0 0 16px">
<p style="margin:2px 0 2px;font-size:15px;font-weight:600;color:#18181b">${escapeHtml(title)}</p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#52525b">${escapeHtml(body)}</p>
</td>
</tr>`;
  const perks = [
    message.perks
      ? perk("gift.png", `${message.perks.trialDays}-day free trial`, "No card needed. Choose a plan when you are ready.")
      : "",
    message.perks?.bonus
      ? perk("wallet.png", `${message.perks.bonus} in your wallet`, "Your first WhatsApp messages and AI replies are on us.")
      : "",
    perk("chats.png", "Your agent, live today", "It answers on WhatsApp, Instagram and web chat from your own prices and policies."),
  ].join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">Your code is ${message.code}. It works for 15 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e4e4e7">
<tr><td style="padding:28px 32px 0">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
${logo ? `<td style="padding-right:10px"><img src="${escapeHtml(logo)}" width="40" height="22" alt="" style="display:block;border:0"></td>` : ""}
<td style="font-size:16px;font-weight:700;color:#18181b">${brand}</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0">
${icon("envelope.png", 48, "margin:0 0 16px")}
<h1 style="margin:0 0 10px;font-size:24px;line-height:1.3;color:#18181b">Confirm your email</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46">Hi ${escapeHtml(message.name)}, enter this code to finish setting up <strong style="color:#18181b">${escapeHtml(message.businessName)}</strong> on ${brand}.</p>
</td></tr>
<tr><td style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px">
<tr><td align="center" style="padding:24px 16px 20px">
<p style="margin:0 0 12px;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:12px;color:#052e16;padding-left:12px">${message.code}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:6px">${icon("clock.png", 16)}</td>
<td style="font-size:13px;color:#166534">Expires in 15 minutes</td>
</tr></table>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:28px 32px 4px">
<p style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#0c7d3e">What is waiting for you</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${perks}
</table>
</td></tr>
<tr><td style="padding:8px 32px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border-radius:10px">
<tr>
<td width="16" valign="top" style="padding:14px 0 14px 14px">${icon("shield.png", 16)}</td>
<td style="padding:13px 14px;font-size:13px;line-height:1.5;color:#71717a">Did not ask for this? Ignore this email and nothing is created. ${brand} will never ask you for this code.</td>
</tr>
</table>
</td></tr>
</table>
<p style="margin:20px 0 0;font-size:12px;color:#a1a1aa">${brand}${message.site ? ` · <a href="${escapeHtml(message.site)}" style="color:#a1a1aa">${escapeHtml(message.site.replace(/^https?:\/\//, ""))}</a>` : ""}</p>
</td></tr>
</table>
</body></html>`;
}

export function supportEmailHtml(message: {
  reference: string;
  heading: string;
  body: string;
  link: string;
  linkLabel: string;
  brand: string;
}): string {
  const link = safeLink(message.link);
  const button = link
    ? `<p style="margin:8px 0 12px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0c7d3e;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px">${escapeHtml(message.linkLabel)}</a></p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
<tr><td style="padding:28px 20px 8px">
<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#0c7d3e">Support ${escapeHtml(message.reference)}</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#18181b">${escapeHtml(message.heading)}</h1>
${paragraphs(message.body)}${button}
</td></tr>
<tr><td style="padding:16px 20px 24px;border-top:1px solid #f4f4f5">
<p style="margin:0;font-size:12px;line-height:1.5;color:#71717a">Reply from your ${escapeHtml(message.brand)} dashboard so the whole team sees it.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
