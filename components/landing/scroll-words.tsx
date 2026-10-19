"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";

gsap.registerPlugin(ScrollTrigger);

/** A paragraph that lights up word by word as it is scrolled through. */
export function ScrollWords({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = text.split(" ");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const spans = Array.from(node.querySelectorAll<HTMLElement>("[data-word]"));

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spans.forEach((span) => (span.dataset.on = "true"));
      return;
    }

    const trigger = ScrollTrigger.create({
      trigger: node,
      start: "top 78%",
      end: "bottom 42%",
      scrub: true,
      onUpdate: (self) => {
        const lit = Math.round(self.progress * spans.length);
        spans.forEach((span, index) => {
          span.dataset.on = String(index < lit);
        });
      },
    });

    return () => trigger.kill();
  }, []);

  return (
    <p
      ref={ref}
      className={cn(
        "font-display text-[clamp(1.75rem,4.2vw,3.5rem)] leading-[1.15] font-medium tracking-[-0.025em]",
        className
      )}
    >
      {words.map((word, index) => (
        <span key={index}>
          <span
            data-word
            className="opacity-[0.13] transition-opacity duration-200 ease-linear data-[on=true]:opacity-100"
          >
            {word}
          </span>{" "}
        </span>
      ))}
    </p>
  );
}
