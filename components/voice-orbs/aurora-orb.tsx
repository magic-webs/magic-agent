"use client";

// Adapted from Wensity's Voice Aurora Wave (MIT): https://github.com/ksparth12/wensity-shadcn-registry

import * as React from "react";
import { motion, useSpring, useTransform, type MotionValue } from "motion/react";

function alpha(hex: string, value: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${value})`;
}

export function AuroraOrb({
  size,
  level,
  colors,
}: {
  size: number;
  level: MotionValue<number>;
  colors: [string, string];
}) {
  const [main, accent] = colors;
  const filterId = React.useId().replace(/[:]/g, "");
  const amp = useSpring(0, { stiffness: 160, damping: 16, mass: 0.55 });

  React.useEffect(() => level.on("change", (value) => amp.set(value)), [level, amp]);

  const orbScale = useTransform(amp, [0, 1], [0.92, 1.32]);
  const innerScale = useTransform(amp, [0, 1], [0.84, 1.18]);
  const dispScale = useTransform(amp, [0, 1], [4, 28]);
  const sheen = useTransform(amp, [0, 1], [0.45, 1]);
  const shoutScale = useTransform(amp, [0.4, 1], [1, 1.55]);
  const shoutOpacity = useTransform(amp, [0.4, 0.7, 1], [0, 0.5, 0.85]);

  return (
    <div className="relative grid select-none place-items-center" style={{ width: size, height: size }}>
      <svg aria-hidden width="0" height="0" style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <filter id={`liquid-${filterId}`} x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022 0.028" numOctaves="2" seed="3" result="noise">
              <animate
                attributeName="baseFrequency"
                dur="18s"
                values="0.022 0.028;0.026 0.032;0.022 0.028"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <DisplacementMap dispScale={dispScale} />
          </filter>
          <radialGradient id={`g-core-${filterId}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="35%" stopColor={accent} stopOpacity="0.85" />
            <stop offset="70%" stopColor={main} stopOpacity="0.92" />
            <stop offset="100%" stopColor={main} stopOpacity="1" />
          </radialGradient>
          <radialGradient id={`g-halo-${filterId}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.55" />
            <stop offset="60%" stopColor={main} stopOpacity="0.32" />
            <stop offset="100%" stopColor={main} stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      <motion.div
        aria-hidden
        className="absolute inset-[12%] rounded-full"
        style={{
          scale: orbScale,
          opacity: sheen,
          background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.45) 0%, ${alpha(main, 0.32)} 38%, ${alpha(main, 0.1)} 60%, transparent 75%)`,
          filter: `blur(${Math.round(size * 0.075)}px)`,
          willChange: "transform, opacity",
        }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-[8%] rounded-full"
        style={{
          scale: shoutScale,
          opacity: shoutOpacity,
          background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.42) 0%, ${alpha(accent, 0.34)} 35%, ${alpha(main, 0.1)} 60%, transparent 78%)`,
          filter: `blur(${Math.round(size * 0.12)}px)`,
          willChange: "transform, opacity",
        }}
      />
      <motion.svg
        viewBox="0 0 200 200"
        width={size * 0.86}
        height={size * 0.86}
        className="absolute"
        style={{ scale: orbScale, willChange: "transform" }}
      >
        <g filter={`url(#liquid-${filterId})`}>
          <circle cx="100" cy="100" r="78" fill={`url(#g-core-${filterId})`} />
          <circle cx="100" cy="100" r="92" fill={`url(#g-halo-${filterId})`} opacity="0.7" />
        </g>
      </motion.svg>
      <motion.div
        aria-hidden
        className="absolute rounded-full"
        style={{
          width: size * 0.42,
          height: size * 0.42,
          scale: innerScale,
          background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95) 0%, ${alpha(accent, 0.5)} 30%, transparent 70%)`,
          mixBlendMode: "screen",
          willChange: "transform",
        }}
      />
    </div>
  );
}

function DisplacementMap({ dispScale }: { dispScale: MotionValue<number> }) {
  const ref = React.useRef<SVGFEDisplacementMapElement>(null);
  React.useEffect(
    () => dispScale.on("change", (value) => ref.current?.setAttribute("scale", String(value))),
    [dispScale]
  );
  return (
    <feDisplacementMap
      ref={ref}
      in="SourceGraphic"
      in2="noise"
      scale="4"
      xChannelSelector="R"
      yChannelSelector="G"
    />
  );
}
