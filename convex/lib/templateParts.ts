import { v, type Infer } from "convex/values";

export const templateButton = v.union(
  v.object({ type: v.literal("quick_reply"), text: v.string() }),
  v.object({ type: v.literal("url"), text: v.string(), url: v.string() }),
  v.object({ type: v.literal("phone"), text: v.string(), phone: v.string() })
);

export const headerMedia = v.object({
  type: v.union(v.literal("image"), v.literal("video")),
  key: v.string(),
  mimeType: v.string(),
});

export const templateCard = v.object({
  media: v.optional(headerMedia),
  body: v.string(),
  buttons: v.array(templateButton),
});

export type TemplateButton = Infer<typeof templateButton>;
export type HeaderMedia = Infer<typeof headerMedia>;
export type TemplateCard = Infer<typeof templateCard>;
export type TemplateParts = {
  header?: string;
  headerMedia?: HeaderMedia;
  footer?: string;
  buttons?: TemplateButton[];
};

export const HEADER_LIMIT = 60;
export const FOOTER_LIMIT = 60;
export const BUTTON_TEXT_LIMIT = 25;
export const MAX_BUTTONS = 10;
export const MAX_URL_BUTTONS = 2;
export const MAX_PHONE_BUTTONS = 1;
export const STOP_BUTTON = "Stop messages";

export const HEADER_MEDIA_TYPES = {
  image: { mimeTypes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, label: "JPG or PNG, up to 5 MB" },
  video: { mimeTypes: ["video/mp4"], maxBytes: 16 * 1024 * 1024, label: "MP4, up to 16 MB" },
} as const;

const VARIABLE = /\{\{/;

export function tidyParts(parts: TemplateParts): TemplateParts {
  const headerMedia = parts.headerMedia
    ? { type: parts.headerMedia.type, key: parts.headerMedia.key, mimeType: parts.headerMedia.mimeType }
    : undefined;
  const header = headerMedia ? undefined : parts.header?.trim() || undefined;
  const footer = parts.footer?.trim() || undefined;
  const buttons = (parts.buttons ?? [])
    .map((button) => ({ ...button, text: button.text.trim() }))
    .map((button) =>
      button.type === "url"
        ? { ...button, url: button.url.trim() }
        : button.type === "phone"
          ? { ...button, phone: button.phone.replace(/[^\d+]/g, "") }
          : button
    );
  return { header, headerMedia, footer, buttons: buttons.length > 0 ? buttons : undefined };
}

export function partsProblems(parts: TemplateParts): string[] {
  const { header, headerMedia, footer, buttons = [] } = tidyParts(parts);
  const problems: string[] = [];
  if (headerMedia) {
    const allowed = HEADER_MEDIA_TYPES[headerMedia.type];
    if (!(allowed.mimeTypes as readonly string[]).includes(headerMedia.mimeType)) {
      problems.push(`The header ${headerMedia.type} must be ${allowed.label}.`);
    }
  }
  if (header && header.length > HEADER_LIMIT) {
    problems.push(`Keep the header under ${HEADER_LIMIT} characters.`);
  }
  if (header && VARIABLE.test(header)) problems.push("The header cannot hold a variable.");
  if (footer && footer.length > FOOTER_LIMIT) {
    problems.push(`Keep the footer under ${FOOTER_LIMIT} characters.`);
  }
  if (footer && VARIABLE.test(footer)) problems.push("The footer cannot hold a variable.");
  if (buttons.length > MAX_BUTTONS) problems.push(`A template can carry at most ${MAX_BUTTONS} buttons.`);
  if (buttons.filter((button) => button.type === "url").length > MAX_URL_BUTTONS) {
    problems.push(`At most ${MAX_URL_BUTTONS} website buttons.`);
  }
  if (buttons.filter((button) => button.type === "phone").length > MAX_PHONE_BUTTONS) {
    problems.push("At most one call button.");
  }
  const labels = new Set<string>();
  for (const button of buttons) {
    if (!button.text) {
      problems.push("Every button needs a label.");
      continue;
    }
    if (button.text.length > BUTTON_TEXT_LIMIT) {
      problems.push(`“${button.text}” is too long — button labels fit ${BUTTON_TEXT_LIMIT} characters.`);
    }
    if (VARIABLE.test(button.text)) problems.push("A button label cannot hold a variable.");
    const key = button.text.toLowerCase();
    if (labels.has(key)) problems.push(`Two buttons are both called “${button.text}”.`);
    labels.add(key);
    if (button.type === "url" && !/^https:\/\/[^\s.]+\.[^\s]+$/i.test(button.url)) {
      problems.push(`“${button.text}” needs a full https:// web address.`);
    }
    if (button.type === "url" && VARIABLE.test(button.url)) {
      problems.push(`“${button.text}” cannot use a variable in its address.`);
    }
    if (button.type === "phone" && !/^\+\d{8,15}$/.test(button.phone)) {
      problems.push(`“${button.text}” needs a number with its country code, like +919876543210.`);
    }
  }
  return [...new Set(problems)];
}

/** Meta wants quick replies grouped together, so they go first and the links after. */
export function orderedButtons(buttons: TemplateButton[] = []): TemplateButton[] {
  return [
    ...buttons.filter((button) => button.type === "quick_reply"),
    ...buttons.filter((button) => button.type !== "quick_reply"),
  ];
}

export function metaParts(parts: TemplateParts, mediaHandle?: string) {
  const { header, headerMedia, footer, buttons } = tidyParts(parts);
  return [
    ...(headerMedia
      ? [
          {
            type: "HEADER",
            format: headerMedia.type.toUpperCase(),
            ...(mediaHandle ? { example: { header_handle: [mediaHandle] } } : {}),
          },
        ]
      : header
        ? [{ type: "HEADER", format: "TEXT", text: header }]
        : []),
    ...(footer ? [{ type: "FOOTER", text: footer }] : []),
    ...(buttons?.length
      ? [
          {
            type: "BUTTONS",
            buttons: orderedButtons(buttons).map((button) =>
              button.type === "url"
                ? { type: "URL", text: button.text, url: button.url }
                : button.type === "phone"
                  ? { type: "PHONE_NUMBER", text: button.text, phone_number: button.phone }
                  : { type: "QUICK_REPLY", text: button.text }
            ),
          },
        ]
      : []),
  ];
}

export function sameParts(a: TemplateParts, b: TemplateParts): boolean {
  return JSON.stringify(tidyParts(a)) === JSON.stringify(tidyParts(b));
}

export const MIN_CARDS = 2;
export const MAX_CARDS = 10;
export const CARD_BODY_LIMIT = 160;
export const MAX_CARD_BUTTONS = 2;

export function tidyCards(cards: TemplateCard[] | undefined): TemplateCard[] | undefined {
  if (!cards?.length) return undefined;
  return cards.map((card) => ({
    ...(card.media
      ? { media: { type: card.media.type, key: card.media.key, mimeType: card.media.mimeType } }
      : {}),
    body: card.body.trim(),
    buttons: tidyParts({ buttons: card.buttons }).buttons ?? [],
  }));
}

const buttonShape = (card: TemplateCard) => card.buttons.map((button) => button.type).join(",");

export function cardsProblems(cards: TemplateCard[] | undefined, parts: TemplateParts = {}): string[] {
  const tidy = tidyCards(cards);
  if (!tidy) return [];
  const problems: string[] = [];
  if (tidy.length < MIN_CARDS) problems.push(`A carousel needs at least ${MIN_CARDS} cards.`);
  if (tidy.length > MAX_CARDS) problems.push(`A carousel holds at most ${MAX_CARDS} cards.`);
  const outer = tidyParts(parts);
  if (outer.header || outer.headerMedia) problems.push("A carousel has no header of its own.");
  if (outer.footer) problems.push("A carousel has no footer.");
  if (outer.buttons?.length) problems.push("Buttons go on the cards of a carousel.");
  const mediaType = tidy.find((card) => card.media)?.media?.type;
  const shape = buttonShape(tidy[0]);
  tidy.forEach((card, index) => {
    const label = `Card ${index + 1}`;
    if (!card.media) problems.push(`${label} needs an image or video.`);
    else if (card.media.type !== mediaType) problems.push("Every card needs the same kind of media.");
    if (!card.body) problems.push(`${label} needs its text.`);
    if (card.body.length > CARD_BODY_LIMIT) {
      problems.push(`Keep the text of ${label.toLowerCase()} under ${CARD_BODY_LIMIT} characters.`);
    }
    if (VARIABLE.test(card.body)) problems.push("Card text cannot hold a variable.");
    if (card.buttons.length === 0) problems.push(`${label} needs a button.`);
    if (card.buttons.length > MAX_CARD_BUTTONS) {
      problems.push(`A card carries at most ${MAX_CARD_BUTTONS} buttons.`);
    }
    if (buttonShape(card) !== shape) problems.push("Every card needs the same buttons, in the same order.");
    for (const problem of partsProblems({ buttons: card.buttons })) problems.push(problem);
  });
  return [...new Set(problems)];
}

function metaButton(button: TemplateButton) {
  return button.type === "url"
    ? { type: "URL", text: button.text, url: button.url }
    : button.type === "phone"
      ? { type: "PHONE_NUMBER", text: button.text, phone_number: button.phone }
      : { type: "QUICK_REPLY", text: button.text };
}

/** The CAROUSEL component Meta reviews, with one sample handle per card. */
export function metaCarousel(cards: TemplateCard[], handles: string[]) {
  return {
    type: "CAROUSEL",
    cards: (tidyCards(cards) ?? []).map((card, index) => ({
      components: [
        {
          type: "HEADER",
          format: (card.media?.type ?? "image").toUpperCase(),
          example: { header_handle: [handles[index]] },
        },
        { type: "BODY", text: card.body },
        { type: "BUTTONS", buttons: card.buttons.map(metaButton) },
      ],
    })),
  };
}

/** The send-time `carousel` component: each card's media, and a payload per quick reply. */
export function carouselSendComponent(
  cards: TemplateCard[],
  linkFor: (key: string) => string
) {
  return {
    type: "carousel",
    cards: (tidyCards(cards) ?? []).map((card, cardIndex) => ({
      card_index: cardIndex,
      components: [
        ...(card.media
          ? [
              {
                type: "header",
                parameters: [
                  { type: card.media.type, [card.media.type]: { link: linkFor(card.media.key) } },
                ],
              },
            ]
          : []),
        ...card.buttons.flatMap((button, index) =>
          button.type === "quick_reply"
            ? [
                {
                  type: "button",
                  sub_type: "quick_reply",
                  index,
                  parameters: [{ type: "payload", payload: button.text }],
                },
              ]
            : []
        ),
      ],
    })),
  };
}
