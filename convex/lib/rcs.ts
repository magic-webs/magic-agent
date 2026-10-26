import type { HeaderSpec, Outbound } from "./whatsappSend";
import type { MediaKind } from "./whatsappMedia";

const CAP = {
  text: 3072,
  cardTitle: 100,
  cardFooter: 1024,
  buttonTitle: 25,
  buttons: 4,
} as const;

type Json = Record<string, unknown>;

export function rcsMessagesUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/messages`;
}

function label(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return (boundary > max * 0.55 ? cut.slice(0, boundary) : cut).trim();
}

/** A card's bold line holds 100 characters; anything longer runs on into the footer. */
function cardText(text: string, footer?: string): Json {
  const body = text.trim();
  const title = label(body, CAP.cardTitle);
  const rest = body.slice(title.length).trim();
  const tail = [rest, footer?.trim()].filter(Boolean).join("\n\n");
  return {
    body: { text: title },
    ...(tail ? { footer: { text: tail.slice(0, CAP.cardFooter) } } : {}),
  };
}

function cardHeader(header: HeaderSpec | undefined): Json | undefined {
  if (!header || (header.type !== "image" && header.type !== "video")) return undefined;
  if (!("link" in header.media)) return undefined;
  return { type: header.type, [header.type]: { link: header.media.link } };
}

function card(
  to: string,
  text: string,
  buttons: Json[],
  header?: HeaderSpec,
  footer?: string
): Json {
  const media = cardHeader(header);
  const title = header?.type === "text" ? `${header.text.trim()}\n` : "";
  return {
    to,
    type: "interactive",
    interactive: {
      type: "card",
      ...(media ? { header: media } : {}),
      ...cardText(`${title}${text}`, footer),
      ...(buttons.length > 0 ? { action: { buttons } } : {}),
    },
  };
}

function postback(option: { id: string; title: string }): Json {
  return {
    content_type: "postback",
    title: label(option.title, CAP.buttonTitle),
    payload: option.id,
  };
}

/**
 * The provider's message body for an outbound, or null when RCS has nothing
 * that can carry it — the caller tells the model to write it out as text.
 */
export function rcsMessages(to: string, message: Outbound): Json[] | null {
  switch (message.kind) {
    case "text":
      return splitForRcs(message.body).map((body) => ({ to, type: "text", text: { body } }));
    case "media": {
      if (!("link" in message.source) || message.media === "sticker") return null;
      const caption = message.caption?.trim();
      if (caption && (message.media === "image" || message.media === "video")) {
        return [
          {
            to,
            type: "interactive",
            interactive: {
              type: "card",
              header: { type: message.media, [message.media]: { link: message.source.link } },
              ...cardText(caption),
            },
          },
        ];
      }
      const sent: Json[] = [
        { to, type: message.media, [message.media]: { link: message.source.link } },
      ];
      if (caption) sent.push({ to, type: "text", text: { body: caption } });
      return sent;
    }
    case "buttons":
      if (message.buttons.length > CAP.buttons) return null;
      return [card(to, message.body, message.buttons.map(postback), message.header, message.footer)];
    case "list": {
      const rows = message.sections.flatMap((section) => section.rows);
      if (rows.length === 0 || rows.length > CAP.buttons) return null;
      return [card(to, message.body, rows.map(postback), message.header, message.footer)];
    }
    case "cards":
      return [
        ...splitForRcs(message.body).map((body) => ({ to, type: "text", text: { body } })),
        ...message.cards.map((item) =>
          card(
            to,
            [item.title, item.body].filter((part) => part?.trim()).join("\n"),
            item.buttons.slice(0, CAP.buttons).map(postback),
            { type: "image", media: { link: item.imageLink } }
          )
        ),
      ];
    case "cta_url":
      return [
        card(
          to,
          message.body,
          [
            {
              content_type: "web_url",
              url: message.url,
              title: label(message.displayText, CAP.buttonTitle),
              payload: "open_link",
              action: "BROWSER",
            },
          ],
          message.header,
          message.footer
        ),
      ];
    case "request_location":
      return [
        card(to, message.body, [
          { content_type: "request_location", title: "Share location", payload: "share_location" },
        ]),
      ];
    case "location": {
      const place = [message.name, message.address].filter(Boolean).join(", ");
      return [
        card(to, place || "Location", [
          {
            content_type: "share_location",
            name: message.name || "Location",
            title: "View location",
            payload: "view_location",
            location: {
              latitude: String(message.latitude),
              longitude: String(message.longitude),
            },
          },
        ]),
      ];
    }
    default:
      return null;
  }
}

export function splitForRcs(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > CAP.text) {
    const window = remaining.slice(0, CAP.text);
    let cut = window.lastIndexOf("\n\n");
    if (cut < CAP.text * 0.5) cut = window.lastIndexOf(". ") + 1;
    if (cut < CAP.text * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = CAP.text;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function rcsMessageId(body: unknown): string | undefined {
  const root = (body ?? {}) as Json;
  const data = (root.data ?? {}) as Json;
  const message = (root.message ?? {}) as Json;
  const messages = Array.isArray(root.messages) ? (root.messages[0] as Json) : undefined;
  const id =
    messages?.id ??
    message.id ??
    message.queue_id ??
    root.message_id ??
    root.messageId ??
    data.id ??
    data.message_id ??
    root.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

export type RcsInbound = {
  from: string;
  messageId?: string;
  contactName?: string;
  text: string;
  preview: string;
  payload?: Outbound;
};

const MEDIA_LABEL: Record<Exclude<MediaKind, "sticker">, { noun: string; icon: string; title: string }> = {
  image: { noun: "a photo", icon: "📷", title: "Photo" },
  video: { noun: "a video", icon: "🎥", title: "Video" },
  audio: { noun: "an audio message", icon: "🎤", title: "Voice note" },
  document: { noun: "a document", icon: "📄", title: "Document" },
};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : undefined;

/** The message object, wherever the payload keeps it. */
function messageOf(payload: Json): Json | null {
  const value = (payload.entry as Json[] | undefined)?.[0]?.changes as Json[] | undefined;
  const cloud = (value?.[0]?.value as Json | undefined)?.messages as Json[] | undefined;
  const candidates = [
    cloud?.[0],
    (payload.messages as Json[] | undefined)?.[0],
    payload.message,
    payload.data,
    payload,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const json = candidate as Json;
      if (senderOf(json, payload)) return json;
    }
  }
  return null;
}

function senderOf(message: Json, payload: Json): string | undefined {
  const user = (message.user ?? message.sender ?? {}) as Json;
  const raw =
    str(message.from) ??
    str(message.msisdn) ??
    str(message.mobile) ??
    str(message.phone) ??
    str(message.senderPhoneNumber) ??
    str(user.phone) ??
    str(user.id) ??
    str(typeof message.sender === "string" ? message.sender : undefined) ??
    str(payload.from) ??
    str(payload.senderPhoneNumber);
  const digits = raw?.replace(/[^\d]/g, "");
  return digits && digits.length >= 6 ? digits : undefined;
}

function mediaOf(message: Json): { kind: Exclude<MediaKind, "sticker">; link: string; caption?: string; filename?: string } | null {
  for (const kind of ["image", "video", "audio", "document"] as const) {
    const media = message[kind] as Json | undefined;
    const link = str(media?.link) ?? str(media?.url);
    if (link) {
      return { kind, link, caption: str(media?.caption), filename: str(media?.filename) };
    }
  }
  const file = (message.userFile ?? message.file) as Json | undefined;
  const payload = (file?.payload ?? file) as Json | undefined;
  const link = str(payload?.fileUri) ?? str(payload?.url) ?? str(payload?.link);
  if (!link) return null;
  const mime = str(payload?.mimeType) ?? "";
  const kind = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
        ? "audio"
        : "document";
  return { kind, link, filename: str(payload?.fileName) };
}

/**
 * The provider's inbound webhook has no published shape, so this reads the
 * Cloud-API-style one its send API mirrors, plus the plain and RBM-style
 * variants a gateway commonly forwards.
 */
export function parseRcsInbound(raw: unknown): RcsInbound | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Json;
  const message = messageOf(payload);
  if (!message) return null;
  const from = senderOf(message, payload)!;

  const text = message.text as Json | string | undefined;
  const interactive = (message.interactive ?? {}) as Json;
  const postback = (message.postback ?? interactive.postback ?? interactive.button_reply ?? message.button ?? message.suggestionResponse) as
    | Json
    | undefined;
  const changes = (payload.entry as Json[] | undefined)?.[0]?.changes as Json[] | undefined;
  const contacts = ((changes?.[0]?.value as Json | undefined)?.contacts ?? payload.contacts) as
    | Json[]
    | undefined;
  const contact = (contacts?.[0]?.profile ?? message.profile) as Json | undefined;

  const base = {
    from,
    messageId: str(message.id) ?? str(message.message_id) ?? str(message.messageId),
    contactName: str(contact?.name) ?? str(message.name) ?? str(message.senderName),
  };

  const said =
    (typeof text === "string" ? str(text) : str(text?.body)) ??
    str(postback?.title) ??
    str(postback?.text) ??
    str(postback?.payload) ??
    str(postback?.postbackData) ??
    str(message.body);
  if (said) return { ...base, text: said, preview: said };

  const location = (message.location ?? message.userLocation) as Json | undefined;
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (location && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return {
      ...base,
      text: `(shared a location — ${latitude}, ${longitude})`,
      preview: "📍 Location",
      payload: { kind: "location", latitude, longitude },
    };
  }

  const media = mediaOf(message);
  if (media) {
    const named = MEDIA_LABEL[media.kind];
    const noun = `${named.noun}${media.kind === "document" && media.filename ? `: ${media.filename}` : ""}`;
    return {
      ...base,
      text: media.caption ? `(sent ${noun}, which you cannot open)\n${media.caption}` : `(sent ${noun}, which you cannot open)`,
      preview: [named.icon, media.caption || media.filename || named.title].filter(Boolean).join(" "),
      payload: {
        kind: "media",
        media: media.kind,
        source: { link: media.link },
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.filename ? { filename: media.filename } : {}),
      },
    };
  }

  return null;
}
