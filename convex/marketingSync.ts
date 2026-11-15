// Mirrors marketing sends and contacts to the marketing service while it is
// being cut over from Convex. Off unless MARKETING_SERVICE_URL is set and the
// workspace has `marketingMirror`.
//
//   bunx convex env set MARKETING_SERVICE_URL https://marketing-api.magicwebs.ai
//   bunx convex env set MARKETING_SERVICE_SECRET <the VPS's SERVICE_SECRET>
//   bunx convex run marketingSync:setMirror '{"workspaceId": "...", "on": true}'

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";

const MAX_ATTEMPTS = 12;
const TIMEOUT_MS = 15_000;

const event = v.union(
  v.object({ type: v.literal("send"), at: v.number(), doc: v.any() }),
  v.object({ type: v.literal("send.deleted"), at: v.number(), id: v.string() }),
  v.object({ type: v.literal("contact"), at: v.number(), doc: v.any() }),
  v.object({ type: v.literal("contact.deleted"), at: v.number(), id: v.string() }),
  v.object({
    type: v.literal("status"),
    at: v.number(),
    wamid: v.string(),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("delivered"), v.literal("read"), v.literal("failed")),
    error: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("queued"),
    at: v.number(),
    queueId: v.string(),
    wamid: v.optional(v.string()),
    failed: v.boolean(),
    error: v.optional(v.string()),
  }),
  v.object({ type: v.literal("conversion"), at: v.number(), contactId: v.string() }),
  v.object({ type: v.literal("template"), at: v.number(), doc: v.any() }),
  v.object({ type: v.literal("template.deleted"), at: v.number(), id: v.string() })
);

const MAX_SKEW_SECONDS = 300;

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when `header` signs `body` with MARKETING_SERVICE_SECRET within five minutes. */
export async function verifySignature(header: string | null, body: string) {
  const secret = process.env.MARKETING_SERVICE_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2)));
  const at = Number(parts.t);
  if (!Number.isFinite(at) || Math.abs(Date.now() / 1000 - at) > MAX_SKEW_SECONDS) return false;
  const expected = await hmacHex(secret, `${at}.${body}`);
  const given = String(parts.v1 ?? "");
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function signature(secret: string, body: string) {
  const at = Math.floor(Date.now() / 1000);
  return `t=${at},v1=${await hmacHex(secret, `${at}.${body}`)}`;
}

const CLAIM_TIMEOUT_MS = 2_500;

export type ClaimedReply = {
  seed: Array<{
    text: string;
    createdAt: number;
    agentId: string | null;
    delivery: "pending" | "sent" | "delivered" | "read" | "failed" | null;
    shown: unknown;
  }>;
  replyAgentId: string | null;
  campaign: string | null;
};

/**
 * Asks the marketing service which campaign a WhatsApp reply answers. A slow
 * or absent service never holds a customer's message up: it answers null and
 * the turn goes on without the campaign context.
 */
export async function claimReply(input: {
  workspaceId: string;
  externalId: string;
  text: string;
  at: number;
}): Promise<ClaimedReply | null> {
  const url = process.env.MARKETING_SERVICE_URL;
  const secret = process.env.MARKETING_SERVICE_SECRET;
  if (!url || !secret) return null;
  const body = JSON.stringify(input);
  try {
    const res = await fetch(`${url}/internal/replies`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": await signature(secret, body) },
      body,
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`marketing reply claim: HTTP ${res.status}`);
      return null;
    }
    const claimed = (await res.json()) as ClaimedReply & { contactId: string | null };
    return { seed: claimed.seed, replyAgentId: claimed.replyAgentId, campaign: claimed.campaign };
  } catch (err) {
    console.warn(`marketing reply claim failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export const forward = internalAction({
  args: { events: v.array(event), attempt: v.number() },
  handler: async (ctx, args) => {
    const url = process.env.MARKETING_SERVICE_URL;
    const secret = process.env.MARKETING_SERVICE_SECRET;
    if (!url || !secret) return null;

    const body = JSON.stringify({ events: args.events });
    let error: string | null = null;
    try {
      const res = await fetch(`${url}/internal/events`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": await signature(secret, body) },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) error = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      else {
        const result = (await res.json()) as { applied: number; rejected: number };
        if (result.rejected > 0) {
          console.warn(`marketing sync: ${result.rejected} of ${args.events.length} rejected; see sync_rejects on the VPS`);
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (!error) return null;
    if (args.attempt + 1 >= MAX_ATTEMPTS) {
      console.error(`marketing sync: gave up on ${args.events.length} events after ${MAX_ATTEMPTS} attempts: ${error}`);
      return null;
    }
    const delay = Math.min(60 * 60 * 1000, 2 ** args.attempt * 5_000);
    console.warn(`marketing sync: attempt ${args.attempt + 1} failed (${error}); retrying in ${delay / 1000}s`);
    await ctx.scheduler.runAfter(delay, internal.marketingSync.forward, {
      events: args.events,
      attempt: args.attempt + 1,
    });
    return null;
  },
});

export const setMirror = internalMutation({
  args: { workspaceId: v.id("workspaces"), on: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch("workspaces", args.workspaceId, { marketingMirror: args.on || undefined });
    return { workspaceId: args.workspaceId, mirror: args.on };
  },
});

export const setOnVm = internalMutation({
  args: { workspaceId: v.id("workspaces"), on: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch("workspaces", args.workspaceId, { marketingOnVm: args.on || undefined });
    return { workspaceId: args.workspaceId, marketingOnVm: args.on };
  },
});
