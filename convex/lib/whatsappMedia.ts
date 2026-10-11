import type { ContactCard, Outbound } from "./whatsappSend";

type WhatsAppConfig = {
  apiBaseUrl: string;
  apiVersion: string;
  accessToken: string;
};

type MediaObject = {
  id?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
  voice?: boolean;
};

type InboundContact = {
  name?: {
    formatted_name?: string;
    first_name?: string;
    last_name?: string;
    middle_name?: string;
  };
  phones?: Array<{ phone?: string; wa_id?: string; type?: string }>;
  emails?: Array<{ email?: string; type?: string }>;
  org?: { company?: string; department?: string; title?: string };
  urls?: Array<{ url?: string; type?: string }>;
};

export type InboundMessage = {
  type?: string;
  from?: string;
  id?: string;
  context?: { id?: string };
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
    nfm_reply?: { response_json?: string };
  };
  image?: MediaObject;
  video?: MediaObject;
  audio?: MediaObject;
  voice?: MediaObject;
  document?: MediaObject;
  sticker?: MediaObject;
  location?: {
    latitude?: number | string;
    longitude?: number | string;
    name?: string;
    address?: string;
  };
  contacts?: InboundContact[];
  reaction?: { message_id?: string; emoji?: string };
  order?: {
    text?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number | string;
      item_price?: number | string;
      currency?: string;
    }>;
  };
};

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

export type ParsedInbound =
  | { kind: "reaction"; targetWamid: string; emoji?: string }
  | { kind: "unsupported" }
  | {
      kind: "message";
      /** What the model reads, and what history replays. */
      text: string;
      preview: string;
      payload?: Outbound;
      media?: {
        kind: MediaKind;
        id: string;
        mimeType?: string;
        caption?: string;
        filename?: string;
        /** "a photo", "a document: menu.pdf" — what the line to the model names. */
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

function contactCard(contact: InboundContact): ContactCard {
  const name = contact.name;
  const formattedName =
    name?.formatted_name ||
    [name?.first_name, name?.last_name].filter(Boolean).join(" ") ||
    contact.phones?.[0]?.phone ||
    "Contact";
  return {
    formattedName,
    ...(name?.first_name ? { firstName: name.first_name } : {}),
    ...(name?.last_name ? { lastName: name.last_name } : {}),
    ...(contact.phones?.length
      ? {
          phones: contact.phones.flatMap((p) =>
            p.phone ? [{ phone: p.phone, type: p.type, waId: p.wa_id }] : []
          ),
        }
      : {}),
    ...(contact.emails?.length
      ? {
          emails: contact.emails.flatMap((e) =>
            e.email ? [{ email: e.email, type: e.type }] : []
          ),
        }
      : {}),
    ...(contact.org ? { org: contact.org } : {}),
    ...(contact.urls?.length
      ? { urls: contact.urls.flatMap((u) => (u.url ? [{ url: u.url, type: u.type }] : [])) }
      : {}),
  };
}

export function withCaption(line: string, caption?: string): string {
  return caption?.trim() ? `${line}\n${caption.trim()}` : line;
}

/**
 * Reads every inbound message type WhatsApp delivers. Media is left as an id:
 * the link is signed by the caller, which holds the channel's token.
 */
export function parseInbound(message: InboundMessage): ParsedInbound {
  switch (message.type) {
    case "text": {
      const body = message.text?.body ?? "";
      return body.trim()
        ? { kind: "message", text: body, preview: body }
        : { kind: "unsupported" };
    }
    case "button": {
      const text = message.button?.text ?? "";
      return text ? { kind: "message", text, preview: text } : { kind: "unsupported" };
    }
    case "interactive": {
      const interactive = message.interactive;
      const text =
        interactive?.button_reply?.title ??
        interactive?.list_reply?.title ??
        interactive?.nfm_reply?.response_json ??
        "";
      return text ? { kind: "message", text, preview: text } : { kind: "unsupported" };
    }
    case "reaction": {
      const target = message.reaction?.message_id;
      if (!target) return { kind: "unsupported" };
      return {
        kind: "reaction",
        targetWamid: target,
        ...(message.reaction?.emoji ? { emoji: message.reaction.emoji } : {}),
      };
    }
    case "image":
    case "video":
    case "audio":
    case "voice":
    case "document":
    case "sticker": {
      const kind: MediaKind = message.type === "voice" ? "audio" : message.type;
      const media = message[message.type];
      if (!media?.id) return { kind: "unsupported" };
      const label = MEDIA_LABEL[kind];
      const caption = media.caption?.trim();
      const filename = media.filename?.trim();
      const title = kind === "document" && filename ? filename : label.title;
      const noun = `${label.noun}${kind === "document" && filename ? `: ${filename}` : ""}`;
      return {
        kind: "message",
        text: withCaption(`(sent ${noun})`, caption),
        preview: [label.icon, caption || title].filter(Boolean).join(" "),
        media: {
          kind,
          id: media.id,
          noun,
          ...(media.mime_type ? { mimeType: media.mime_type } : {}),
          ...(caption ? { caption } : {}),
          ...(filename ? { filename } : {}),
        },
      };
    }
    case "location": {
      const location = message.location;
      const latitude = Number(location?.latitude);
      const longitude = Number(location?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return { kind: "unsupported" };
      }
      const place = [location?.name, location?.address].filter(Boolean).join(", ");
      return {
        kind: "message",
        text: `(shared a location${place ? `: ${place}` : ""} — ${latitude}, ${longitude})`,
        preview: `📍 ${place || "Location"}`,
        payload: {
          kind: "location",
          latitude,
          longitude,
          ...(location?.name ? { name: location.name } : {}),
          ...(location?.address ? { address: location.address } : {}),
        },
      };
    }
    case "contacts": {
      const cards = (message.contacts ?? []).map(contactCard);
      if (cards.length === 0) return { kind: "unsupported" };
      const described = cards
        .map((card) =>
          [card.formattedName, ...(card.phones ?? []).map((p) => p.phone)].join(" ")
        )
        .join("; ");
      return {
        kind: "message",
        text: `(shared a contact card: ${described})`,
        preview: `👤 ${cards.map((card) => card.formattedName).join(", ")}`,
        payload: { kind: "contacts", contacts: cards },
      };
    }
    case "order": {
      const items = message.order?.product_items ?? [];
      const lines = items.map(
        (item) =>
          `${item.quantity ?? 1} × ${item.product_retailer_id ?? "item"}${
            item.item_price !== undefined
              ? ` at ${item.item_price}${item.currency ? ` ${item.currency}` : ""}`
              : ""
          }`
      );
      const text = withCaption(
        `(placed an order from the catalogue: ${lines.join("; ") || "no items"})`,
        message.order?.text
      );
      return { kind: "message", text, preview: `🛒 Order · ${items.length} item(s)` };
    }
    default:
      return { kind: "unsupported" };
  }
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signMedia(
  accessToken: string,
  channelId: string,
  mediaId: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(accessToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${channelId}:${mediaId}`)
  );
  return base64Url(signature).slice(0, 32);
}

/**
 * A link that streams the file through Convex on every view, so nothing is
 * stored and the channel's token never reaches the browser.
 */
export async function mediaLink(
  accessToken: string,
  channelId: string,
  mediaId: string
): Promise<string> {
  const site = process.env.CONVEX_SITE_URL ?? "";
  const sig = await signMedia(accessToken, channelId, mediaId);
  return `${site}/whatsapp-media/${channelId}/${encodeURIComponent(mediaId)}?sig=${sig}`;
}

async function getMedia(url: string, accessToken: string): Promise<Response> {
  return await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
}

/**
 * The media file itself. 1Automations documents the media path without the
 * `/api/meta` prefix its messages path carries, so both are tried.
 */
export async function fetchMedia(
  config: WhatsAppConfig,
  mediaId: string
): Promise<{ response: Response; mimeType: string }> {
  const base = config.apiBaseUrl.replace(/\/$/, "");
  const bases = [base, base.replace(/\/api\/meta$/, "")].filter(
    (value, index, all) => all.indexOf(value) === index
  );

  let metaResponse: Response | null = null;
  for (const candidate of bases) {
    metaResponse = await getMedia(
      `${candidate}/${config.apiVersion}/${encodeURIComponent(mediaId)}`,
      config.accessToken
    );
    if (metaResponse.ok) break;
  }
  if (!metaResponse?.ok) {
    throw new Error(`Could not read media metadata: HTTP ${metaResponse?.status}`);
  }

  const contentType = metaResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      response: metaResponse,
      mimeType: contentType.split(";")[0].trim() || "application/octet-stream",
    };
  }

  const meta = (await metaResponse.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("Media metadata did not include a URL");

  const binary = await getMedia(meta.url, config.accessToken);
  if (!binary.ok) throw new Error(`Could not download media: HTTP ${binary.status}`);
  return {
    response: binary,
    mimeType:
      meta.mime_type ??
      binary.headers.get("content-type")?.split(";")[0].trim() ??
      "application/octet-stream",
  };
}
