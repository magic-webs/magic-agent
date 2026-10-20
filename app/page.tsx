import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/landing/reveal";
import { LandingShell } from "@/components/landing/landing-shell";
import { CONTAINER, Eyebrow, PILL, SECTION } from "@/components/landing/bits";
import { PricingPlans } from "@/components/landing/pricing-plans";
import { AgentRingHero } from "@/components/landing/agent-ring-hero";
import { ScrollWords } from "@/components/landing/scroll-words";
import { PromptBox } from "@/components/landing/prompt-box";
import { UseCases } from "@/components/landing/use-cases";
import { ChannelMark, type ChannelKind } from "@/components/channel-mark";
import {
  GoogleCalendarIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
} from "@/components/integrations/google-icons";
import { MaskLines } from "@/components/landing/mask-lines";
import { ChatScene, EnquiryScene, InsightScene } from "@/components/landing/scenes";
import { TemplateRail } from "@/components/landing/template-rail";
import { ClosingPanel } from "@/components/landing/closing-panel";
import { loadPricing } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Magic Agent — AI agents that answer your customers",
  description:
    "AI agents that answer your customers on WhatsApp, Instagram and web chat from your own prices and policies, collect every detail your team needs, and hand you a finished enquiry.",
};

const FEATURES = [
  {
    eyebrow: "Answers",
    title: ["Replies in seconds,", "from your price list."],
    body: "It works from your catalogue, your policies and your documents. Not the internet, and never a guess.",
    points: [
      "Quotes only the prices you have stored",
      "Lead times only from what you told it",
      "Your tone, your name, your rules",
    ],
    Scene: ChatScene,
  },
  {
    eyebrow: "Collects",
    title: ["Asks what your", "team would ask."],
    body: "Size, quantity, finish, delivery: one question at a time until nothing is missing, then a structured enquiry lands with your team.",
    points: [
      "Fields you define, per record type",
      "Orders, bookings, quotes and leads",
      "Handed over with a summary",
    ],
    Scene: EnquiryScene,
  },
  {
    eyebrow: "Reports",
    title: ["See what's coming in,", "as it comes in."],
    body: "Every conversation is filed at a stage, followed up when it goes quiet, and counted, so you know what the week looks like.",
    points: [
      "A pipeline that files itself",
      "Gentle follow-ups when a lead goes quiet",
      "Every channel in one inbox",
    ],
    Scene: InsightScene,
  },
];

const HERO_CHANNELS: ChannelKind[] = ["whatsapp", "instagram", "telegram", "rcs", "web"];

export default async function LandingPage() {
  const pricing = await loadPricing();

  return (
    <LandingShell>
      <AgentRingHero
        lines={["Every customer,", "answered in seconds"]}
        action={
          <Link href="/login" className={cn(PILL, "h-[52px] bg-(--ink) px-8 text-[17px] text-(--paper)")}>
            Create your agent
          </Link>
        }
        channels={
          <span className="flex items-center gap-3 text-[15px] text-(--ink-muted)">
            Answers on
            <span className="flex items-center gap-2">
              {HERO_CHANNELS.map((channel) => (
                <ChannelMark key={channel} type={channel} size={24} className="rounded-[7px]" />
              ))}
            </span>
          </span>
        }
        worksWith={
          <span className="flex items-center gap-4 text-[15px] text-(--ink-muted)">
            Works with
            <GoogleSheetsIcon className="size-6" />
            <GoogleCalendarIcon className="size-6" />
            <GoogleDriveIcon className="size-6" />
            <span>+ your own tools</span>
          </span>
        }
      />

      <section className={cn(CONTAINER, "flex flex-col items-center gap-7 pt-[clamp(4rem,9vw,7rem)] text-center")}>
        <MaskLines lines={["Describe the job.", "We'll draft the agent."]} />
        <Reveal className="flex w-full justify-center">
          <p className="w-[640px] max-w-full text-[20px] leading-[30px] text-(--ink-muted) max-[600px]:text-base max-[600px]:leading-6">
            Say what your business does and what customers ask. Magic Agent drafts the
            agent, its questions and its rules for you to check before it goes live.
          </p>
        </Reveal>
        <Reveal className="mt-3 w-full" distance={32}>
          <PromptBox />
        </Reveal>
      </section>

      <section className={cn(CONTAINER, "py-[clamp(6rem,14vw,12rem)]")}>
        <ScrollWords
          className="mx-auto max-w-[1000px] text-center"
          text="Your customers message at midnight, on Sundays and in the middle of your busiest hour. Magic Agent answers every one of them from your own prices and policies, asks what your team needs to know, and hands over a finished enquiry."
        />
      </section>

      <section id="work" className={cn(CONTAINER, SECTION, "flex flex-col gap-[clamp(5rem,10vw,8rem)]")}>
        {FEATURES.map(({ eyebrow, title, body, points, Scene }, index) => (
          <div key={eyebrow} className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div className={cn("flex flex-col gap-7", index % 2 === 1 && "md:order-2")}>
              <Eyebrow index={String(index + 1).padStart(2, "0")}>{eyebrow}</Eyebrow>
              <MaskLines lines={title} />
              <Reveal className="flex flex-col gap-6" stagger>
                <p className="max-w-md text-[17px] leading-relaxed text-(--ink-muted)">{body}</p>
                <ul className="flex flex-col gap-2.5 text-[15px]">
                  {points.map((point) => (
                    <li key={point} className="flex items-center gap-2.5">
                      <span className="flex size-5 items-center justify-center rounded-full bg-(--ok-soft) text-(--ok)">
                        <CheckIcon weight="bold" className="size-3" />
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>

            <div className="stage-mesh relative flex min-h-[460px] items-center justify-center overflow-hidden rounded-[28px] border border-(--line) px-5 py-12 sm:px-10 sm:py-16">
              <div className="bg-dots absolute inset-0" />
              <div className="relative flex w-full justify-center">
                <Scene />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section id="use-cases" className={cn(CONTAINER, SECTION, "pt-0")}>
        <Eyebrow index="04">Use cases</Eyebrow>
        <MaskLines className="mt-7" lines={["Built for the way", "you already sell."]} />
        <div className="mt-14">
          <UseCases />
        </div>
      </section>

      <section id="templates">
        <TemplateRail
          heading={
            <div className="flex min-w-0 flex-1 flex-col gap-7">
              <Eyebrow index="05">Templates</Eyebrow>
              <MaskLines lines={["Start from a", "working agent."]} />
            </div>
          }
        />
      </section>

      <section id="pricing" className={cn(CONTAINER, SECTION)}>
        <Eyebrow index="06">Pricing</Eyebrow>
        <div className="mt-7 flex flex-wrap items-end justify-between gap-6">
          <MaskLines lines={["Plans that grow", "with your team."]} />
          <Link
            href="/pricing"
            className="group inline-flex items-center gap-2 text-[15px] font-medium hover:underline"
          >
            Compare every plan
            <ArrowRightIcon weight="bold" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <Reveal className="mt-14" distance={32}>
          <PricingPlans pricing={pricing} />
        </Reveal>
      </section>

      <ClosingPanel lines={["Never miss", "a message."]}>
        <p data-fade className="max-w-md text-[clamp(1rem,1.5vw,1.25rem)] leading-relaxed text-white/90">
          Describe your business, add your price list, connect WhatsApp. Live this afternoon.
        </p>
        <Link
          data-fade
          href="/login"
          className={cn(PILL, "bg-white text-[#1c1b19] shadow-[0_10px_30px_-10px_rgb(0_20_60/0.4)]")}
        >
          Get started
          <ArrowRightIcon weight="bold" className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </ClosingPanel>
    </LandingShell>
  );
}
