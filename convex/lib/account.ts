/**
 * A workspace's standing with the platform, read from inside a query or a
 * mutation: its billing account, the plan whose limits apply, the seats in
 * use, and whether its dashboard is open.
 *
 * Server-only. The arithmetic lives in ./plans, which React imports too.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getPrincipal, isFullAdmin } from "./auth";
import { currencyOf, guessCurrency } from "./currency";
import {
  DEFAULT_SETTINGS,
  defaultRechargeIn,
  planCurrency,
  termsIn,
  accessOf,
  DESK_NAMES,
  DESK_ORDER,
  deskPaid,
  hasRoomFor,
  isPerAgent,
  seatsOf,
  type DeskKind,
  type Access,
  type SeatKind,
  type SeatUsage,
} from "./plans";
import { ConvexError } from "convex/values";

type Ctx = QueryCtx | MutationCtx;

/** A plan catalogue is a handful of rows; this is a ceiling, not a page. */
const PLAN_CAP = 50;
/** Seats are counted off indexes; nobody runs this many at once. */
const SEAT_SCAN_CAP = 500;

export async function billingSettings(
  ctx: Ctx
): Promise<Doc<"billingSettings"> | null> {
  return await ctx.db.query("billingSettings").first();
}

/**
 * The settings as this workspace is billed: its account's currency, with
 * that currency's GST, extra agent and wallet terms.
 */
export async function billingTermsFor(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<{
  settings: Doc<"billingSettings">;
  account: Doc<"billingAccounts"> | null;
  currency: string;
} | null> {
  const base = await billingSettings(ctx);
  if (!base) return null;
  const account = await accountFor(ctx, workspaceId);
  const workspace = account
    ? null
    : await ctx.db.get("workspaces", workspaceId);
  const currency = currencyOf(base, account, workspace);
  return { settings: termsIn(base, currency), account, currency };
}

export async function accountFor(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"billingAccounts"> | null> {
  return await ctx.db
    .query("billingAccounts")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}

/** Every plan, in the order an administrator arranged them. */
export async function allPlans(ctx: Ctx): Promise<Doc<"billingPlans">[]> {
  return await ctx.db
    .query("billingPlans")
    .withIndex("by_sortOrder")
    .take(PLAN_CAP);
}

/**
 * The plan whose limits apply: the account's own, else the trial plan the
 * settings name, else the first one on sale.
 */
export async function planFor(
  ctx: Ctx,
  settings: Doc<"billingSettings"> | null,
  account: Doc<"billingAccounts"> | null
): Promise<Doc<"billingPlans"> | null> {
  if (account?.planId) {
    const own = await ctx.db.get("billingPlans", account.planId);
    if (own) return own;
  }
  if (settings?.trialPlanId) {
    const trial = await ctx.db.get("billingPlans", settings.trialPlanId);
    if (trial && planCurrency(trial) === settings.currency) return trial;
  }
  const plans = await allPlans(ctx);
  const own = settings
    ? plans.filter((plan) => planCurrency(plan) === settings.currency)
    : plans;
  return (
    own.find((plan) => plan.status === "active") ??
    plans.find((plan) => plan.status === "active") ??
    plans[0] ??
    null
  );
}

export async function liveSubscription(
  ctx: Ctx,
  account: Doc<"billingAccounts"> | null
): Promise<Doc<"billingSubscriptions"> | null> {
  if (!account?.subscriptionId) return null;
  return await ctx.db.get("billingSubscriptions", account.subscriptionId);
}

/**
 * The account, made on first need.
 *
 * No trial date is written: until an administrator sets one, the trial is
 * worked out from the settings on every read (`defaultTrialEnd`), so making
 * the row changes nobody's trial and a later change to the trial length
 * still reaches every account that has not been given a date of its own.
 */
export async function ensureAccount(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"billingAccounts">> {
  const existing = await accountFor(ctx, workspaceId);
  if (existing) return existing;

  const base = await billingSettings(ctx);
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw new ConvexError("Workspace not found");
  const currency = base ? guessCurrency(base, workspace) : undefined;
  const settings = base && currency ? termsIn(base, currency) : base;

  const now = Date.now();
  const accountId = await ctx.db.insert("billingAccounts", {
    workspaceId,
    currency,
    extraAgents: 0,
    mode: "trial",
    lowBalanceThresholdMicros:
      settings?.defaultThresholdMicros ??
      DEFAULT_SETTINGS.defaultThresholdMicros,
    autoRecharge: {
      enabled: false,
      amountMicros: defaultRechargeIn(settings ?? DEFAULT_SETTINGS),
    },
    createdAt: now,
    updatedAt: now,
  });
  const account = await ctx.db.get("billingAccounts", accountId);
  if (!account) throw new Error("Billing account could not be created");
  return account;
}

/**
 * Who Razorpay bills: what the company saved on its Billing page, else its
 * company profile. One answer for the form's prefill, the mandate's customer
 * and every recharge, so "add an email" never means one place and not another.
 */
export function billingContact(
  account: Doc<"billingAccounts"> | null,
  workspace: Doc<"workspaces">
): { name: string; email: string; phone: string } {
  return {
    name: account?.billingName?.trim() || workspace.name,
    email:
      account?.billingEmail?.trim() || workspace.supportEmail?.trim() || "",
    phone: (account?.billingPhone || workspace.supportPhone || "").replace(
      /[\s-]/g,
      ""
    ),
  };
}

/**
 * What the plan's limits are measured against: custom agents that are live,
 * and human agents on the roster who are not inactive — the admin always
 * among them. The three desks are part of every plan and are never counted,
 * and a draft or paused agent takes no traffic, so it takes no seat.
 */
export async function seatsInUse(
  ctx: Ctx,
  workspaceId: Id<"workspaces">
): Promise<{ ai: number; human: number }> {
  const live = await ctx.db
    .query("agents")
    .withIndex("by_workspace_status", (q) =>
      q.eq("workspaceId", workspaceId).eq("status", "active")
    )
    .take(SEAT_SCAN_CAP);
  const members = await ctx.db
    .query("teamMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(SEAT_SCAN_CAP);
  return {
    ai: live.filter(
      (agent) => agent.kind === "specialist" || agent.kind === undefined
    ).length,
    human:
      1 +
      members.filter((member) => !member.isOwner && member.status !== "inactive")
        .length,
  };
}

export type Standing = {
  settings: Doc<"billingSettings"> | null;
  account: Doc<"billingAccounts"> | null;
  plan: Doc<"billingPlans"> | null;
  subscription: Doc<"billingSubscriptions"> | null;
  access: Access;
  used: { ai: number; human: number };
  /** Null while billing is off, when there are no limits to measure. */
  seats: SeatUsage | null;
};

/** Everything the lock, the banners and the seat checks read, in one place. */
export async function standingOf(
  ctx: Ctx,
  workspace: Doc<"workspaces">,
  now: number,
  /** Already read, when the caller is going through many accounts. */
  known?: { settings: Doc<"billingSettings"> | null }
): Promise<Standing> {
  const base = known ? known.settings : await billingSettings(ctx);
  const account = await accountFor(ctx, workspace._id);
  const settings = base
    ? termsIn(base, currencyOf(base, account, workspace))
    : null;
  const plan = settings ? await planFor(ctx, settings, account) : null;
  const subscription = await liveSubscription(ctx, account);
  const used = await seatsInUse(ctx, workspace._id);

  return {
    settings,
    account,
    plan,
    subscription,
    access: accessOf({
      settings,
      account,
      subscription,
      workspaceCreatedAt: workspace.createdAt,
      now,
    }),
    used,
    seats: plan ? seatsOf(plan, account, used) : null,
  };
}

/**
 * Why a desk may not work, or null when it may. Only a per-agent plan holds a
 * desk back: there the AI agents paid for go to the desks in order.
 */
export async function deskBlock(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  kind: DeskKind
): Promise<string | null> {
  const terms = await billingTermsFor(ctx, workspaceId);
  if (!terms) return null;
  const plan = await planFor(ctx, terms.settings, terms.account);
  if (!plan || !isPerAgent(plan)) return null;
  const paid = terms.account?.agents?.ai ?? 0;
  if (deskPaid(kind, paid)) return null;
  const needed = DESK_ORDER.indexOf(kind) + 1;
  return `The ${DESK_NAMES[kind].toLowerCase()} isn't on your ${plan.name} plan. Pay for ${needed} AI agents on the Billing page to switch it on.`;
}

/**
 * Refuse one more live agent of this kind when the plan and its extra agents
 * are all in use.
 *
 * Administrators are let through: they set accounts up by hand, and an
 * account they take over its limit shows as over on its Billing page rather
 * than silently growing. With billing switched off there are no limits.
 */
export async function assertSeat(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
  kind: SeatKind
): Promise<void> {
  if (isFullAdmin(await getPrincipal(ctx))) return;

  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) throw new ConvexError("Workspace not found");
  const standing = await standingOf(ctx, workspace, Date.now());
  if (!standing.plan || !standing.seats) return;
  if (hasRoomFor(standing.seats, kind)) return;

  const { plan, seats } = standing;
  const instead =
    kind === "ai"
      ? "pause another agent first"
      : "set another human agent to inactive first";
  if (isPerAgent(plan)) {
    const own = seats[kind];
    const noun = kind === "ai" ? "custom agent" : "human agent";
    const desks =
      kind === "ai"
        ? ` Custom agents start after the ${DESK_ORDER.length} desks.`
        : "";
    throw new ConvexError(
      `Your ${plan.name} plan pays for ${own.included} ${noun}${own.included === 1 ? "" : "s"}, and all of them are in use.${desks} Add one on the Billing page, or ${instead}.`
    );
  }
  const included =
    kind === "ai"
      ? `${plan.includedAiAgents} live custom ${plan.includedAiAgents === 1 ? "agent" : "agents"}`
      : `${plan.includedHumanAgents} human ${plan.includedHumanAgents === 1 ? "agent" : "agents"}`;
  const extras =
    seats.extra.bought === 0
      ? "no extra agents"
      : `all ${seats.extra.bought} extra ${seats.extra.bought === 1 ? "agent is" : "agents are"} in use`;
  throw new ConvexError(
    `The ${plan.name} plan includes ${included}, and ${extras}. Add an extra agent on the Billing page, or ${instead}.`
  );
}
