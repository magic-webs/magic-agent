"use client";

import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useRef } from "react";
import Image from "next/image";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Briefcase01Icon,
  CalendarCheckIn01Icon,
  CustomerSupportIcon,
  PackageIcon,
  RoboticIcon,
  ShoppingBag01Icon,
  Target02Icon,
} from "@hugeicons/core-free-icons";

import { AGENT_TEMPLATES } from "@/convex/lib/agentTemplates";

gsap.registerPlugin(ScrollTrigger);

const ICONS: Record<string, IconSvgElement> = {
  sales: ShoppingBag01Icon,
  lead_qualifier: Target02Icon,
  support: CustomerSupportIcon,
  after_sales: PackageIcon,
  bookings: CalendarCheckIn01Icon,
  careers: Briefcase01Icon,
};

const OPENERS: Record<string, string> = {
  sales: "Is the 5 litre cold-pressed oil in stock?",
  lead_qualifier: "Looking for a 2BHK near Baner, around 90 lakh.",
  support: "My invoice has the wrong GST number on it.",
  after_sales: "Where is order #4821? It said Tuesday.",
  bookings: "Can I book a cleaning for Saturday morning?",
  careers: "Is the accounts executive role still open?",
};

const FACES: Record<string, [string, string]> = {
  sales: ["female-1", "#f7d9c4"],
  lead_qualifier: ["male-2", "#cfe3f5"],
  support: ["female-3", "#d9ecd2"],
  after_sales: ["male-1", "#eadcf7"],
  bookings: ["female-4", "#f7d3dc"],
  careers: ["male-4", "#f6e8c3"],
};

/**
 * Pinned while the cards travel sideways: the section is made exactly as tall
 * as the track is wide, so a screenful of vertical scroll moves the track by a
 * screenful and the page carries on as soon as the last card is in view.
 * Sticky rather than a GSAP pin, so Lenis and the layout agree on positions.
 */
export function TemplateRail({ heading }: { heading: React.ReactNode }) {
  const section = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const fadeStart = useRef<HTMLDivElement>(null);
  const fadeEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = section.current;
    const rail = track.current;
    if (!root || !rail) return;

    const total = AGENT_TEMPLATES.length;
    const distance = () => Math.max(0, rail.scrollWidth - rail.parentElement!.clientWidth);
    const size = () => {
      root.style.height = `${window.innerHeight + distance()}px`;
    };

    rail.parentElement!.style.overflow = "hidden";
    size();
    ScrollTrigger.addEventListener("refreshInit", size);

    const show = (progress: number) => {
      if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0.04, progress)})`;
      if (count.current) {
        count.current.textContent = String(Math.min(total, Math.round(progress * (total - 1)) + 1)).padStart(2, "0");
      }
      if (fadeStart.current) fadeStart.current.style.opacity = progress > 0.01 ? "1" : "0";
      if (fadeEnd.current) fadeEnd.current.style.opacity = progress < 0.99 ? "1" : "0";
    };
    show(0);

    const ctx = gsap.context(() => {
      gsap.to(rail, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => show(self.progress),
        },
      });

      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.fromTo(
          gsap.utils.selector(rail)("[data-card]"),
          { x: 80, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 1,
            ease: "power3.out",
            stagger: 0.08,
            scrollTrigger: { trigger: root, start: "top 80%", once: true },
          }
        );
      }
    }, root);

    ScrollTrigger.refresh();

    return () => {
      ScrollTrigger.removeEventListener("refreshInit", size);
      ctx.revert();
      root.style.height = "";
      rail.parentElement!.style.overflow = "";
    };
  }, []);

  return (
    <div ref={section} className="relative">
      <div className="sticky top-0 flex h-svh flex-col justify-center-safe overflow-hidden py-[clamp(1.5rem,7svh,5rem)]">
        <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">{heading}</div>

        <div className="relative mt-[clamp(1.25rem,4svh,2.5rem)] shrink-0 overflow-x-auto [scrollbar-width:none] [--gutter:16px] sm:[--gutter:24px] [&::-webkit-scrollbar]:hidden">
          <div
            ref={track}
            className="flex w-max gap-4 px-[max(var(--gutter),calc((100vw-1200px)/2+var(--gutter)))] will-change-transform"
          >
            {AGENT_TEMPLATES.map((template) => {
              const Icon = ICONS[template.key] ?? RoboticIcon;
              const [face, tint] = FACES[template.key] ?? ["female-2", "#d3efec"];
              return (
                <article
                  key={template.key}
                  data-card
                  className="group flex w-[min(80vw,340px)] shrink-0 flex-col overflow-hidden rounded-[24px] border border-(--line) bg-(--surface) transition-[translate,box-shadow] duration-500 ease-out hover:-translate-y-1.5 hover:shadow-[0_30px_60px_-35px_rgb(20_40_80/0.45)]"
                >
                  <div className="stage-mesh relative h-44 overflow-hidden max-[600px]:h-40">
                    <div className="bg-dots absolute inset-0" />
                    <span className="absolute top-5 right-5 flex size-10 items-center justify-center rounded-xl bg-(--surface)/85 text-(--ink) backdrop-blur">
                      <HugeiconsIcon icon={Icon} strokeWidth={2} className="size-5" />
                    </span>
                    <span
                      className="absolute bottom-0 left-5 aspect-[4/5] w-[72px] overflow-hidden rounded-t-[14px] shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)] transition-transform duration-500 group-hover:-translate-y-1"
                      style={{
                        background: `linear-gradient(180deg, ${tint}, color-mix(in oklab, ${tint}, black 15%))`,
                      }}
                    >
                      <Image
                        src={`/images/3d-avatars/${face}.png`}
                        alt=""
                        fill
                        sizes="72px"
                        className="object-cover object-bottom"
                      />
                    </span>
                    <p className="absolute right-5 bottom-6 max-w-[62%] rounded-2xl rounded-bl-md bg-(--surface) px-3.5 py-2.5 text-[13px] leading-snug shadow-sm transition-transform duration-500 group-hover:-translate-y-1.5">
                      {OPENERS[template.key]}
                    </p>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-5">
                    <h3 className="font-display text-xl font-medium tracking-tight">
                      {template.name}
                    </h3>
                    <p className="text-sm leading-relaxed text-(--ink-muted)">{template.summary}</p>
                    <p className="mt-auto pt-3 text-xs text-(--ink-muted)/80">{template.suitedTo}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <div
            ref={fadeStart}
            className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-(--paper) to-transparent opacity-0 transition-opacity duration-300 sm:w-24"
          />
          <div
            ref={fadeEnd}
            className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-(--paper) to-transparent transition-opacity duration-300 sm:w-24"
          />
        </div>

        <div className="mx-auto mt-[clamp(1.25rem,4svh,2.5rem)] flex w-full max-w-[1200px] shrink-0 items-center gap-4 px-4 sm:px-6">
          <span className="font-mono text-xs text-(--ink-muted) tabular-nums">
            <span ref={count}>01</span> / {String(AGENT_TEMPLATES.length).padStart(2, "0")}
          </span>
          <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-(--line)">
            <span
              ref={bar}
              className="block h-full origin-left rounded-full bg-(--ink)"
              style={{ transform: "scaleX(0.04)" }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
