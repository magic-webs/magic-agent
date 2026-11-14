export type WidgetIcon = "chat" | "chat-dots" | "sparkles" | "bot" | "headset" | "smile" | "help";

export const WIDGET_ICONS: Record<WidgetIcon, { label: string; filled: boolean; svg: string }> = {
  chat: {
    label: "Chat",
    filled: true,
    svg: '<path d="M12 3c-4.97 0-9 3.58-9 8 0 2.37 1.16 4.5 3 5.95V21l3.3-1.65c.86.23 1.76.35 2.7.35 4.97 0 9-3.58 9-8s-4.03-8-9-8Z"/>',
  },
  "chat-dots": {
    label: "Typing",
    filled: false,
    svg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="3"/>',
  },
  sparkles: {
    label: "Sparkles",
    filled: false,
    svg: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0Z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
  },
  bot: {
    label: "Bot",
    filled: false,
    svg: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  },
  headset: {
    label: "Support",
    filled: false,
    svg: '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>',
  },
  smile: {
    label: "Smile",
    filled: false,
    svg: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01" stroke-width="3"/>',
  },
  help: {
    label: "Help",
    filled: false,
    svg: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01" stroke-width="3"/>',
  },
};

export const WIDGET_SIZES = { small: 52, medium: 60, large: 68 } as const;

export function widgetInk(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 186 ? "#111827" : "#ffffff";
}
