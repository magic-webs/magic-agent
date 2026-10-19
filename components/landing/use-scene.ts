"use client";

import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export type Select = (selector: string) => HTMLElement[];

/**
 * Builds a paused timeline and plays it once the scene scrolls into view.
 * The markup is the finished frame, so without JavaScript or with reduced
 * motion the reader sees the end state.
 */
export function useScene(
  ref: RefObject<HTMLElement | null>,
  build: (timeline: gsap.core.Timeline, select: Select) => void
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({ paused: true });
      build(timeline, gsap.utils.selector(node) as Select);

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        timeline.progress(1);
        return;
      }

      ScrollTrigger.create({
        trigger: node,
        start: "top 72%",
        once: true,
        onEnter: () => timeline.play(),
      });
    }, node);

    return () => ctx.revert();
  }, [ref, build]);
}

export function countUp(
  timeline: gsap.core.Timeline,
  elements: HTMLElement[],
  duration: number,
  position: gsap.Position
) {
  elements.forEach((element) => {
    const target = Number(element.dataset.count);
    const state = { value: 0 };
    element.textContent = "0";
    timeline.to(
      state,
      {
        value: target,
        duration,
        ease: "power2.out",
        onUpdate: () => {
          element.textContent = Math.round(state.value).toLocaleString("en-IN");
        },
      },
      position
    );
  });
}
