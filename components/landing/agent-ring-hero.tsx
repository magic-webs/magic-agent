"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const FACES = [
  "female-1",
  "male-1",
  "female-2",
  "male-2",
  "female-3",
  "male-3",
  "female-4",
  "male-4",
  "female-5",
];

const TINTS = [
  ["#f7d9c4", "#e9b796"],
  ["#cfe3f5", "#9cc2e6"],
  ["#d9ecd2", "#a9d39b"],
  ["#eadcf7", "#c6a9ea"],
  ["#f7d3dc", "#e9a3b6"],
  ["#d3efec", "#97d6cf"],
  ["#f6e8c3", "#e6cb83"],
];

const TILES = Array.from({ length: 18 }, (_, index) => ({
  face: FACES[(index * 4) % FACES.length],
  tint: TINTS[index % TINTS.length],
  width: [84, 76, 92, 72, 80, 88][index % 6],
  bob: index * 1.7,
}));

export function AgentRingHero({
  lines,
  action,
  channels,
  worksWith,
}: {
  lines: string[];
  action: React.ReactNode;
  channels: React.ReactNode;
  worksWith: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const tiles = Array.from(node.querySelectorAll<HTMLElement>("[data-tile]"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const size = { rx: 0, ry: 0, cy: 0, scale: 1, narrow: false };
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      const narrow = width < 820;
      const nav = narrow ? 64 : 84;
      const scale = narrow ? 0.6 : 1;
      const room = (height - nav) / 2 - (115 * scale) / 2 - (narrow ? 14 : 24);
      size.narrow = narrow;
      size.scale = scale;
      size.cy = nav / 2;
      size.ry = Math.min(room, narrow ? room : 400);
      size.rx = narrow ? width / 2 - 8 : Math.min(width * 0.32, size.ry * 1.18);
    };
    measure();

    const intro = tiles.map(() => ({ value: reduced ? 1 : 0 }));
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const scroll = { value: 0 };
    let spin = 0;

    const render = (time: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      const spread = 1 + scroll.value * 0.6;
      const fade = Math.max(0, 1 - scroll.value * 1.8);

      tiles.forEach((tile, index) => {
        const p = intro[index].value;
        const angle = -Math.PI / 2 + (index / tiles.length) * Math.PI * 2 + spin;
        const bob = reduced ? 0 : Math.sin(time * 0.6 + TILES[index].bob) * 6;
        const reach = (0.35 + 0.65 * p) * spread;
        const x = Math.cos(angle) * size.rx * reach + pointer.x;
        const y = Math.sin(angle) * size.ry * reach + bob + pointer.y + size.cy;
        const side = size.narrow
          ? Math.min(1, Math.max(0, (Math.abs(Math.sin(angle)) - 0.62) / 0.18))
          : 1;
        tile.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${size.scale * (0.6 + 0.4 * p)})`;
        tile.style.opacity = String(p * fade * side);
      });
    };

    const tick = (time: number, delta: number) => {
      if (!reduced) spin += delta * 0.000035;
      render(time);
    };

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(node);

      if (!reduced) {
        gsap.to(intro, {
          value: 1,
          duration: 1.6,
          ease: "expo.out",
          stagger: { each: 0.035, from: "start" },
          delay: 0.2,
        });
        gsap
          .timeline({ delay: 0.35 })
          .fromTo(
            q("[data-line]"),
            { yPercent: 110, y: 0 },
            { yPercent: 0, duration: 1.1, ease: "expo.out", stagger: 0.1 }
          )
          .fromTo(
            q("[data-fade]"),
            { opacity: 0, y: 14 },
            { opacity: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.08 },
            "-=0.7"
          );
      }

      ScrollTrigger.create({
        trigger: node,
        start: "top top",
        end: "bottom top",
        scrub: true,
        onUpdate: (self) => {
          scroll.value = self.progress;
        },
      });

      if (!reduced) {
        gsap.to(q("[data-center]"), {
          y: -80,
          opacity: 0,
          ease: "none",
          scrollTrigger: { trigger: node, start: "top top", end: "55% top", scrub: true },
        });
        gsap.to(q("[data-corner]"), {
          opacity: 0,
          ease: "none",
          scrollTrigger: { trigger: node, start: "top top", end: "25% top", scrub: true },
        });
      }
    }, node);

    const onPointer = (event: PointerEvent) => {
      if (reduced) return;
      pointer.tx = (event.clientX / window.innerWidth - 0.5) * 28;
      pointer.ty = (event.clientY / window.innerHeight - 0.5) * 18;
    };

    gsap.ticker.add(tick);
    window.addEventListener("resize", measure);
    window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onPointer);
      ctx.revert();
    };
  }, []);

  return (
    <section ref={ref} className="relative h-svh min-h-[680px] overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 mask-[linear-gradient(to_bottom,black_82%,transparent)]"
      >
        {TILES.map((tile, index) => (
          <div
            key={index}
            data-tile
            className="absolute top-1/2 left-1/2 aspect-[4/5] overflow-hidden rounded-[14px] opacity-0 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)] will-change-[transform,opacity]"
            style={{
              width: tile.width,
              background: `linear-gradient(180deg, ${tile.tint[0]}, ${tile.tint[1]})`,
            }}
          >
            <Image
              src={`/images/3d-avatars/${tile.face}.png`}
              alt=""
              fill
              sizes="92px"
              className="object-cover object-bottom"
              priority={index < 6}
            />
          </div>
        ))}
      </div>

      <div
        data-center
        className="pointer-events-none absolute top-[calc(50%+42px)] left-1/2 z-10 flex w-[min(64vmin,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center max-[820px]:top-[calc(50%+32px)] max-[820px]:w-[min(80vmin,94vw)]"
      >
        <h1 className="font-display text-[clamp(2.1rem,6vmin,4.1rem)] leading-[1.06] font-medium tracking-[-0.03em]">
          {lines.map((line) => (
            <span key={line} className="-mb-[0.08em] block overflow-hidden pb-[0.08em]">
              <span data-line className="block">
                {line}
              </span>
            </span>
          ))}
        </h1>
        <div data-fade className="pointer-events-auto mt-8">
          {action}
        </div>
        <div data-fade className="pointer-events-auto mt-6">
          {channels}
        </div>
      </div>

      <div data-corner className="absolute right-8 bottom-7 z-20 max-[820px]:hidden">
        <div data-fade>{worksWith}</div>
      </div>
    </section>
  );
}
