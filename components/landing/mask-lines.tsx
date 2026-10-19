"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

/** A heading whose lines rise out of their own masks as it scrolls into view. */
export function MaskLines({
  lines,
  className,
}: {
  lines: string[];
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        gsap.utils.selector(node)("[data-line]"),
        { yPercent: 110, y: 0 },
        {
          yPercent: 0,
          duration: 1.1,
          ease: "expo.out",
          stagger: 0.09,
          scrollTrigger: { trigger: node, start: "top 85%", once: true },
        }
      );
    }, node);

    return () => ctx.revert();
  }, []);

  return (
    <h2
      ref={ref}
      className={cn(
        "font-display text-[clamp(2.25rem,5.2vw,4.5rem)] leading-[0.95] font-medium tracking-[-0.03em]",
        className
      )}
    >
      {lines.map((line) => (
        <span key={line} className="-mb-[0.08em] block overflow-hidden pb-[0.08em]">
          <span data-line className="block">
            {line}
          </span>
        </span>
      ))}
    </h2>
  );
}
