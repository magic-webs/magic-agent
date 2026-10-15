/**
 * Readers for the 1Automations CRM API (`/crm/chat`, `/crm/chat/<id>/messages`).
 * Its Postman collection publishes no example responses, so each reader
 * accepts the field names that API family uses and skips what it cannot read.
 */

type Json = Record<string, unknown>;

export type CrmChat = { id: string; phone: string; name?: string };
export type CrmMessage = { id?: string; at: number; fromCustomer: boolean; text: string };

const LIST_KEYS = ["data", "chats", "contacts", "messages", "items", "results", "result", "list", "docs", "rows"];

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function pick(source: Json, keys: string[]): string | undefined {
  for (const key of keys) {
    const found = str(source[key]);
    if (found) return found;
  }
  return undefined;
}

export function listIn(body: unknown, depth = 0): Json[] {
  if (Array.isArray(body)) return body.filter(isObject);
  if (!isObject(body) || depth > 2) return [];
  for (const key of LIST_KEYS) {
    const value = body[key];
    if (Array.isArray(value)) return value.filter(isObject);
  }
  for (const key of LIST_KEYS) {
    if (isObject(body[key])) {
      const nested = listIn(body[key], depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export function readChat(row: Json): CrmChat | null {
  const id = pick(row, ["_id", "id", "chat_id", "chatId"]);
  const contact = isObject(row.contact) ? row.contact : {};
  const phone =
    pick(row, ["whatsapp", "wa_id", "waId", "phone", "phone_number", "phoneNumber", "mobile", "number", "contact_number"]) ??
    pick(contact, ["whatsapp", "wa_id", "phone", "phone_number", "mobile", "number"]);
  if (!id || !phone) return null;
  const name =
    pick(row, ["chat_name", "chatName", "name", "full_name", "display_name", "profile_name"]) ??
    pick(contact, ["name", "full_name", "profile_name"]);
  return { id, phone, name: name && name !== phone ? name : undefined };
}

function readTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    if (/^\d+(\.\d+)?$/.test(value.trim())) return readTime(Number(value));
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

const OUTGOING = new Set(["outgoing", "outbound", "out", "sent", "send", "agent", "bot", "operator", "business", "system", "api", "campaign", "template"]);
const INCOMING = new Set(["incoming", "inbound", "in", "received", "receive", "customer", "user", "contact", "client"]);

function readSide(row: Json, inner: Json, chatDigits: string): boolean | undefined {
  for (const key of ["fromMe", "from_me", "is_from_me", "isFromMe", "outgoing", "is_outgoing", "sent_by_me"]) {
    const value = row[key] ?? inner[key];
    if (typeof value === "boolean") return !value;
    if (value === 1 || value === "1" || value === "true") return false;
    if (value === 0 || value === "0" || value === "false") return true;
  }
  for (const key of ["direction", "message_direction", "flow", "sender_type", "senderType", "author_type", "sent_by", "source", "type_of_message"]) {
    const value = str(row[key] ?? inner[key])?.toLowerCase();
    if (!value) continue;
    if (INCOMING.has(value)) return true;
    if (OUTGOING.has(value)) return false;
  }
  const digits = (value: unknown) => str(value)?.replace(/\D/g, "");
  const from = digits(row.from ?? inner.from ?? row.sender);
  if (from) return from.endsWith(chatDigits.slice(-10));
  const to = digits(row.to ?? inner.to ?? row.recipient);
  if (to) return !to.endsWith(chatDigits.slice(-10));
  return undefined;
}

function mediaText(type: string, media: Json): string {
  const caption = pick(media, ["caption", "filename", "name"]);
  const link = pick(media, ["link", "url", "media_url", "mediaUrl"]);
  return [`[${type}]`, caption, link].filter(Boolean).join(" ");
}

function readText(row: Json, inner: Json): string | undefined {
  const type = (pick(inner, ["type", "message_type", "messageType"]) ?? pick(row, ["type", "message_type", "messageType"]) ?? "text").toLowerCase();
  const sources = [inner, row];
  for (const source of sources) {
    const text = source.text;
    if (isObject(text) && str(text.body)) return str(text.body);
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  for (const source of sources) {
    const body = pick(source, ["body", "content", "message_text", "messageText", "caption"]);
    if (body) return body;
    if (typeof source.message === "string" && source.message.trim()) return source.message.trim();
  }
  if (type !== "text") {
    for (const source of sources) {
      const media = source[type];
      if (isObject(media)) return mediaText(type, media);
    }
    for (const source of sources) {
      const link = pick(source, ["media_url", "mediaUrl", "url", "link", "file_url"]);
      if (link) return `[${type}] ${link}`;
    }
    return `[${type}]`;
  }
  return undefined;
}

export function readMessage(row: Json, chatPhone: string): CrmMessage | null {
  const inner = isObject(row.message) ? row.message : isObject(row.data) ? row.data : row;
  const at =
    readTime(row.created_at ?? row.createdAt ?? row.timestamp ?? row.time ?? row.sent_at ?? row.date ?? row.updated_at) ??
    readTime(inner.timestamp ?? inner.created_at ?? inner.createdAt);
  const text = readText(row, inner);
  if (!at || !text) return null;
  const fromCustomer = readSide(row, inner, chatPhone.replace(/\D/g, "")) ?? true;
  const id = pick(row, ["_id", "id", "message_id", "messageId", "wamid"]) ?? pick(inner, ["id", "wamid"]);
  return { id, at: Math.round(at), fromCustomer, text: text.slice(0, 4000) };
}

export function normaliseBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/crm$/, "")}`;
  } catch {
    return null;
  }
}
