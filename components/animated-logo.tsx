"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

let animationData: Promise<unknown> | undefined;

function loadAnimationData() {
  animationData ??= fetch("/lottie/magic-logo-eyes.json").then((res) => {
    if (!res.ok) throw new Error(`logo animation ${res.status}`);
    return res.json();
  });
  animationData.catch(() => (animationData = undefined));
  return animationData;
}

export function AnimatedLogo({
  className,
  boxClassName,
  alt = "",
}: {
  className?: string;
  boxClassName?: string;
  alt?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = box.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let anim: import("lottie-web").AnimationItem | undefined;
    let cancelled = false;

    void Promise.all([import("lottie-web/build/player/lottie_light"), loadAnimationData()])
      .then(([{ default: lottie }, data]) => {
        if (cancelled) return;
        anim = lottie.loadAnimation({
          container,
          renderer: "svg",
          loop: true,
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
  }, []);

  return (
    <span className={cn("relative inline-flex shrink-0", boxClassName)}>
      <Logo className={cn(className, ready && "opacity-0")} alt={alt} />
      <span ref={box} aria-hidden className="pointer-events-none absolute inset-0" />
    </span>
  );
}
