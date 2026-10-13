import type { Doc } from "../_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;

type Activity = Pick<Doc<"contacts">, "lastReadAt" | "lastRepliedAt" | "lastOrderAt" | "lastInboundAt">;

export const SEGMENTS: Array<{
  key: string;
  label: string;
  test: (contact: Activity, now: number) => boolean;
}> = [
  {
    key: "read_no_reply",
    label: "Read but didn't reply (30 days)",
    test: (contact, now) =>
      (contact.lastReadAt ?? 0) >= now - 30 * DAY_MS &&
      (contact.lastRepliedAt ?? 0) < now - 30 * DAY_MS,
  },
  {
    key: "ordered_recently",
    label: "Ordered in the last 30 days",
    test: (contact, now) => (contact.lastOrderAt ?? 0) >= now - 30 * DAY_MS,
  },
  {
    key: "lapsed",
    label: "Ordered before, not in 90 days",
    test: (contact, now) =>
      contact.lastOrderAt !== undefined && contact.lastOrderAt < now - 90 * DAY_MS,
  },
  {
    key: "silent",
    label: "Silent for 90 days",
    test: (contact, now) => (contact.lastInboundAt ?? 0) < now - 90 * DAY_MS,
  },
  {
    key: "never_read",
    label: "Never read a marketing message",
    test: (contact) => contact.lastReadAt === undefined,
  },
];

export function inSegments(contact: Activity, segments: string[] | undefined, now: number) {
  return (segments ?? []).every(
    (key) => SEGMENTS.find((segment) => segment.key === key)?.test(contact, now) ?? true
  );
}
