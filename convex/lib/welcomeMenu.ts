import type { Outbound } from "./whatsappSend";

export type WelcomeOption = { title: string; description?: string };

export type WelcomeMenu = {
  enabled: boolean;
  body: string;
  header?: string;
  footer?: string;
  buttonText?: string;
  options: WelcomeOption[];
};

export const WELCOME_LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  buttonText: 20,
  title: 20,
  description: 72,
  options: 10,
  buttons: 3,
} as const;

export const FRESH_AFTER_MS = 12 * 60 * 60 * 1000;
export const CLASSIFY_MAX_WORDS = 8;
export const CLASSIFY_MAX_CHARS = 80;
export const UNCLEAR_CONFIDENCE = 0.7;

export const DEFAULT_BUTTON_TEXT = "See options";

export function defaultWelcomeBody(workspaceName: string): string {
  return `Hi! Welcome to ${workspaceName.trim() || "us"}. What can we help you with today?`;
}

const GREETING_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "hai",
  "hallo",
  "helo",
  "hiya",
  "howdy",
  "yo",
  "sup",
  "namaste",
  "namaskar",
  "namaskaram",
  "vanakkam",
  "salaam",
  "salam",
  "assalamualaikum",
  "hola",
  "gm",
  "start",
  "menu",
  "help",
  "info",
]);

const GREETING_PHRASES = [
  /^good (morning|afternoon|evening|day)$/,
  /^(hi|hello|hey) good (morning|afternoon|evening)$/,
  /^ram ram$/,
  /^jai shree krishna$/,
];

const ADDRESSEES = new Set([
  "there",
  "team",
  "all",
  "everyone",
  "sir",
  "madam",
  "mam",
  "maam",
  "ji",
  "bhai",
  "dear",
  "friend",
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\p{P}\p{S}\p{Extended_Pictographic}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGreeting(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const plain = normalise(raw);
  if (!plain) return raw.length <= 8;
  if (plain.split(" ").length > 4) return false;
  const squashed = plain.replace(/(.)\1+/g, "$1");
  const isWord = (word: string) =>
    GREETING_WORDS.has(word) || GREETING_WORDS.has(word.replace(/(.)\1+/g, "$1"));
  const [first, ...rest] = plain.split(" ");
  if (isWord(first) && rest.every((word) => ADDRESSEES.has(word))) return true;
  return GREETING_PHRASES.some((pattern) => pattern.test(plain) || pattern.test(squashed));
}

export function worthClassifying(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= CLASSIFY_MAX_CHARS &&
    trimmed.split(/\s+/).length <= CLASSIFY_MAX_WORDS
  );
}

const clip = (text: string, max: number) => {
  const value = text.trim().replace(/\s+/g, " ");
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
};

export function tidyWelcomeMenu(menu: WelcomeMenu): WelcomeMenu {
  const seen = new Set<string>();
  const options: WelcomeOption[] = [];
  for (const option of menu.options) {
    const title = clip(option.title, WELCOME_LIMITS.title);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const description = option.description
      ? clip(option.description, WELCOME_LIMITS.description)
      : "";
    options.push(description ? { title, description } : { title });
    if (options.length === WELCOME_LIMITS.options) break;
  }
  const header = menu.header ? clip(menu.header, WELCOME_LIMITS.header) : "";
  const footer = menu.footer ? clip(menu.footer, WELCOME_LIMITS.footer) : "";
  const buttonText = menu.buttonText ? clip(menu.buttonText, WELCOME_LIMITS.buttonText) : "";
  return {
    enabled: menu.enabled,
    body: menu.body.trim().slice(0, WELCOME_LIMITS.body),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(buttonText ? { buttonText } : {}),
    options,
  };
}

export function optionsFromAgents(
  agents: Array<{ name: string; role?: string; routingDescription?: string }>
): WelcomeOption[] {
  return tidyWelcomeMenu({
    enabled: true,
    body: "",
    options: agents.map((agent) => ({
      title: agent.name,
      description: agent.role,
    })),
  }).options;
}

export function welcomeOutbound(
  menu: WelcomeMenu,
  workspaceName: string
): Outbound | null {
  const tidy = tidyWelcomeMenu(menu);
  if (tidy.options.length === 0) return null;
  const body = tidy.body || defaultWelcomeBody(workspaceName);
  const header = tidy.header ? { type: "text" as const, text: tidy.header } : undefined;

  if (tidy.options.length <= WELCOME_LIMITS.buttons) {
    return {
      kind: "buttons",
      body,
      buttons: tidy.options.map((option) => ({ id: option.title, title: option.title })),
      ...(header ? { header } : {}),
      ...(tidy.footer ? { footer: tidy.footer } : {}),
    };
  }

  return {
    kind: "list",
    body,
    buttonText: tidy.buttonText || DEFAULT_BUTTON_TEXT,
    sections: [
      {
        title: "How we can help",
        rows: tidy.options.map((option) => ({
          id: option.title,
          title: option.title,
          ...(option.description ? { description: option.description } : {}),
        })),
      },
    ],
    ...(header ? { header } : {}),
    ...(tidy.footer ? { footer: tidy.footer } : {}),
  };
}
