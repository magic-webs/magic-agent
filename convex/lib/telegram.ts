import type { Outbound } from "./whatsappSend";
import type { MediaKind } from "./whatsappMedia";

export const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const CALLBACK_DATA_BYTES = 64;

type Json = Record<string, unknown>;
export type TelegramRequest = { method: string; body: Json };

export function botUrl(botToken: string, method: string): string {
  return `${TELEGRAM_API}/bot${botToken}/${method}`;
}

export function fileUrl(botToken: string, filePath: string): string {
  return `${TELEGRAM_API}/file/bot${botToken}/${filePath}`;
}

function callbackData(id: string): string {
  let data = id.trim();
  while (new TextEncoder().encode(data).length > CALLBACK_DATA_BYTES) {
    data = data.slice(0, -1);
  }
  return data || "_";
}

function keyboard(options: Array<{ id: string; title: string }>): Json {
  return {
    inline_keyboard: options.map((option) => [
      { text: option.title.trim(), callback_data: callbackData(option.id) },
    ]),
  };
}

function withFooter(body: string, footer?: string): string {
  return footer?.trim() ? `${body}\n\n${footer.trim()}` : body;
}

const MEDIA_METHOD: Record<MediaKind, { method: string; field: string }> = {
  image: { method: "sendPhoto", field: "photo" },
  video: { method: "sendVideo", field: "video" },
  audio: { method: "sendAudio", field: "audio" },
  document: { method: "sendDocument", field: "document" },
  sticker: { method: "sendSticker", field: "sticker" },
};

/** One message with a keyboard, under a photo or video header when there is one. */
function keyed(
  chatId: string,
  text: string,
  markup: Json,
  header?: Extract<Outbound, { kind: "buttons" }>["header"]
): TelegramRequest[] {
  if (
    header &&
    (header.type === "image" || header.type === "video") &&
    "link" in header.media &&
    text.length <= CAPTION_LIMIT
  ) {
    const { method, field } = MEDIA_METHOD[header.type];
    return [
      {
        method,
        body: { chat_id: chatId, [field]: header.media.link, caption: text, reply_markup: markup },
      },
    ];
  }
  const title = header?.type === "text" ? `${header.text.trim()}\n\n` : "";
  return [
    {
      method: "sendMessage",
      body: {
        chat_id: chatId,
        text: `${title}${text}`.slice(0, TELEGRAM_TEXT_LIMIT),
        reply_markup: markup,
      },
    },
  ];
}

/**
 * The Bot API calls that carry an outbound, or null when Telegram has nothing
 * that can — the caller tells the model to write it out as text.
 */
export function telegramRequests(chatId: string, message: Outbound): TelegramRequest[] | null {
  switch (message.kind) {
    case "text":
      return splitForTelegram(message.body).map((text) => ({
        method: "sendMessage",
        body: { chat_id: chatId, text },
      }));
    case "media": {
      if (!("link" in message.source)) return null;
      const { method, field } = MEDIA_METHOD[message.media];
      const caption = message.caption?.trim().slice(0, CAPTION_LIMIT);
      return [
        {
          method,
          body: {
            chat_id: chatId,
            [field]: message.source.link,
            ...(caption && message.media !== "sticker" ? { caption } : {}),
          },
        },
      ];
    }
    case "buttons":
      return keyed(
        chatId,
        withFooter(message.body, message.footer),
        keyboard(message.buttons),
        message.header
      );
    case "list": {
      const rows = message.sections.flatMap((section) => section.rows);
      if (rows.length === 0) return null;
      return keyed(chatId, withFooter(message.body, message.footer), keyboard(rows), message.header);
    }
    case "cta_url":
      return keyed(
        chatId,
        withFooter(message.body, message.footer),
        { inline_keyboard: [[{ text: message.displayText.trim(), url: message.url }]] },
        message.header
      );
    case "location":
      if (message.name || message.address) {
        return [
          {
            method: "sendVenue",
            body: {
              chat_id: chatId,
              latitude: message.latitude,
              longitude: message.longitude,
              title: message.name || "Location",
              address: message.address || "",
            },
          },
        ];
      }
      return [
        {
          method: "sendLocation",
          body: { chat_id: chatId, latitude: message.latitude, longitude: message.longitude },
        },
      ];
    case "request_location":
      return [
        {
          method: "sendMessage",
          body: {
            chat_id: chatId,
            text: message.body.slice(0, TELEGRAM_TEXT_LIMIT),
            reply_markup: {
              keyboard: [[{ text: "📍 Share my location", request_location: true }]],
              one_time_keyboard: true,
              resize_keyboard: true,
            },
          },
        },
      ];
    case "contacts": {
      const requests = message.contacts.flatMap((card) => {
        const phone = card.phones?.[0]?.phone;
        if (!phone) return [];
        return [
          {
            method: "sendContact",
            body: {
              chat_id: chatId,
              phone_number: phone,
              first_name: card.firstName || card.formattedName,
              ...(card.lastName ? { last_name: card.lastName } : {}),
            },
          },
        ];
      });
      return requests.length > 0 ? requests : null;
    }
    default:
      return null;
  }
}

export function splitForTelegram(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > TELEGRAM_TEXT_LIMIT) {
    const window = remaining.slice(0, TELEGRAM_TEXT_LIMIT);
    let cut = window.lastIndexOf("\n\n");
    if (cut < TELEGRAM_TEXT_LIMIT * 0.5) cut = window.lastIndexOf(". ") + 1;
    if (cut < TELEGRAM_TEXT_LIMIT * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = TELEGRAM_TEXT_LIMIT;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramFile = { file_id?: string; file_size?: number; mime_type?: string; file_name?: string };

type TelegramMessage = {
  message_id?: number;
  from?: TelegramUser;
  chat?: { id?: number; type?: string };
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
  video?: TelegramFile;
  voice?: TelegramFile;
  audio?: TelegramFile;
  document?: TelegramFile;
  sticker?: TelegramFile & { emoji?: string };
  location?: { latitude?: number; longitude?: number };
  venue?: { title?: string; address?: string; location?: { latitude?: number; longitude?: number } };
  contact?: { phone_number?: string; first_name?: string; last_name?: string };
  reply_markup?: { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> };
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: {
    id?: string;
    from?: TelegramUser;
    data?: string;
    message?: TelegramMessage;
  };
};

export type TelegramInbound = {
  updateId: string;
  chatId: string;
  messageId?: string;
  callbackId?: string;
  contactName?: string;
  contactPhone?: string;
  text: string;
  preview: string;
  payload?: Outbound;
  media?: {
    kind: MediaKind;
    fileId: string;
    mimeType?: string;
    caption?: string;
    filename?: string;
    noun: string;
  };
};

const MEDIA_LABEL: Record<MediaKind, { noun: string; icon: string; title: string }> = {
  image: { noun: "a photo", icon: "📷", title: "Photo" },
  video: { noun: "a video", icon: "🎥", title: "Video" },
  audio: { noun: "an audio message", icon: "🎤", title: "Voice note" },
  document: { noun: "a document", icon: "📄", title: "Document" },
  sticker: { noun: "a sticker", icon: "", title: "Sticker" },
};

function nameOf(user: TelegramUser | undefined): string | undefined {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return name || (user?.username ? `@${user.username}` : undefined);
}

/** A private chat's update, read into what the engine takes; null for anything else. */
export function parseUpdate(update: TelegramUpdate): TelegramInbound | null {
  if (update.update_id === undefined) return null;
  const updateId = String(update.update_id);

  const callback = update.callback_query;
  if (callback) {
    const chatId = callback.message?.chat?.id;
    if (chatId === undefined || callback.message?.chat?.type !== "private") return null;
    const pressed = callback.message?.reply_markup?.inline_keyboard
      ?.flat()
      .find((button) => button.callback_data === callback.data)?.text;
    const text = (pressed ?? callback.data ?? "").trim();
    if (!text) return null;
    return {
      updateId,
      chatId: String(chatId),
      callbackId: callback.id,
      contactName: nameOf(callback.from),
      text,
      preview: text,
    };
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (!message || chatId === undefined || message.chat?.type !== "private") return null;
  if (message.from?.is_bot) return null;

  const base = {
    updateId,
    chatId: String(chatId),
    messageId: message.message_id === undefined ? undefined : String(message.message_id),
    contactName: nameOf(message.from),
  };

  if (message.text?.trim()) {
    const text = /^\/start\b/.test(message.text.trim()) ? "Hi" : message.text.trim();
    return { ...base, text, preview: text };
  }

  const contact = message.contact;
  if (contact?.phone_number) {
    const who = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    return {
      ...base,
      contactPhone: contact.phone_number.replace(/[^\d]/g, ""),
      text: `(shared a contact: ${[who, contact.phone_number].filter(Boolean).join(", ")})`,
      preview: `👤 ${who || contact.phone_number}`,
    };
  }

  const point = message.venue?.location ?? message.location;
  if (point?.latitude !== undefined && point.longitude !== undefined) {
    const place = [message.venue?.title, message.venue?.address].filter(Boolean).join(", ");
    return {
      ...base,
      text: `(shared a location${place ? `: ${place}` : ""} — ${point.latitude}, ${point.longitude})`,
      preview: `📍 ${place || "Location"}`,
      payload: {
        kind: "location",
        latitude: point.latitude,
        longitude: point.longitude,
        ...(message.venue?.title ? { name: message.venue.title } : {}),
        ...(message.venue?.address ? { address: message.venue.address } : {}),
      },
    };
  }

  const found: Array<[MediaKind, TelegramFile | undefined]> = [
    ["image", message.photo?.at(-1)],
    ["video", message.video],
    ["audio", message.voice ?? message.audio],
    ["document", message.document],
    ["sticker", message.sticker],
  ];
  const hit = found.find(([, file]) => file?.file_id);
  if (!hit) return null;
  const [kind, file] = hit;
  const label = MEDIA_LABEL[kind];
  const caption = message.caption?.trim() || undefined;
  const filename = file?.file_name?.trim() || undefined;
  const noun = `${label.noun}${kind === "document" && filename ? `: ${filename}` : ""}`;
  const title = kind === "document" && filename ? filename : label.title;
  return {
    ...base,
    text: caption ? `(sent ${noun})\n${caption}` : `(sent ${noun})`,
    preview: [label.icon, caption || title].filter(Boolean).join(" "),
    media: {
      kind,
      fileId: file!.file_id!,
      noun,
      ...(file?.mime_type ? { mimeType: file.mime_type } : {}),
      ...(caption ? { caption } : {}),
      ...(filename ? { filename } : {}),
    },
  };
}
