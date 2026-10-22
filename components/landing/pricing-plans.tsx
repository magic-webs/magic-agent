"use client";

import { useState, useSyncExternalStore } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { isIndian } from "@/convex/lib/currency";
import type { CurrencyPricing, PublicPlan, PublicPricing } from "@/convex/lib/plans";
import { currencySymbol, moneyIn } from "@/components/billing/plan-bits";
import { SpecularButton } from "@/components/landing/specular-button";
import { cn } from "@/lib/utils";

const DESKS = 3;

const EVERY_PLAN = [
  "Front desk, follow-up desk and marketing agent",
  "WhatsApp, Instagram, Telegram, RCS and web chat",
  "Product catalogue, orders and record books",
  "Knowledge base and custom tools",
  "Lead pipeline with automatic follow-ups",
  "Google Sheets, Calendar and Drive",
];

const noSubscribe = () => () => {};
const localCurrency = () =>
  isIndian({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) ? "INR" : "USD";

export function PricingPlans({
  pricing,
  compareHeading,
}: {
  pricing: PublicPricing;
  /** Shown above a plan-by-plan table, which is left out without it. */
  compareHeading?: React.ReactNode;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const local = useSyncExternalStore(noSubscribe, localCurrency, () => null);
  const offer =
    pricing.currencies.find((entry) => entry.currency === (chosen ?? local)) ??
    pricing.currencies[0];
  if (!offer) return null;

  const money = moneyIn(offer.currency);
  const gst = offer.gstPercent > 0 ? ` + ${offer.gstPercent}% GST` : "";

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {pricing.currencies.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Currency"
            className="inline-flex rounded-full border border-(--line) bg-(--surface) p-1 text-sm"
          >
            {pricing.currencies.map((entry) => {
              const active = entry.currency === offer.currency;
              return (
                <button
                  key={entry.currency}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChosen(entry.currency)}
                  className={cn(
                    "h-9 rounded-full px-4 font-medium transition-colors",
                    active ? "bg-(--ink) text-(--paper)" : "text-(--ink-muted) hover:text-(--ink)"
                  )}
                >
                  {currencySymbol(entry.currency)} {entry.currency}
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        <span className="text-sm text-(--ink-muted)">
          Billed monthly · {pricing.trialDays}-day free trial, no card needed
        </span>
      </div>

      <div className="mt-8 grid gap-4 md:auto-cols-fr md:grid-flow-col">
        {offer.plans.map((plan) => (
          <PlanCard key={plan.code} plan={plan} offer={offer} />
        ))}
      </div>

      <p className="mt-8 text-center text-sm leading-relaxed text-(--ink-muted)">
        Extra agents {money(offer.extraAgentPriceMicros)} a month each{gst}. WhatsApp
        messages and AI replies are paid from a prepaid wallet at per-message rates
        {offer.welcomeBonusMicros > 0
          ? `, and every new wallet starts with ${money(offer.welcomeBonusMicros)} of credit.`
          : "."}
      </p>

      {compareHeading ? (
        <div className="mt-[clamp(5rem,10vw,8rem)] flex flex-col gap-10">
          {compareHeading}
          <CompareTable offer={offer} trialDays={pricing.trialDays} />
        </div>
      ) : null}
    </div>
  );
}

function PlanCard({ plan, offer }: { plan: PublicPlan; offer: CurrencyPricing }) {
  const money = moneyIn(offer.currency);
  const featured = plan.highlighted;
  const muted = featured ? "text-(--paper)/65" : "text-(--ink-muted)";

  return (
    <article
      className={cn(
        "flex flex-col gap-6 rounded-[24px] border p-7",
        featured
          ? "border-transparent bg-(--ink) text-(--paper) shadow-[0_30px_60px_-35px_rgb(20_40_80/0.55)]"
          : "border-(--line) bg-(--surface)"
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-2xl font-medium tracking-tight">{plan.name}</h3>
          {featured ? (
            <span className="rounded-full bg-(--paper)/12 px-3 py-1 text-xs font-medium">
              Most popular
            </span>
          ) : null}
        </div>
        {plan.description ? (
          <p className={cn("text-[15px] leading-relaxed", muted)}>{plan.description}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {plan.listPriceMicros > plan.priceMicros ? (
            <span className={cn("text-lg line-through", muted)}>{money(plan.listPriceMicros)}</span>
          ) : null}
          <span className="font-display text-[clamp(2.5rem,4vw,3.25rem)] leading-none font-medium tracking-[-0.03em] tabular-nums">
            {money(plan.priceMicros)}
          </span>
          <span className={muted}>/month</span>
        </div>
        <span className={cn("text-sm", muted)}>
          {offer.gstPercent > 0 ? `Plus ${offer.gstPercent}% GST` : "Billed monthly"}
        </span>
      </div>

      <SpecularButton
        href="/signup"
        radius={999}
        tint={featured ? "var(--paper)" : "var(--ink)"}
        tintOpacity={1}
        textColor={featured ? "var(--ink)" : "var(--paper)"}
        lineColor="#10b981"
        autoAnimate
        className="h-12 px-6 py-0 text-[15px]"
      >
        Start free trial
      </SpecularButton>

      <ul className="flex flex-col gap-2.5 border-t border-current/10 pt-6 text-[15px]">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-(--ok-soft) text-(--ok)">
              <CheckIcon weight="bold" className="size-3" />
            </span>
            {feature}
          </li>
        ))}
      </ul>
    </article>
  );
}

function CompareTable({ offer, trialDays }: { offer: CurrencyPricing; trialDays: number }) {
  const money = moneyIn(offer.currency);
  const rows: Array<{ label: string; value: (plan: PublicPlan) => React.ReactNode }> = [
    { label: "Price a month", value: (plan) => money(plan.priceMicros) },
    { label: "AI agents", value: (plan) => DESKS + plan.includedAiAgents },
    { label: "Custom agents", value: (plan) => plan.includedAiAgents },
    { label: "Human agents with full access", value: (plan) => plan.includedHumanAgents },
    { label: "Extra agents", value: () => `${money(offer.extraAgentPriceMicros)} each` },
    ...EVERY_PLAN.map((label) => ({ label, value: () => <Tick /> })),
    { label: "Free trial", value: () => `${trialDays} days` },
  ];

  return (
    <div className="overflow-x-auto rounded-[24px] border border-(--line) bg-(--surface)">
      <table className="w-full min-w-160 border-collapse text-left text-[15px]">
        <thead>
          <tr className="border-b border-(--line)">
            <th scope="col" className="w-[34%] px-6 py-5 font-normal text-(--ink-muted)">
              Prices in {offer.currency}
              {offer.gstPercent > 0 ? `, plus ${offer.gstPercent}% GST` : ""}
            </th>
            {offer.plans.map((plan) => (
              <th
                key={plan.code}
                scope="col"
                className={cn(
                  "px-6 py-5 font-display text-xl font-medium tracking-tight",
                  plan.highlighted && "bg-(--ink)/4"
                )}
              >
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-(--line) last:border-b-0">
              <th scope="row" className="px-6 py-4 font-normal text-(--ink-muted)">
                {row.label}
              </th>
              {offer.plans.map((plan) => (
                <td
                  key={plan.code}
                  className={cn("px-6 py-4 tabular-nums", plan.highlighted && "bg-(--ink)/4")}
                >
                  {row.value(plan)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tick() {
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-(--ok-soft) text-(--ok)">
      <CheckIcon weight="bold" className="size-3" aria-label="Included" />
    </span>
  );
}
