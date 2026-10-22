import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { loginEmailTaken } from "./authDb";
import { insertWorkspace } from "./workspaces";
import { guessCurrency, isIndian } from "./lib/currency";
import { billingSettings } from "./lib/account";
import { formatMoney } from "./lib/billing";
import { PLATFORM_LOCALE, termsIn, welcomeBonusOf } from "./lib/plans";
import { isValidLocale, isValidTimezone } from "./lib/regional";

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
/** How long one address's codes are counted against `MAX_SENDS`. */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;

const TAKEN = "That email already has an account. Sign in instead.";
const EXPIRED = { message: "This sign-up has expired. Start again.", restart: true };

export type SignupEmail = {
  email: string;
  name: string;
  businessName: string;
  perks: { trialDays: number; bonus: string | null } | null;
};

/** The trial and credit the new workspace will get, worked out as it will be. */
async function emailFor(ctx: MutationCtx, row: Omit<SignupEmail, "perks"> & { timezone?: string }): Promise<SignupEmail> {
  const base = await billingSettings(ctx);
  const currency = base ? guessCurrency(base, { timezone: row.timezone }) : null;
  const bonus = base && currency ? welcomeBonusOf(termsIn(base, currency), currency) : 0;
  return {
    email: row.email,
    name: row.name,
    businessName: row.businessName,
    perks: base
      ? {
          trialDays: base.trialDays,
          bonus: bonus > 0 && currency ? formatMoney(bonus, currency, PLATFORM_LOCALE).replace(/\.00$/, "") : null,
        }
      : null,
  };
}

function throttle(row: Doc<"signups">, now: number) {
  if (row.sends >= MAX_SENDS) {
    throw new ConvexError("Too many codes have gone to this address. Try again in an hour.");
  }
  if (now - row.sentAt < RESEND_AFTER_MS) {
    throw new ConvexError("A code was sent less than a minute ago. Check your inbox, or wait a moment.");
  }
}

export const start = internalMutation({
  args: {
    tokenHash: v.string(),
    codeHash: v.string(),
    email: v.string(),
    name: v.string(),
    businessName: v.string(),
    passwordHash: v.string(),
    timezone: v.optional(v.string()),
    locale: v.optional(v.string()),
    brief: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SignupEmail> => {
    if (await loginEmailTaken(ctx, args.email)) throw new ConvexError(TAKEN);
    const now = Date.now();
    const existing = await ctx.db
      .query("signups")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    const fields = { ...args, attempts: 0, sentAt: now };

    if (existing && existing.expiresAt > now) {
      throttle(existing, now);
      await ctx.db.patch("signups", existing._id, { ...fields, sends: existing.sends + 1 });
      return await emailFor(ctx, args);
    }
    if (existing) await ctx.db.delete("signups", existing._id);
    await ctx.db.insert("signups", {
      ...fields,
      sends: 1,
      createdAt: now,
      expiresAt: now + WINDOW_MS,
    });
    return await emailFor(ctx, args);
  },
});

export const resend = internalMutation({
  args: { tokenHash: v.string(), codeHash: v.string() },
  handler: async (ctx, args): Promise<SignupEmail> => {
    const now = Date.now();
    const row = await ctx.db
      .query("signups")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!row || row.expiresAt < now) throw new ConvexError(EXPIRED);
    throttle(row, now);
    await ctx.db.patch("signups", row._id, {
      codeHash: args.codeHash,
      attempts: 0,
      sends: row.sends + 1,
      sentAt: now,
    });
    return await emailFor(ctx, row);
  },
});

/**
 * The code checked, then the workspace and its owner's login made in one go.
 * A wrong code comes back rather than throwing, so the count of tries is kept.
 */
export const complete = internalMutation({
  args: { tokenHash: v.string(), codeHash: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<
    | { ok: true; userId: Id<"users">; slug: string }
    | { ok: false; error: string; restart: boolean }
  > => {
    const now = Date.now();
    const row = await ctx.db
      .query("signups")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!row || row.expiresAt < now) return { ok: false, error: EXPIRED.message, restart: true };
    if (row.attempts >= MAX_ATTEMPTS) {
      return { ok: false, error: "Too many wrong tries. Ask for a new code.", restart: false };
    }
    if (now - row.sentAt > CODE_TTL_MS) {
      return { ok: false, error: "This code has expired. Ask for a new one.", restart: false };
    }
    if (row.codeHash !== args.codeHash) {
      const attempts = row.attempts + 1;
      await ctx.db.patch("signups", row._id, { attempts });
      return {
        ok: false,
        error:
          attempts >= MAX_ATTEMPTS
            ? "Too many wrong tries. Ask for a new code."
            : "That code is not right. Check the email and try again.",
        restart: false,
      };
    }

    await ctx.db.delete("signups", row._id);
    if (await loginEmailTaken(ctx, row.email)) return { ok: false, error: TAKEN, restart: true };

    const timezone = row.timezone && isValidTimezone(row.timezone) ? row.timezone : undefined;
    const indian = isIndian({ timezone });
    const { workspaceId, slug } = await insertWorkspace(ctx, {
      name: row.businessName,
      ownerName: row.name,
      description: row.brief,
      timezone,
      locale: row.locale && isValidLocale(row.locale) ? row.locale : indian ? "en-IN" : undefined,
      currency: indian ? "INR" : "USD",
      source: "signup",
    });
    const userId = await ctx.db.insert("users", {
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      workspaceIds: [workspaceId],
      createdAt: now,
    });
    return { ok: true, userId, slug };
  },
});
