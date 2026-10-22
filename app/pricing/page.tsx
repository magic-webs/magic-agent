import type { Metadata } from "next";
import { PLATFORM_CURRENCY, PLATFORM_LOCALE, type PublicPricing } from "@/convex/lib/plans";
import { LandingShell } from "@/components/landing/landing-shell";
import { CONTAINER, Eyebrow, SECTION } from "@/components/landing/bits";
import { MaskLines } from "@/components/landing/mask-lines";
import { Reveal } from "@/components/landing/reveal";
import { PricingPlans } from "@/components/landing/pricing-plans";
import { ClosingPanel } from "@/components/landing/closing-panel";
import { StoreBadges } from "@/components/landing/store-badges";
import { SpecularButton } from "@/components/landing/specular-button";
import { loadPricing } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Pricing — Magic Agent",
  description:
    "Monthly plans for AI agents on WhatsApp, Instagram and web chat, in rupees or US dollars. Every plan has every channel and feature, with a free trial and no card needed.",
};

function whole(micros: number, currency: string): string {
  return new Intl.NumberFormat(currency === PLATFORM_CURRENCY ? PLATFORM_LOCALE : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(micros / 1_000_000);
}

function inEach(pricing: PublicPricing, pick: (entry: PublicPricing["currencies"][number]) => number) {
  return pricing.currencies.map((entry) => whole(pick(entry), entry.currency)).join(" or ");
}

function fraction(micros: number, currency: string): string {
  return new Intl.NumberFormat(currency === PLATFORM_CURRENCY ? PLATFORM_LOCALE : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(micros / 1_000_000);
}

function aiReplyAnswer(pricing: PublicPricing): string | null {
  const priced = pricing.currencies.flatMap((entry) =>
    entry.aiReply ? [{ currency: entry.currency, ...entry.aiReply }] : []
  );
  if (priced.length === 0) return null;
  const first = priced.map((entry) => fraction(entry.firstMicros, entry.currency)).join(" or ");
  const cap = priced.map((entry) => fraction(entry.capMicros, entry.currency)).join(" or ");
  return `From the same wallet, on every channel. The first reply in a conversation costs ${first}, and each one after costs a little more, up to ${cap} from reply ${priced[0].rampReplies} onward. On WhatsApp, Meta's charge for the message is added on top.`;
}

function questions(pricing: PublicPricing) {
  const gst = pricing.currencies.find((entry) => entry.gstPercent > 0)?.gstPercent;
  const bonus = pricing.currencies.some((entry) => entry.welcomeBonusMicros > 0)
    ? ` Every new wallet starts with ${inEach(pricing, (entry) => entry.welcomeBonusMicros)} of credit.`
    : "";
  const aiReply = aiReplyAnswer(pricing);
  return [
    {
      question: "How does the free trial work?",
      answer: `Every new workspace gets ${pricing.trialDays} days of the full product, with no card needed. Choose a plan before the trial ends to carry on.`,
    },
    {
      question: "Which currency will I pay in?",
      answer: `Businesses in India pay in rupees${gst ? `, with ${gst}% GST added` : ""}. Everywhere else pays in US dollars. We pick it from your workspace's country and time zone.`,
    },
    {
      question: "What counts as an agent?",
      answer: `Every plan includes the front desk, the follow-up desk and the marketing agent. Custom agents are the ones you build around your business: sales, support, bookings. Human agents are the people on your team who work the inbox. Need more of either? Extra agents are ${inEach(pricing, (entry) => entry.extraAgentPriceMicros)} a month each, and each one can be an AI agent or a person.`,
    },
    {
      question: "How are WhatsApp messages charged?",
      answer: `Separately from the plan, from a prepaid wallet. Meta prices each message by its type and the country of the number it goes to, and the wallet pays for each one as it is sent. Top up whenever you like, or let it recharge itself when the balance runs low.${bonus}`,
    },
    ...(aiReply
      ? [{ question: "What does an AI reply cost?", answer: aiReply }]
      : []),
    {
      question: "Can I change or cancel my plan?",
      answer:
        "Yes. A new plan starts from your next billing date, so you are never charged twice for the same days. If you cancel, your plan runs to the end of the month you have paid for.",
    },
    {
      question: "How do I pay?",
      answer:
        "Plans renew monthly through Razorpay, by card, or by UPI Autopay in India. Wallet top-ups go through Razorpay too.",
    },
  ];
}

export default async function PricingPage() {
  const pricing = await loadPricing();

  return (
    <LandingShell>
      <section className={cn(CONTAINER, "pt-[clamp(8rem,16vw,12rem)] pb-[clamp(4rem,8vw,6rem)]")}>
        <Eyebrow>Pricing</Eyebrow>
        <MaskLines
          className="mt-7 text-[clamp(2.75rem,7vw,6rem)]"
          lines={["One price a month.", "Every feature in it."]}
        />
        <Reveal className="mt-7 flex">
          <p className="max-w-[600px] text-[20px] leading-[30px] text-(--ink-muted) max-[600px]:text-base max-[600px]:leading-6">
            Plans differ only in how many agents they hold. Every channel, every desk and every
            tool is on all of them, and the first {pricing.trialDays} days are free.
          </p>
        </Reveal>

        <Reveal className="mt-14" distance={32}>
          <PricingPlans
            pricing={pricing}
            compareHeading={
              <div className="flex flex-col gap-7">
                <Eyebrow index="01">Compare</Eyebrow>
                <MaskLines lines={["Plan by plan."]} />
              </div>
            }
          />
        </Reveal>
      </section>

      <section className={cn(CONTAINER, SECTION, "pt-0")}>
        <Eyebrow index="02">Questions</Eyebrow>
        <MaskLines className="mt-7" lines={["Billing, answered."]} />
        <div className="mt-14 border-t border-(--line)">
          {questions(pricing).map(({ question, answer }) => (
            <details key={question} className="group border-b border-(--line)">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 font-display text-[clamp(1.125rem,2vw,1.375rem)] font-medium tracking-tight [&::-webkit-details-marker]:hidden">
                {question}
                <PlusIcon className="size-5 shrink-0 text-(--ink-muted) transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="max-w-[720px] pb-7 text-[17px] leading-relaxed text-(--ink-muted)">{answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-10 text-[15px] text-(--ink-muted)">
          Something else?{" "}
          <a href="mailto:support@magicwebs.ai" className="text-(--ink) underline-offset-4 hover:underline">
            support@magicwebs.ai
          </a>
        </p>
      </section>

      <ClosingPanel lines={["Try it free", `for ${pricing.trialDays} days.`]}>
        <p data-fade className="max-w-md text-[clamp(1rem,1.5vw,1.25rem)] leading-relaxed text-white/90">
          Describe your business, add your price list, connect WhatsApp. Choose a plan when you are ready.
        </p>
        <div data-fade>
          <SpecularButton href="/signup" size="md" radius={999} tintOpacity={0.08} blur={12} lineColor="#10b981" autoAnimate className="group">
            Start free trial
            <ArrowRightIcon weight="bold" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </SpecularButton>
        </div>
        <div data-fade>
          <StoreBadges className="justify-center" />
        </div>
      </ClosingPanel>
    </LandingShell>
  );
}
