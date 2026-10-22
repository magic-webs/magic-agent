"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpIcon } from "@phosphor-icons/react";
import { ChannelMark } from "@/components/channel-mark";

const EXAMPLES = [
  "Answer price questions from my catalogue and take orders on WhatsApp",
  "Qualify property enquiries and book site visits for my team",
  "Tell customers where their order is and pass on return requests",
  "Book clinic appointments and collect the patient's details",
];

const CHIPS = [
  "Take orders",
  "Qualify leads",
  "Book appointments",
  "Answer support questions",
  "Track deliveries",
  "Collect job applications",
];

export function PromptBox() {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState(EXAMPLES[0]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let example = 0;
    let length = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      const full = EXAMPLES[example];
      if (!deleting) {
        length += 1;
        setHint(full.slice(0, length));
        if (length === full.length) {
          deleting = true;
          timer = setTimeout(step, 2200);
          return;
        }
        timer = setTimeout(step, 34);
      } else {
        length -= 2;
        setHint(full.slice(0, Math.max(0, length)));
        if (length <= 0) {
          deleting = false;
          length = 0;
          example = (example + 1) % EXAMPLES.length;
          timer = setTimeout(step, 400);
          return;
        }
        timer = setTimeout(step, 16);
      }
    };

    timer = setTimeout(step, 900);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <label className="flex w-[680px] max-w-full flex-col gap-3.5 rounded-2xl border border-(--line) bg-(--surface) p-[18px] text-left shadow-[0_24px_60px_-28px_rgb(20_30_60/0.35)] transition-shadow focus-within:shadow-[0_28px_70px_-26px_rgb(20_30_60/0.45)]">
        <span className="sr-only">Describe the agent you need</span>
        <textarea
          rows={3}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={hint}
          className="w-full resize-none border-none bg-transparent px-1 text-[17px] leading-[26px] text-(--ink) outline-none placeholder:text-(--ink-muted)/80"
        />
        <span className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[13px] text-(--ink-muted)">
            <ChannelMark type="whatsapp" size={20} className="rounded-[6px]" />
            <ChannelMark type="instagram" size={20} className="rounded-[6px]" />
            <ChannelMark type="web" size={20} className="rounded-[6px]" />
            <span className="max-[480px]:hidden">Goes live on your own number</span>
          </span>
          <Link
            href={value.trim() ? { pathname: "/signup", query: { brief: value.trim() } } : "/signup"}
            aria-label="Create this agent"
            className="flex size-10 items-center justify-center rounded-full bg-(--ink) text-(--paper) transition-transform hover:-translate-y-0.5"
          >
            <ArrowUpIcon weight="bold" className="size-4.5" />
          </Link>
        </span>
      </label>

      <div className="flex max-w-[680px] flex-wrap items-center justify-center gap-2.5">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => setValue(`${chip} for my business`)}
            className="rounded-full border border-(--line) bg-(--surface) px-4 py-2 text-sm text-(--ink-muted) transition hover:-translate-y-0.5 hover:border-(--ink)/25 hover:text-(--ink)"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
