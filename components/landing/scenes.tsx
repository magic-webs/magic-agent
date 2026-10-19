"use client";

import { useRef } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  LightningIcon,
  StorefrontIcon,
} from "@phosphor-icons/react";
import { ChannelMark } from "@/components/channel-mark";
import { countUp, useScene, type Select } from "@/components/landing/use-scene";

const CARD =
  "w-full overflow-hidden rounded-[22px] border border-(--line) bg-(--surface) text-(--ink) shadow-[0_40px_80px_-40px_rgb(20_40_80/0.45)]";

const REPLY =
  "Happy to help! 500 matte cards are ₹1,250 on our price list. Standard turnaround is three working days, so Friday works. Shall I send the artwork specs?";

function ThinkingMark() {
  return (
    <span className="grid size-3.5 grid-cols-2 gap-[2px]">
      {[0, 0.15, 0.45, 0.3].map((delay) => (
        <span
          key={delay}
          className="animate-petal rounded-full bg-(--ok)"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  );
}

function buildChat(timeline: gsap.core.Timeline, select: Select) {
  const [typed] = select("[data-typed]");
  const full = typed.dataset.typed ?? "";
  const state = { length: 0 };
  typed.textContent = "";

  timeline
    .from(select("[data-card]"), { y: 48, opacity: 0, duration: 0.9, ease: "power3.out" })
    .from(
      select("[data-in]"),
      {
        y: 14,
        scale: 0.94,
        opacity: 0,
        transformOrigin: "left bottom",
        duration: 0.55,
        ease: "back.out(1.7)",
      },
      "-=0.3"
    )
    .to(select("[data-thinking]"), { opacity: 1, duration: 0.3 }, "+=0.35")
    .to(select("[data-thinking]"), { opacity: 0, duration: 0.25 }, "+=1.4")
    .from(select("[data-out]"), {
      y: 14,
      scale: 0.94,
      opacity: 0,
      transformOrigin: "right bottom",
      duration: 0.55,
      ease: "back.out(1.7)",
    })
    .to(
      state,
      {
        length: full.length,
        duration: 2.2,
        ease: "none",
        onUpdate: () => {
          typed.textContent = full.slice(0, Math.round(state.length));
        },
      },
      "-=0.3"
    )
    .from(select("[data-foot]"), { opacity: 0, y: 8, duration: 0.5 }, "-=0.1");
}

export function ChatScene() {
  const ref = useRef<HTMLDivElement>(null);
  useScene(ref, buildChat);

  return (
    <div ref={ref} className="w-full max-w-[420px]">
      <div data-card className={CARD}>
        <div className="flex items-center gap-3 border-b border-(--line) px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-(--ok-soft) text-(--ok)">
            <StorefrontIcon weight="fill" className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Shree Prints</p>
            <p className="text-xs text-(--ink-muted)">Assistant · replies instantly</p>
          </div>
          <ChannelMark type="whatsapp" size={22} />
        </div>

        <div className="flex flex-col gap-3 px-4 py-5 text-[13.5px] leading-snug">
          <div
            data-in
            className="max-w-[84%] self-start rounded-2xl rounded-tl-md bg-(--paper) px-3.5 py-2.5"
          >
            Hi! Need 500 visiting cards, matte finish. Can you deliver by Friday?
          </div>

          <div className="grid justify-items-end">
            <div
              data-thinking
              className="flex items-center gap-2 self-start rounded-full bg-(--paper) px-3 py-2 text-xs text-(--ink-muted) opacity-0 [grid-area:1/1]"
            >
              <ThinkingMark />
              Thinking…
            </div>
            <div
              data-out
              className="grid max-w-[88%] rounded-2xl rounded-tr-md bg-(--ok) px-3.5 py-2.5 text-white [grid-area:1/1]"
            >
              <span className="invisible [grid-area:1/1]">{REPLY}</span>
              <span data-typed={REPLY} className="[grid-area:1/1]">
                {REPLY}
              </span>
            </div>
          </div>
        </div>

        <div
          data-foot
          className="flex items-center gap-1.5 border-t border-(--line) px-4 py-3 text-xs text-(--ink-muted)"
        >
          <LightningIcon weight="fill" className="size-3.5 text-amber-500" />
          Answered in 4 seconds, from your own price list
        </div>
      </div>
    </div>
  );
}

const FIELDS = [
  ["Product", "Visiting cards"],
  ["Quantity", "500"],
  ["Finish", "Matte, 350 gsm"],
  ["Artwork", "Customer uploads PDF"],
  ["Delivery", "Pune, by Friday"],
];

const STEP = 0.32;

function buildEnquiry(timeline: gsap.core.Timeline, select: Select) {
  timeline
    .from(select("[data-card]"), { y: 48, opacity: 0, duration: 0.9, ease: "power3.out" })
    .addLabel("rows", "-=0.3")
    .from(
      select("[data-row]"),
      { opacity: 0, x: -14, duration: 0.45, stagger: STEP, ease: "power2.out" },
      "rows"
    )
    .from(
      select("[data-check]"),
      { scale: 0, duration: 0.45, stagger: STEP, ease: "back.out(2.4)" },
      "rows+=0.2"
    )
    .from(
      select("[data-bar]"),
      { scaleX: 0, duration: STEP * FIELDS.length + 0.3, ease: "none" },
      "rows"
    );
  countUp(timeline, select("[data-count]"), STEP * FIELDS.length + 0.3, "rows");
  timeline
    .from(select("[data-pill]"), {
      scale: 0.7,
      opacity: 0,
      duration: 0.5,
      ease: "back.out(2)",
    })
    .from(select("[data-handoff]"), { opacity: 0, y: 8, duration: 0.5 }, "-=0.2");
}

export function EnquiryScene() {
  const ref = useRef<HTMLDivElement>(null);
  useScene(ref, buildEnquiry);

  return (
    <div ref={ref} className="w-full max-w-[420px]">
      <div data-card className={CARD}>
        <div className="flex items-center justify-between px-5 pt-5 text-[11px] font-semibold tracking-[0.1em] text-(--ink-muted) uppercase">
          New enquiry
          <span className="font-normal tracking-normal normal-case">Today · 11:42</span>
        </div>

        <div className="flex items-center gap-3 px-5 pt-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-[#e9e3f7] text-sm font-semibold text-[#5b43a8] dark:bg-[#2a2341] dark:text-[#c3b5f2]">
            RK
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Rohan Kulkarni</p>
            <p className="flex items-center gap-1.5 text-xs text-(--ink-muted)">
              <ChannelMark type="whatsapp" size={14} /> +91 98••• ••410
            </p>
          </div>
        </div>

        <div className="px-5 pt-5">
          <div className="flex items-center justify-between text-xs text-(--ink-muted)">
            <span>
              <span data-count={FIELDS.length}>{FIELDS.length}</span> of {FIELDS.length}{" "}
              details collected
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--paper)">
            <div data-bar className="h-full origin-left rounded-full bg-(--ok)" />
          </div>
        </div>

        <ul className="mt-4 flex flex-col px-5">
          {FIELDS.map(([label, value]) => (
            <li
              key={label}
              data-row
              className="flex items-center gap-3 border-t border-(--line) py-2.5 text-[13.5px]"
            >
              <span className="w-20 shrink-0 text-(--ink-muted)">{label}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{value}</span>
              <span
                data-check
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--ok) text-white"
              >
                <CheckIcon weight="bold" className="size-3" />
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-5 py-4">
          <span
            data-pill
            className="rounded-full bg-(--ok-soft) px-3 py-1 text-xs font-semibold text-(--ok)"
          >
            Ready to quote
          </span>
          <span data-handoff className="flex items-center gap-2 text-xs text-(--ink-muted)">
            <span className="flex -space-x-1.5">
              {["#f5c9a8", "#b9d6f2", "#cde8c4"].map((color) => (
                <span
                  key={color}
                  className="size-5 rounded-full border-2 border-(--surface)"
                  style={{ background: color }}
                />
              ))}
            </span>
            Sent to your sales team
          </span>
        </div>
      </div>
    </div>
  );
}

const BARS = [
  ["M", 38],
  ["T", 52],
  ["W", 44],
  ["T", 70],
  ["F", 61],
  ["S", 92],
  ["S", 78],
] as const;

function buildInsight(timeline: gsap.core.Timeline, select: Select) {
  timeline
    .from(select("[data-card]"), { y: 48, opacity: 0, duration: 0.9, ease: "power3.out" })
    .addLabel("numbers", "-=0.35")
    .from(
      select("[data-col]"),
      {
        scaleY: 0,
        transformOrigin: "bottom",
        duration: 0.9,
        stagger: 0.07,
        ease: "power3.out",
      },
      "numbers"
    )
    .from(
      select("[data-pill]"),
      { scale: 0.7, opacity: 0, duration: 0.5, ease: "back.out(2)" },
      "numbers+=0.9"
    )
    .from(
      select("[data-stat]"),
      { opacity: 0, y: 10, duration: 0.5, stagger: 0.1 },
      "numbers+=0.6"
    );
  countUp(timeline, select("[data-count]"), 1.6, "numbers");
}

export function InsightScene() {
  const ref = useRef<HTMLDivElement>(null);
  useScene(ref, buildInsight);

  return (
    <div ref={ref} className="w-full max-w-[420px]">
      <div data-card className={`${CARD} p-5`}>
        <p className="text-[11px] font-semibold tracking-[0.1em] text-(--ink-muted) uppercase">
          Enquiries this week
        </p>
        <div className="mt-1 flex items-center gap-3">
          <span
            data-count={184}
            className="font-display text-[44px] leading-none font-medium tracking-tight tabular-nums"
          >
            184
          </span>
          <span
            data-pill
            className="flex items-center gap-0.5 rounded-full bg-(--ok-soft) px-2 py-0.5 text-xs font-bold text-(--ok)"
          >
            <ArrowUpIcon weight="bold" className="size-3" />
            38%
          </span>
        </div>

        <div className="relative mt-6 h-36">
          {[0, 33, 66].map((top) => (
            <span
              key={top}
              className="absolute inset-x-0 h-px bg-(--line)"
              style={{ top: `${top}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-2.5 border-b border-(--line)">
            {BARS.map(([day, value], index) => (
              <span
                key={index}
                data-col
                className={`flex-1 rounded-t-md ${
                  index === 5 ? "bg-(--ok)" : "bg-(--ink)/10"
                }`}
                style={{ height: `${value}%` }}
                title={day}
              />
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-2.5 text-center text-[11px] text-(--ink-muted)">
          {BARS.map(([day], index) => (
            <span key={index} className="flex-1">
              {day}
            </span>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div data-stat className="rounded-2xl bg-(--paper) p-3.5">
            <p className="text-xs text-(--ink-muted)">First reply</p>
            <p className="mt-1 font-display text-2xl font-medium tabular-nums">
              <span data-count={6}>6</span>s
            </p>
          </div>
          <div data-stat className="rounded-2xl bg-(--paper) p-3.5">
            <p className="text-xs text-(--ink-muted)">Handed to your team</p>
            <p className="mt-1 font-display text-2xl font-medium tabular-nums">
              <span data-count={23}>23</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
