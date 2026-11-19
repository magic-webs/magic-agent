import { ConvexError, v } from "convex/values";
import { query, internalQuery } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { getPrincipal, principalKey, requireSignedIn } from "./lib/auth";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const passkeyCaller = internalQuery({
  args: {},
  handler: async (ctx) => {
    const principal = await requireSignedIn(ctx);
    const key = principalKey(principal);
    const existing = await ctx.db
      .query("passkeys")
      .withIndex("by_principal", (q) => q.eq("principal", key))
      .collect();
    return {
      key,
      fields: {
        role: principal.role,
        adminId: principal.role === "admin" ? principal.adminId : undefined,
        workspaceId:
          principal.role === "workspace" || principal.role === "member"
            ? principal.workspaceId
            : undefined,
        memberId: principal.role === "member" ? principal.memberId : undefined,
        userId: principal.role === "user" ? principal.userId : undefined,
      },
      existing: existing.map((row) => ({
        id: row.credentialId,
        transports: row.transports,
      })),
    };
  },
});

export const putChallenge = internalMutation({
  args: {
    challenge: v.string(),
    purpose: v.union(v.literal("register"), v.literal("login")),
    principal: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("passkeyChallenges", {
      ...args,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
  },
});

/** Single use: a challenge is gone once anyone has tried to answer it. */
export const takeChallenge = internalMutation({
  args: { challenge: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("passkeyChallenges")
      .withIndex("by_challenge", (q) => q.eq("challenge", args.challenge))
      .unique();
    if (!row) return null;
    await ctx.db.delete("passkeyChallenges", row._id);
    if (row.expiresAt < Date.now()) return null;
    return { purpose: row.purpose, principal: row.principal ?? null };
  },
});

export const byCredentialId = internalQuery({
  args: { credentialId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("passkeys")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", args.credentialId))
      .unique();
  },
});

export const insertPasskey = internalMutation({
  args: {
    principal: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("workspace"),
      v.literal("member"),
      v.literal("user")
    ),
    adminId: v.optional(v.id("admins")),
    workspaceId: v.optional(v.id("workspaces")),
    memberId: v.optional(v.id("teamMembers")),
    userId: v.optional(v.id("users")),
    credentialId: v.string(),
    publicKey: v.string(),
    counter: v.number(),
    transports: v.optional(v.array(v.string())),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const taken = await ctx.db
      .query("passkeys")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", args.credentialId))
      .unique();
    if (taken) throw new ConvexError("This passkey is already added.");
    await ctx.db.insert("passkeys", { ...args, createdAt: Date.now() });
  },
});

export const markUsed = internalMutation({
  args: { passkeyId: v.id("passkeys"), counter: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch("passkeys", args.passkeyId, {
      counter: args.counter,
      lastUsedAt: Date.now(),
    });
  },
});

export const deleteExpiredChallenges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const row of await ctx.db.query("passkeyChallenges").collect()) {
      if (row.expiresAt < now) await ctx.db.delete("passkeyChallenges", row._id);
    }
  },
});

/** The caller's own passkeys. Never the key material. */
export const myPasskeys = query({
  args: {},
  handler: async (ctx) => {
    const principal = await getPrincipal(ctx);
    if (!principal) return null;
    const rows = await ctx.db
      .query("passkeys")
      .withIndex("by_principal", (q) => q.eq("principal", principalKey(principal)))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        _id: row._id,
        name: row.name,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? null,
      }));
  },
});

async function ownPasskey(
  ctx: Parameters<typeof requireSignedIn>[0],
  passkeyId: string
) {
  const principal = await requireSignedIn(ctx);
  const id = ctx.db.normalizeId("passkeys", passkeyId);
  const row = id ? await ctx.db.get("passkeys", id) : null;
  if (!row || row.principal !== principalKey(principal)) {
    throw new ConvexError("That passkey no longer exists.");
  }
  return row;
}

export const renamePasskey = mutation({
  args: { passkeyId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const row = await ownPasskey(ctx, args.passkeyId);
    const name = args.name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) throw new ConvexError("Give the passkey a name.");
    await ctx.db.patch("passkeys", row._id, { name });
  },
});

export const removePasskey = mutation({
  args: { passkeyId: v.string() },
  handler: async (ctx, args) => {
    const row = await ownPasskey(ctx, args.passkeyId);
    await ctx.db.delete("passkeys", row._id);
  },
});
