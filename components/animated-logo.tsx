"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const animations = new Map<string, Promise<unknown>>();

function loadAnimationData(src: string) {
  let data = animations.get(src);
  if (!data) {
    data = fetch(src).then((res) => {
      if (!res.ok) throw new Error(`logo animation ${res.status}`);
      return res.json();
    });
    data.catch(() => animations.delete(src));
    animations.set(src, data);
  }
  return data;
}

export function AnimatedLogo({
  className,
  boxClassName,
  alt = "",
  src = "/lottie/magic-logo-eyes.json",
  loop = true,
}: {
  className?: string;
  boxClassName?: string;
  alt?: string;
  src?: string;
  loop?: boolean;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = box.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let anim: import("lottie-web").AnimationItem | undefined;
    let cancelled = false;

    void Promise.all([import("lottie-web/build/player/lottie_light"), loadAnimationData(src)])
      .then(([{ default: lottie }, data]) => {
        if (cancelled) return;
        anim = lottie.loadAnimation({
          container,
          renderer: "svg",
          loop,
          autoplay: true,
          // lottie writes into the data it plays, so each instance gets its own copy.
          animationData: structuredClone(data),
          rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
        });
        anim.addEventListener("DOMLoaded", () => setReady(true));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [src, loop]);

  return (
    <span className={cn("relative inline-flex shrink-0", boxClassName)}>
      <Logo className={cn(className, ready && "opacity-0")} alt={alt} />
      <span ref={box} aria-hidden className="pointer-events-none absolute inset-0" />
    </span>
  );
}
