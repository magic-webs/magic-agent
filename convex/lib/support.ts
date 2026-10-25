import type { Infer } from "convex/values";
import type { supportPriority, supportStatus, supportType } from "../schema/support";

export type SupportType = Infer<typeof supportType>;
export type SupportPriority = Infer<typeof supportPriority>;
export type SupportStatus = Infer<typeof supportStatus>;

export const SUPPORT_TYPES: { value: SupportType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "question", label: "Question" },
  { value: "billing", label: "Billing" },
  { value: "channel", label: "WhatsApp / channel" },
  { value: "agent", label: "Agent behaviour" },
  { value: "access", label: "Account access" },
  { value: "other", label: "Other" },
];

export const SUPPORT_PRIORITIES: { value: SupportPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const SUPPORT_STATUSES: { value: SupportStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_client", label: "Waiting on you" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export const ACTIVE_STATUSES: SupportStatus[] = ["open", "in_progress", "waiting_client"];

export const ACCESS_HOURS = [1, 4, 24, 48, 72, 168];

export const SUPPORT_LIMITS = {
  subject: 140,
  body: 10_000,
  files: 10,
  fileBytes: 20 * 1024 * 1024,
  tags: 10,
  accessHours: 168,
};

export const DEFAULT_SUPPORT_SETTINGS = {
  firstResponseHours: { low: 48, normal: 24, high: 8, urgent: 2 },
  resolutionHours: { low: 240, normal: 120, high: 48, urgent: 12 },
  autoResolveWaitingDays: 5,
  autoCloseResolvedDays: 7,
  reopenDays: 7,
};

export type SupportSettings = typeof DEFAULT_SUPPORT_SETTINGS;

const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export function dueDates(settings: SupportSettings, priority: SupportPriority, from: number) {
  return {
    firstResponseDueAt: from + settings.firstResponseHours[priority] * HOUR,
    resolutionDueAt: from + settings.resolutionHours[priority] * HOUR,
  };
}

export function labelOf<T extends string>(list: { value: T; label: string }[], value: T): string {
  return list.find((item) => item.value === value)?.label ?? value;
}

export function ticketRef(number: number): string {
  return `#${number}`;
}

export function preview(text: string, length = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
