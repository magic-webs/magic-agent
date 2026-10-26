/**
 * The platform fee: plans, extra agents, GST, and whether a workspace may use
 * the dashboard right now.
 *
 * Pure, and imported by React as well as by Convex — the pricing cards, the
 * checkout summary and the lock screen all compute from this file, so the
 * figure a company is shown is the figure its subscription is created at.
 *
 * Money is in millionths of the currency, as everywhere else in billing.
 */

import type { Id } from "../_generated/dataModel";
import {
  DEFAULT_AI_PRICING,
  aiPriceIn,
  toMicros,
  type AiPrice,
  type AiPricingCard,
} from "./billing";

/** Plans and the wallet are priced in Razorpay's own currency. */
export const PLATFORM_CURRENCY = "INR";
export const PLATFORM_LOCALE = "en-IN";

// --- Paise -----------------------------------------------------------------

/** A paisa — Razorpay's unit — is ten thousand micros. */
export const MICROS_PER_PAISE = 10_000;

export function toPaise(micros: number): number {
  return Math.round(micros / MICROS_PER_PAISE);
}

export function fromPaise(paise: number): number {
  return paise * MICROS_PER_PAISE;
}

/** Rounded to a whole paisa, the smallest amount a payment can carry. */
export function roundToPaise(micros: number): number {
  return toPaise(micros) * MICROS_PER_PAISE;
}

// --- Defaults ----------------------------------------------------------------

/** What billing starts on the first time an administrator switches it on. */
export const DEFAULT_SETTINGS = {
  currency: PLATFORM_CURRENCY,
  gstPercent: 18,
  trialDays: 14,
  graceDays: 3,
  extraAgentListMicros: toMicros(2499),
  extraAgentPriceMicros: toMicros(999),
  minTopUpMicros: toMicros(500),
  defaultThresholdMicros: toMicros(500),
  welcomeBonus: [
    { currency: "INR", amountMicros: toMicros(200) },
    { currency: "USD", amountMicros: toMicros(5) },
  ],
};

export type CurrencyTerms = {
  currency: string;
  gstPercent: number;
  extraAgentListMicros: number;
  extraAgentPriceMicros: number;
  minTopUpMicros: number;
  defaultThresholdMicros: number;
  /** Whose limits a trial in this currency runs on. */
  trialPlanId?: Id<"billingPlans">;
};

/** What a currency other than the default sells on until an admin edits it. */
export const DEFAULT_CURRENCY_TERMS: CurrencyTerms[] = [
  {
    currency: "USD",
    gstPercent: 0,
    extraAgentListMicros: toMicros(25),
    extraAgentPriceMicros: toMicros(10),
    minTopUpMicros: toMicros(5),
    defaultThresholdMicros: toMicros(5),
  },
];

type TermsCarrier = CurrencyTerms & { currencies?: CurrencyTerms[] };

/** Every currency's terms, the default currency's first. */
export function allCurrencyTerms(settings: TermsCarrier): CurrencyTerms[] {
  const base: CurrencyTerms = {
    currency: settings.currency,
    gstPercent: settings.gstPercent,
    extraAgentListMicros: settings.extraAgentListMicros,
    extraAgentPriceMicros: settings.extraAgentPriceMicros,
    minTopUpMicros: settings.minTopUpMicros,
    defaultThresholdMicros: settings.defaultThresholdMicros,
    trialPlanId: settings.trialPlanId,
  };
  const others = (settings.currencies ?? DEFAULT_CURRENCY_TERMS).filter(
    (entry) => entry.currency !== settings.currency
  );
  return [base, ...others];
}

/** The settings as one currency sells: its GST, extra agent and wallet terms. */
export function termsIn<T extends TermsCarrier>(
  settings: T,
  currency: string
): T {
  if (currency === settings.currency) return settings;
  const terms = allCurrencyTerms(settings).find(
    (entry) => entry.currency === currency
  );
  return terms
    ? { ...settings, ...terms, trialPlanId: terms.trialPlanId }
    : settings;
}

/** A plan made before plans had a currency is in INR. */
export const planCurrency = (plan: { currency?: string }) =>
  plan.currency ?? PLATFORM_CURRENCY;

/** An auto-recharge amount a company has not chosen: four minimum top-ups. */
export const defaultRechargeIn = (settings: { minTopUpMicros: number }) =>
  settings.minTopUpMicros * 4;

/** The bonus a new workspace's wallet starts with, per billing currency. */
export function welcomeBonusOf(
  settings: {
    welcomeBonus?: Array<{ currency: string; amountMicros: number }>;
  },
  currency: string
): number {
  const bonus = settings.welcomeBonus ?? DEFAULT_SETTINGS.welcomeBonus;
  return bonus.find((entry) => entry.currency === currency)?.amountMicros ?? 0;
}

/** An auto-recharge amount a company has not chosen yet. */
export const DEFAULT_RECHARGE_MICROS = toMicros(2000);

/** The most one wallet payment may be — a slipped digit, not a top-up. */
export const MAX_TOPUP_MICROS = toMicros(500_000);

/** The most extra agents one account may buy. */
export const MAX_EXTRA_AGENTS = 500;

/**
 * Above this, every card or UPI Autopay debit needs the customer's approval —
 * the opposite of automatic. It caps a saved mandate, and a plan dearer than
 * it is still sold but says so.
 */
export const APPROVAL_LIMIT_MICROS = toMicros(15_000);

/**
 * Every plan comes with the three desks — they are the platform, not an
 * add-on — so the features name them before the counts that differ.
 */
const DESKS = [
  "Front desk that answers first and routes every chat",
  "Follow-up desk that files leads and nudges quiet ones",
  "Marketing agent for festival and birthday greetings",
];

/**
 * A plan priced by the agent: what one custom agent and one human agent cost
 * a month, on top of the plan's own fee — usually none.
 */
export type PerAgentPrice = {
  aiMicros: number;
  aiListMicros: number;
  humanMicros: number;
  humanListMicros: number;
};

/** The agents a per-agent plan is bought for, beyond the ones it includes. */
export type AgentCounts = { ai: number; human: number };

export const PAY_AS_YOU_GO = "pay-as-you-go";

export const DEFAULT_PLANS: Array<{
  code: string;
  name: string;
  description: string;
  listPriceMicros: number;
  priceMicros: number;
  includedAiAgents: number;
  includedHumanAgents: number;
  perAgent?: PerAgentPrice;
  features: string[];
  highlighted: boolean;
}> = [
  {
    code: "starter",
    name: "Starter",
    description: "Everything a business needs to put its WhatsApp on agents.",
    listPriceMicros: toMicros(4999),
    priceMicros: toMicros(4999),
    includedAiAgents: 1,
    includedHumanAgents: 1,
    features: [
      ...DESKS,
      "1 custom agent, built around your business",
      "1 human agent with full access: the admin",
    ],
    highlighted: false,
  },
  {
    code: "growth",
    name: "Growth",
    description: "For a team with several desks and people on the inbox.",
    listPriceMicros: toMicros(11999),
    priceMicros: toMicros(9999),
    includedAiAgents: 5,
    includedHumanAgents: 3,
    features: [...DESKS, "5 custom agents", "3 human agents with full access, admin included"],
    highlighted: true,
  },
  {
    code: "scale",
    name: "Scale",
    description: "For a business running many lines of work on agents.",
    listPriceMicros: toMicros(24999),
    priceMicros: toMicros(19999),
    includedAiAgents: 15,
    includedHumanAgents: 10,
    features: [
      ...DESKS,
      "15 custom agents",
      "10 human agents with full access, admin included",
    ],
    highlighted: false,
  },
  {
    code: PAY_AS_YOU_GO,
    name: "Pay as you go",
    description: "No plan fee. Pay for each agent you put to work.",
    listPriceMicros: 0,
    priceMicros: 0,
    includedAiAgents: 0,
    includedHumanAgents: 1,
    perAgent: {
      aiMicros: toMicros(1999),
      aiListMicros: toMicros(1999),
      humanMicros: toMicros(499),
      humanListMicros: toMicros(499),
    },
    features: [
      "Your first AI agent runs the front desk",
      "The next two add the follow-up and marketing desks",
      "Every AI agent after that is a custom agent",
      "The admin's login free, more people as you need them",
    ],
    highlighted: false,
  },
];

/** USD prices for the plans a fresh catalogue starts with, by plan code. */
export const USD_PRICES: Record<string, { price: number; list: number }> = {
  starter: { price: 49, list: 49 },
  growth: { price: 99, list: 119 },
  scale: { price: 199, list: 249 },
};

/** USD prices for the per-agent plans a fresh catalogue starts with. */
export const USD_AGENT_PRICES: Record<string, { ai: number; human: number }> = {
  [PAY_AS_YOU_GO]: { ai: 20, human: 5 },
};

export const isPerAgent = (plan: { perAgent?: PerAgentPrice | null }) =>
  plan.perAgent != null;

/**
 * On a per-agent plan the AI agents paid for go to the desks first, in this
 * order, and only then to custom agents: one is the front desk alone, two
 * adds the follow-up desk, three the marketing desk, four the first custom
 * agent.
 */
export const DESK_ORDER = ["router", "follow_up", "marketing"] as const;
export type DeskKind = (typeof DESK_ORDER)[number];

export const DESK_NAMES: Record<DeskKind, string> = {
  router: "Front desk",
  follow_up: "Follow-up desk",
  marketing: "Marketing desk",
};

export const deskPaid = (kind: DeskKind, aiAgents: number) =>
  DESK_ORDER.indexOf(kind) < aiAgents;

/** "Front desk, follow-up desk + 2 custom agents" — what that many AI agents run. */
export function unlockedLine(aiAgents: number): string {
  const { desks, custom } = unlockedBy(aiAgents);
  if (desks.length === 0) return "Nothing yet — the first is the front desk";
  const names = desks.map((desk, index) =>
    index === 0 ? DESK_NAMES[desk] : DESK_NAMES[desk].toLowerCase()
  );
  const extra =
    custom > 0 ? ` + ${custom} custom agent${custom === 1 ? "" : "s"}` : "";
  return `${names.join(", ")}${extra}`;
}

/** What a number of paid AI agents switches on. */
export function unlockedBy(aiAgents: number): {
  desks: DeskKind[];
  custom: number;
} {
  const paid = Math.max(0, Math.floor(aiAgents));
  return {
    desks: DESK_ORDER.slice(0, paid),
    custom: Math.max(0, paid - DESK_ORDER.length),
  };
}

// --- Public pricing ------------------------------------------------------------

export type PublicPlan = Omit<(typeof DEFAULT_PLANS)[number], "description"> & {
  description?: string;
};

type CataloguePlan = PublicPlan & {
  currency?: string;
  status: "active" | "hidden";
};

export type CurrencyPricing = {
  currency: string;
  gstPercent: number;
  extraAgentListMicros: number;
  extraAgentPriceMicros: number;
  welcomeBonusMicros: number;
  aiReply: AiPrice | null;
  plans: PublicPlan[];
};

export type PublicPricing = {
  trialDays: number;
  currencies: CurrencyPricing[];
};

function startingCatalogue(): CataloguePlan[] {
  return DEFAULT_PLANS.flatMap((plan) => {
    const inr = { ...plan, currency: PLATFORM_CURRENCY, status: "active" as const };
    const usd = usdTwin(plan);
    return usd ? [inr, { ...inr, ...usd }] : [inr];
  });
}

/** A starting plan's USD prices, or null when it has none. */
export function usdTwin(plan: {
  code: string;
  perAgent?: PerAgentPrice;
}): {
  currency: string;
  priceMicros: number;
  listPriceMicros: number;
  perAgent?: PerAgentPrice;
} | null {
  if (plan.perAgent) {
    const usd = USD_AGENT_PRICES[plan.code];
    if (!usd) return null;
    return {
      currency: "USD",
      priceMicros: 0,
      listPriceMicros: 0,
      perAgent: {
        aiMicros: toMicros(usd.ai),
        aiListMicros: toMicros(usd.ai),
        humanMicros: toMicros(usd.human),
        humanListMicros: toMicros(usd.human),
      },
    };
  }
  const usd = USD_PRICES[plan.code];
  if (!usd) return null;
  return {
    currency: "USD",
    priceMicros: toMicros(usd.price),
    listPriceMicros: toMicros(Math.max(usd.list, usd.price)),
  };
}

/**
 * What the public pricing page shows: the plans on sale in each currency and
 * that currency's terms. Before billing is switched on, what it starts with.
 */
export function publicPricing(
  settings:
    | (TermsCarrier & {
        trialDays: number;
        welcomeBonus?: Array<{ currency: string; amountMicros: number }>;
      })
    | null,
  plans: CataloguePlan[],
  ai: AiPricingCard | null = null
): PublicPricing {
  if (!settings) {
    return publicPricing(
      { ...DEFAULT_SETTINGS, currencies: DEFAULT_CURRENCY_TERMS },
      startingCatalogue()
    );
  }
  const currencies = allCurrencyTerms(settings).flatMap((terms) => {
    const onSale = plans.filter(
      (plan) =>
        plan.status === "active" && planCurrency(plan) === terms.currency
    );
    if (onSale.length === 0) return [];
    return [
      {
        currency: terms.currency,
        gstPercent: terms.gstPercent,
        extraAgentListMicros: terms.extraAgentListMicros,
        extraAgentPriceMicros: terms.extraAgentPriceMicros,
        welcomeBonusMicros: welcomeBonusOf(settings, terms.currency),
        aiReply:
          (ai && aiPriceIn(ai, terms.currency)) ??
          aiPriceIn(DEFAULT_AI_PRICING, terms.currency),
        plans: onSale.map((plan) => ({
          code: plan.code,
          name: plan.name,
          description: plan.description,
          listPriceMicros: plan.listPriceMicros,
          priceMicros: plan.priceMicros,
          includedAiAgents: plan.includedAiAgents,
          includedHumanAgents: plan.includedHumanAgents,
          perAgent: plan.perAgent,
          features: plan.features,
          highlighted: plan.highlighted,
        })),
      },
    ];
  });
  return { trialDays: settings.trialDays, currencies };
}

// --- Pricing -----------------------------------------------------------------

export type PricingSettings = {
  gstPercent: number;
  extraAgentListMicros: number;
  extraAgentPriceMicros: number;
};

export type AccountPricing = {
  discountPercent?: number;
  discountFixedMicros?: number;
  extraAgentPriceMicros?: number;
};

export type Quote = {
  /** The plan's list price, before anything comes off. */
  planListMicros: number;
  /** The plan's price after this account's discount. */
  planMicros: number;
  /** What this account's own discount took off the plan. */
  discountMicros: number;
  discountKind: "percent" | "fixed" | null;
  discountPercent: number;
  extraAgents: number;
  /** One extra agent, at this account's price. */
  seatMicros: number;
  seatListMicros: number;
  seatsMicros: number;
  /** On a per-agent plan: each kind of agent bought, at this account's price. */
  perAgent: {
    ai: AgentLine;
    human: AgentLine;
  } | null;
  subtotalMicros: number;
  gstPercent: number;
  gstMicros: number;
  totalMicros: number;
};

export type AgentLine = {
  count: number;
  priceMicros: number;
  listMicros: number;
  totalMicros: number;
};

function agentLine(count: number, price: number, list: number): AgentLine {
  const priceMicros = roundToPaise(price);
  return {
    count,
    priceMicros,
    listMicros: Math.max(roundToPaise(list), priceMicros),
    totalMicros: priceMicros * count,
  };
}

const wholeCount = (value: number | undefined) =>
  Math.max(0, Math.floor(Number.isFinite(value) ? (value ?? 0) : 0));

/**
 * A month of the platform fee: the plan, less any discount this account has
 * been given, plus its extra agents, plus GST.
 *
 * A per-agent plan takes no extra agents: it is bought for a number of custom
 * and human agents instead, and the discount comes off the plan and its
 * agents together — on a plan with no fee, the agents are all there is.
 *
 * Each part is rounded to a paisa before it is added, so the parts on the
 * summary add up to the total the subscription charges.
 */
export function quote(args: {
  plan: {
    priceMicros: number;
    listPriceMicros: number;
    perAgent?: PerAgentPrice | null;
  };
  extraAgents: number;
  agents?: AgentCounts | null;
  settings: PricingSettings;
  account?: AccountPricing | null;
}): Quote {
  const per = args.plan.perAgent ?? null;
  const perAgent = per
    ? {
        ai: agentLine(wholeCount(args.agents?.ai), per.aiMicros, per.aiListMicros),
        human: agentLine(
          wholeCount(args.agents?.human),
          per.humanMicros,
          per.humanListMicros
        ),
      }
    : null;
  const agentsMicros = perAgent
    ? perAgent.ai.totalMicros + perAgent.human.totalMicros
    : 0;

  const fixedMicros = Math.max(0, args.account?.discountFixedMicros ?? 0);
  const discountPercent =
    fixedMicros > 0 ? 0 : clampPercent(args.account?.discountPercent ?? 0);
  const planListMicros = Math.max(
    args.plan.listPriceMicros,
    args.plan.priceMicros
  );
  const discountable = roundToPaise(args.plan.priceMicros) + agentsMicros;
  const discountMicros =
    fixedMicros > 0
      ? Math.min(roundToPaise(fixedMicros), discountable)
      : roundToPaise((discountable * discountPercent) / 100);
  const discountKind =
    fixedMicros > 0 ? "fixed" : discountPercent > 0 ? "percent" : null;
  const planMicros = roundToPaise(args.plan.priceMicros) - discountMicros;

  const extraAgents = perAgent ? 0 : wholeCount(args.extraAgents);
  const seatMicros = roundToPaise(
    args.account?.extraAgentPriceMicros ?? args.settings.extraAgentPriceMicros
  );
  const seatListMicros = Math.max(
    roundToPaise(args.settings.extraAgentListMicros),
    seatMicros
  );
  const seatsMicros = seatMicros * extraAgents;

  const subtotalMicros = planMicros + seatsMicros + agentsMicros;
  const gstMicros = roundToPaise(
    (subtotalMicros * args.settings.gstPercent) / 100
  );

  return {
    planListMicros,
    planMicros,
    discountMicros,
    discountKind,
    discountPercent,
    extraAgents,
    seatMicros,
    seatListMicros,
    seatsMicros,
    perAgent,
    subtotalMicros,
    gstPercent: args.settings.gstPercent,
    gstMicros,
    totalMicros: subtotalMicros + gstMicros,
  };
}

/** GST on a wallet payment. The credit is the amount; the tax rides on top. */
export function withGst(amountMicros: number, gstPercent: number) {
  const subtotalMicros = roundToPaise(amountMicros);
  const gstMicros = roundToPaise((subtotalMicros * gstPercent) / 100);
  return { subtotalMicros, gstMicros, totalMicros: subtotalMicros + gstMicros };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// --- Seats -------------------------------------------------------------------

export type SeatKind = "ai" | "human";

export type SeatUsage = {
  ai: { included: number; used: number };
  human: { included: number; used: number };
  /** Extra agents are one pool: each can be an AI agent or a human one. */
  extra: { bought: number; used: number };
  /** More live than the plan and its extras allow — after a downgrade. */
  over: number;
};

export function seatUsage(args: {
  includedAiAgents: number;
  includedHumanAgents: number;
  extraAgents: number;
  aiUsed: number;
  humanUsed: number;
}): SeatUsage {
  const aiOver = Math.max(0, args.aiUsed - args.includedAiAgents);
  const humanOver = Math.max(0, args.humanUsed - args.includedHumanAgents);
  const used = aiOver + humanOver;
  return {
    ai: { included: args.includedAiAgents, used: args.aiUsed },
    human: { included: args.includedHumanAgents, used: args.humanUsed },
    extra: { bought: args.extraAgents, used },
    over: Math.max(0, used - args.extraAgents),
  };
}

/** Whether one more agent of this kind fits. */
export function hasRoomFor(usage: SeatUsage, kind: SeatKind): boolean {
  const own = usage[kind];
  if (own.used < own.included) return true;
  return usage.extra.used < usage.extra.bought;
}

/**
 * The seats a plan gives this account. On a per-agent plan the agents it is
 * bought for are its own included ones, and there are no extras to share.
 */
export function seatsOf(
  plan: {
    includedAiAgents: number;
    includedHumanAgents: number;
    perAgent?: PerAgentPrice | null;
  },
  account: { extraAgents: number; agents?: AgentCounts } | null,
  used: { ai: number; human: number }
): SeatUsage {
  const bought = isPerAgent(plan) ? account?.agents : undefined;
  return seatUsage({
    includedAiAgents: plan.includedAiAgents + unlockedBy(bought?.ai ?? 0).custom,
    includedHumanAgents: plan.includedHumanAgents + (bought?.human ?? 0),
    extraAgents: isPerAgent(plan) ? 0 : (account?.extraAgents ?? 0),
    aiUsed: used.ai,
    humanUsed: used.human,
  });
}

/**
 * The fewest agents of each kind a per-agent plan needs for what is live now:
 * the front desk at least, and every desk before any custom agent.
 */
export function agentsNeeded(
  plan: { includedAiAgents: number; includedHumanAgents: number },
  used: { ai: number; human: number }
): AgentCounts {
  const custom = Math.max(0, used.ai - plan.includedAiAgents);
  return {
    ai: custom > 0 ? DESK_ORDER.length + custom : 1,
    human: Math.max(0, used.human - plan.includedHumanAgents),
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "Growth plan + 2 extra agents", "Pay as you go: 3 AI agents + 1 human agent". */
export function planLine(
  planName: string,
  extraAgents: number,
  agents?: AgentCounts | null
): string {
  if (agents) {
    const parts = [
      agents.ai > 0 ? plural(agents.ai, "AI agent") : null,
      agents.human > 0 ? plural(agents.human, "human agent") : null,
    ].filter(Boolean);
    return parts.length > 0 ? `${planName}: ${parts.join(" + ")}` : planName;
  }
  return extraAgents > 0
    ? `${planName} plan + ${plural(extraAgents, "extra agent")}`
    : `${planName} plan`;
}

/**
 * The fewest extra agents that cover what is live now. What the plan picker
 * starts on, so choosing a smaller plan does not strand anyone who is live.
 */
export function extrasNeeded(
  plan: { includedAiAgents: number; includedHumanAgents: number },
  used: { ai: number; human: number }
): number {
  return (
    Math.max(0, used.ai - plan.includedAiAgents) +
    Math.max(0, used.human - plan.includedHumanAgents)
  );
}

// --- Access ------------------------------------------------------------------

/**
 * Whether the dashboard is open.
 *
 * `open` means billing is not switched on at all. `grace` is a renewal that
 * failed and is being retried; the dashboard stays open through it and
 * locks when it runs out. Locking is the dashboard only — agents keep
 * answering customers whatever this says.
 */
export type AccessState = "open" | "trial" | "active" | "grace" | "locked";

export type Access = {
  state: AccessState;
  /** When the state next changes on its own, if it does. */
  until: number | null;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Razorpay's subscription statuses, in the words a company would use. */
export const SUBSCRIPTION_STATUS: Record<string, string> = {
  created: "Awaiting authorisation",
  authenticated: "Authorised",
  active: "Active",
  pending: "Payment retrying",
  halted: "Payment failed",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Completed",
  expired: "Expired",
};

/** Statuses in which a subscription grants its plan. */
export const LIVE_STATUSES: readonly string[] = ["authenticated", "active"];

export const isLiveStatus = (status: string) => LIVE_STATUSES.includes(status);

/** Razorpay wants a later start in the future, and not by a hair. */
export const START_LEAD_MS = 2 * 60 * 60 * 1000;

type Moment = number | null | undefined;

/**
 * Where a new subscription starts charging: where the account is already
 * paid up to — the live subscription's next charge, or the end of a trial or
 * of a cancelled month — so a change never charges twice for the same days.
 * Null means now.
 *
 * Shared so the checkout is created at the date the page promised.
 */
export function nextStartAt(args: {
  live: { chargeAt?: Moment; currentEnd?: Moment; startAt?: Moment } | null;
  access: Access;
  now: number;
}): number | null {
  const { live, access } = args;
  const paidThrough = live
    ? (live.chargeAt ?? live.currentEnd ?? live.startAt ?? null)
    : access.state === "trial" || access.state === "active"
      ? access.until
      : null;
  return paidThrough !== null && paidThrough > args.now + START_LEAD_MS
    ? paidThrough
    : null;
}

/** When the trial of a workspace with no account of its own ends. */
export function defaultTrialEnd(
  settings: { trialDays: number; launchedAt: number },
  workspaceCreatedAt: number
): number {
  return (
    Math.max(settings.launchedAt, workspaceCreatedAt) +
    settings.trialDays * DAY_MS
  );
}

export function accessOf(args: {
  settings: { trialDays: number; graceDays: number; launchedAt: number } | null;
  account: {
    mode: "trial" | "razorpay" | "manual";
    trialEndsAt?: number;
    manualPaidThrough?: number;
  } | null;
  subscription: {
    status: string;
    currentEnd?: number;
    chargeAt?: number;
    startAt?: number;
  } | null;
  workspaceCreatedAt: number;
  now: number;
}): Access {
  const { settings, account, subscription, now } = args;
  if (!settings) {
    return {
      state: "open",
      until: null,
      reason: "Billing is not switched on.",
    };
  }
  const grace = settings.graceDays * DAY_MS;

  if (account?.mode === "manual") {
    const through = account.manualPaidThrough;
    if (through === undefined) {
      return { state: "active", until: null, reason: "Billed by arrangement." };
    }
    if (now < through) {
      return {
        state: "active",
        until: through,
        reason: "Billed by arrangement.",
      };
    }
    if (now < through + grace) {
      return {
        state: "grace",
        until: through + grace,
        reason: "The arranged period has ended.",
      };
    }
    return {
      state: "locked",
      until: null,
      reason: "The arranged period has ended.",
    };
  }

  if (subscription) {
    const paidThrough =
      subscription.currentEnd ?? subscription.chargeAt ?? subscription.startAt;
    switch (subscription.status) {
      case "active":
      case "authenticated":
        return {
          state: "active",
          until: paidThrough ?? null,
          reason: "Your plan is active.",
        };
      case "pending":
      case "halted": {
        const lockAt = (paidThrough ?? now) + grace;
        if (now < lockAt) {
          return {
            state: "grace",
            until: lockAt,
            reason:
              subscription.status === "pending"
                ? "Your last payment did not go through, and Razorpay is retrying it."
                : "Your payment failed and the subscription has stopped.",
          };
        }
        return { state: "locked", until: null, reason: "Your payment failed." };
      }
      case "cancelled":
      case "completed":
      case "expired":
      case "paused":
        if (paidThrough !== undefined && now < paidThrough) {
          return {
            state: "active",
            until: paidThrough,
            reason: "Your plan ends at the close of the period you paid for.",
          };
        }
        break;
      // "created" is a checkout that was never finished; it grants nothing.
    }
  }

  const trialEnd =
    account?.trialEndsAt ?? defaultTrialEnd(settings, args.workspaceCreatedAt);
  if (now < trialEnd) {
    return {
      state: "trial",
      until: trialEnd,
      reason: "You are on a free trial.",
    };
  }
  return {
    state: "locked",
    until: null,
    reason: subscription
      ? "Your plan has ended."
      : "Your free trial has ended.",
  };
}

/** Whether the dashboard should open. Only a lapsed account is shut out. */
export const isLocked = (access: Access) => access.state === "locked";

// --- Tax details ---------------------------------------------------------------

/** 15 characters: state code, PAN, entity number, Z, checksum. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(value: string): boolean {
  return GSTIN.test(value.trim().toUpperCase());
}
