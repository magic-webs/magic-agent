"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const GLOWS = [
  { color: "#3a8f66", className: "top-[-10%] left-[-5%] size-[60vmax]", duration: "19s" },
  { color: "#2bb3a0", className: "right-[-15%] bottom-[-20%] size-[55vmax]", duration: "23s" },
  { color: "#4b86cc", className: "top-[20%] left-[35%] size-[40vmax]", duration: "16s" },
];

const FACES = [
  ["female-2", "#f7d9c4"],
  ["male-1", "#cfe3f5"],
  ["female-4", "#d9ecd2"],
  ["male-3", "#eadcf7"],
  ["female-1", "#f7d3dc"],
  ["male-2", "#d3efec"],
  ["female-5", "#f6e8c3"],
];

export function ClosingPanel({
  lines,
  children,
}: {
  lines: string[];
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(node);

      gsap.fromTo(
        q("[data-giant]"),
        { scale: 0.8, yPercent: 18, opacity: 0.3 },
        {
          scale: 1,
          yPercent: 0,
          opacity: 1,
          ease: "none",
          scrollTrigger: { trigger: node, start: "top bottom", end: "center center", scrub: true },
        }
      );

      gsap.fromTo(
        q("[data-fade]"),
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.9,
          ease: "power3.out",
          stagger: 0.1,
          scrollTrigger: { trigger: node, start: "center 75%", once: true },
        }
      );

      gsap.fromTo(
        q("[data-face]"),
        { yPercent: 120, opacity: 0 },
        {
          yPercent: 0,
          opacity: 1,
          duration: 1,
          ease: "back.out(1.4)",
          stagger: { each: 0.07, from: "center" },
          scrollTrigger: { trigger: node, start: "center 75%", once: true },
        }
      );
    }, node);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative flex min-h-[min(900px,100svh)] flex-col items-center justify-center overflow-hidden bg-[#1a1918] px-4 py-28 text-center text-white max-[600px]:min-h-0 max-[600px]:py-24"
    >
      <div aria-hidden className="absolute inset-0">
        {GLOWS.map((glow) => (
          <span
            key={glow.color}
            className={`absolute animate-aurora rounded-full opacity-45 blur-[90px] motion-reduce:animate-none ${glow.className}`}
            style={{
              background: `radial-gradient(circle, ${glow.color}, transparent 65%)`,
              animationDuration: glow.duration,
            }}
          />
        ))}
        <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1.4px)] bg-[length:22px_22px] mask-[radial-gradient(ellipse_70%_60%_at_50%_45%,black,transparent)]" />
      </div>

      <div className="relative flex flex-col items-center gap-8">
        <h2
          data-giant
          className="font-display text-[clamp(3.25rem,12.5vw,11rem)] leading-[0.88] font-medium tracking-[-0.045em] will-change-transform"
        >
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h2>
        {children}

        <div className="mt-6 flex items-end justify-center -space-x-3">
          {FACES.map(([face, tint], index) => {
            const width = index === 3 ? 76 : index % 2 ? 60 : 66;
            return (
              <span
                key={face}
                data-face
                className="relative aspect-[4/5] overflow-hidden rounded-[14px] border-2 border-[#1a1918] shadow-[0_18px_40px_-18px_rgb(0_0_0/0.6)]"
                style={{
                  width: `min(${width}px, ${width / 5}vw)`,
                  background: `linear-gradient(180deg, ${tint}, color-mix(in oklab, ${tint}, black 18%))`,
                  zIndex: 10 - Math.abs(3 - index),
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
            );
          })}
        </div>
      </div>
    </section>
  );
}
