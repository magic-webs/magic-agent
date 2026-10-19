import Link from "next/link";
import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { Logo } from "@/components/logo";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Reveal } from "@/components/landing/reveal";
import { SiteNav } from "@/components/landing/site-nav";
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
import { cn } from "@/lib/utils";
import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr";

const display = Instrument_Sans({ subsets: ["latin"], variable: "--font-display" });

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

const CONTAINER = "mx-auto w-full max-w-[1200px] px-4 sm:px-6";
const SECTION = "py-[clamp(5rem,11vw,9rem)]";

function Eyebrow({ index, children }: { index?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs tracking-[0.12em] text-(--ink-muted) uppercase">
      {index && <span className="font-mono tracking-normal">{index}</span>}
      <span>{children}</span>
      <span className="h-px flex-1 bg-(--line)" />
    </div>
  );
}

const PILL =
  "group inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium transition duration-300 hover:-translate-y-0.5";

export default function LandingPage() {
  return (
    <SmoothScroll>
      <noscript>
        <style>
          {"[data-reveal],[data-fade],[data-word]{opacity:1!important}[data-line]{transform:none!important}"}
        </style>
      </noscript>

      <div className={cn("landing flex min-h-svh flex-col bg-(--paper) text-(--ink)", display.variable)}>
        <SiteNav />

        <main>
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
        </main>

        <footer className="bg-[#1a1918] text-white">
          <div className={cn(CONTAINER, "pt-6 pb-10")}>
            <div className="grid gap-10 border-t border-white/10 pt-12 md:grid-cols-[1.4fr_1fr_1fr]">
              <div className="flex flex-col gap-4">
                <span className="flex items-center gap-2">
                  <Logo className="h-7" />
                  <span className="font-display text-lg font-semibold tracking-tight">Magic Agent</span>
                </span>
                <p className="max-w-xs text-sm leading-relaxed text-white/60">
                  AI agents that answer your customers on WhatsApp, Instagram and web chat.
                </p>
                <a href="mailto:support@magicwebs.ai" className="text-sm text-white hover:underline">
                  support@magicwebs.ai
                </a>
              </div>
              <nav className="flex flex-col gap-3 text-sm text-white/60">
                <span className="text-xs tracking-[0.12em] text-white/40 uppercase">Product</span>
                <a href="#work" className="hover:text-white">How it works</a>
                <a href="#use-cases" className="hover:text-white">Use cases</a>
                <a href="#templates" className="hover:text-white">Templates</a>
                <Link href="/login" className="hover:text-white">Sign in</Link>
              </nav>
              {/* The store listing points at these, so they must stay reachable from the front page. */}
              <nav className="flex flex-col gap-3 text-sm text-white/60">
                <span className="text-xs tracking-[0.12em] text-white/40 uppercase">Company</span>
                <Link href="/support" className="hover:text-white">Support</Link>
                <Link href="/privacy" className="hover:text-white">Privacy</Link>
                <Link href="/terms" className="hover:text-white">Terms</Link>
                <Link href="/delete-account" className="hover:text-white">Delete account</Link>
              </nav>
            </div>
            <p className="mt-14 text-xs text-white/40">© 2026 Magic Agent</p>
          </div>
        </footer>
      </div>
    </SmoothScroll>
  );
}
