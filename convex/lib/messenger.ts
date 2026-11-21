import type { Outbound } from "./whatsappSend";
import { grantedPermissions, instagramMessage, splitForInstagram } from "./instagram";

export const FACEBOOK_API_VERSION = "v23.0";
export const FACEBOOK_GRAPH = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;
export const FACEBOOK_DIALOG = `https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`;
export const MESSENGER_WEBHOOK_FIELDS = ["messages", "messaging_postbacks"];
export const PAGE_COMMENTS_SCOPE = "pages_manage_engagement";
export const MESSENGER_TEXT_LIMIT = 2000;

export function messengerRedirectUri(siteUrl: string): string {
  return `${siteUrl}/messenger/callback`;
}

export function facebookUrl(path: string, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${FACEBOOK_GRAPH}/${path.replace(/^\//, "")}${query}`;
}

export function messengerMessage(message: Outbound): Record<string, unknown> | null {
  return instagramMessage(message, MESSENGER_TEXT_LIMIT);
}

export function splitForMessenger(text: string): string[] {
  return splitForInstagram(text, MESSENGER_TEXT_LIMIT);
}

export function canManagePageComments(permissions: string[] | undefined): boolean {
  return Boolean(permissions?.includes(PAGE_COMMENTS_SCOPE));
}

export function pageWebhookFields(permissions: string[] | undefined): string[] {
  return canManagePageComments(permissions)
    ? [...MESSENGER_WEBHOOK_FIELDS, "feed"]
    : MESSENGER_WEBHOOK_FIELDS;
}

export function grantedFromPermissions(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object") return grantedPermissions(value);
  const rows = (value as { data?: Array<{ permission?: string; status?: string }> }).data;
  if (!Array.isArray(rows)) return undefined;
  return rows
    .filter((row) => row.status === "granted" && row.permission)
    .map((row) => row.permission as string);
}
