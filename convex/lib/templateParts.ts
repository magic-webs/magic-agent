import { v, type Infer } from "convex/values";

export const templateButton = v.union(
  v.object({ type: v.literal("quick_reply"), text: v.string() }),
  v.object({ type: v.literal("url"), text: v.string(), url: v.string() }),
  v.object({ type: v.literal("phone"), text: v.string(), phone: v.string() })
);

export type TemplateButton = Infer<typeof templateButton>;
export type TemplateParts = {
  header?: string;
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

const VARIABLE = /\{\{/;

export function tidyParts(parts: TemplateParts): TemplateParts {
  const header = parts.header?.trim() || undefined;
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
  return { header, footer, buttons: buttons.length > 0 ? buttons : undefined };
}

export function partsProblems(parts: TemplateParts): string[] {
  const { header, footer, buttons = [] } = tidyParts(parts);
  const problems: string[] = [];
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

export function metaParts(parts: TemplateParts) {
  const { header, footer, buttons } = tidyParts(parts);
  return [
    ...(header ? [{ type: "HEADER", format: "TEXT", text: header }] : []),
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
