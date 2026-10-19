"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  BriefcaseIcon,
  CalendarCheckIcon,
  CaretLeftIcon,
  CaretRightIcon,
  LifebuoyIcon,
  PackageIcon,
  RobotIcon,
  ShoppingBagIcon,
  TargetIcon,
} from "@phosphor-icons/react";
import Image from "next/image";
import { AGENT_TEMPLATES } from "@/convex/lib/agentTemplates";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  sales: ShoppingBagIcon,
  lead_qualifier: TargetIcon,
  support: LifebuoyIcon,
  after_sales: PackageIcon,
  bookings: CalendarCheckIcon,
  careers: BriefcaseIcon,
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

export function TemplateRail({ heading }: { heading: React.ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const node = rail.current;
    if (!node) return;
    setEdges({
      start: node.scrollLeft < 8,
      end: node.scrollLeft + node.clientWidth > node.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        gsap.utils.selector(node)("[data-card]"),
        { x: 80, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 1,
          ease: "power3.out",
          stagger: 0.08,
          scrollTrigger: { trigger: node, start: "top 85%", once: true },
        }
      );
    }, node);
    return () => ctx.revert();
  }, []);

  const step = (direction: 1 | -1) => {
    const node = rail.current;
    const card = node?.querySelector<HTMLElement>("[data-card]");
    if (!node || !card) return;
    node.scrollBy({ left: direction * (card.offsetWidth + 16), behavior: "smooth" });
  };

  const arrow =
    "flex size-11 items-center justify-center rounded-full border border-(--line) bg-(--surface) transition hover:border-(--ink)/30 disabled:pointer-events-none disabled:opacity-35";

  return (
    <div>
      <div className="mx-auto flex w-full max-w-[1200px] items-end justify-between gap-6 px-4 sm:px-6">
        {heading}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            aria-label="Previous templates"
            className={arrow}
            disabled={edges.start}
            onClick={() => step(-1)}
          >
            <CaretLeftIcon weight="bold" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next templates"
            className={arrow}
            disabled={edges.end}
            onClick={() => step(1)}
          >
            <CaretRightIcon weight="bold" className="size-4" />
          </button>
        </div>
      </div>

      <div className="relative mt-12 [--gutter:16px] sm:[--gutter:24px]">
        <div
          ref={rail}
          data-lenis-prevent
          onScroll={measure}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-[max(var(--gutter),calc((100vw-1200px)/2+var(--gutter)))] pb-6 [scrollbar-width:none] scroll-px-[max(var(--gutter),calc((100vw-1200px)/2+var(--gutter)))] [&::-webkit-scrollbar]:hidden"
        >
          {AGENT_TEMPLATES.map((template) => {
            const Icon = ICONS[template.key] ?? RobotIcon;
            const [face, tint] = FACES[template.key] ?? ["female-2", "#d3efec"];
            return (
              <article
                key={template.key}
                data-card
                className="group flex w-[min(80vw,340px)] shrink-0 snap-start flex-col overflow-hidden rounded-[24px] border border-(--line) bg-(--surface) transition duration-500 ease-out hover:-translate-y-1.5 hover:shadow-[0_30px_60px_-35px_rgb(20_40_80/0.45)]"
              >
                <div className="stage-mesh relative h-48 overflow-hidden">
                  <div className="bg-dots absolute inset-0" />
                  <span className="absolute top-5 right-5 flex size-10 items-center justify-center rounded-xl bg-(--surface)/85 text-(--ink) backdrop-blur">
                    <Icon className="size-5" />
                  </span>
                  <span
                    className="absolute bottom-0 left-5 aspect-[4/5] w-[76px] overflow-hidden rounded-t-[14px] shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)] transition-transform duration-500 group-hover:-translate-y-1"
                    style={{
                      background: `linear-gradient(180deg, ${tint}, color-mix(in oklab, ${tint}, black 15%))`,
                    }}
                  >
                    <Image
                      src={`/images/3d-avatars/${face}.png`}
                      alt=""
                      fill
                      sizes="76px"
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
                  <p className="text-sm leading-relaxed text-(--ink-muted)">
                    {template.summary}
                  </p>
                  <p className="mt-auto pt-3 text-xs text-(--ink-muted)/80">
                    {template.suitedTo}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-(--paper) to-transparent transition-opacity duration-300 sm:w-24",
            edges.start && "opacity-0"
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-(--paper) to-transparent transition-opacity duration-300 sm:w-24",
            edges.end && "opacity-0"
          )}
        />
      </div>
    </div>
  );
}
