"use client";

import dynamic from "next/dynamic";
import { useAnimationFrame, useMotionValue } from "motion/react";
import { SiriOrb, type AIState } from "@/components/voice-orbs/siri-orb";
import { AuroraOrb } from "@/components/voice-orbs/aurora-orb";

const ElevenOrb = dynamic(
  () => import("@/components/voice-orbs/eleven-orb").then((m) => m.Orb),
  { ssr: false }
);

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export type OrbStyle = "orb" | "siri" | "aurora";

export const ORB_STYLES: { value: OrbStyle; label: string; description: string }[] = [
  { value: "orb", label: "Orb", description: "3D flowing sphere, by ElevenLabs" },
  { value: "siri", label: "Siri", description: "Swirling colour glass" },
  { value: "aurora", label: "Aurora", description: "Liquid glow that swells with the voice" },
];

const SIRI_STATE: Record<OrbState, AIState> = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  speaking: "streaming",
};

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace("#", ""), 16);
  const pb = parseInt(b.replace("#", ""), 16);
  const channel = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
}

export function VoiceOrb({
  style = "orb",
  colors,
  state,
  size,
  getInputVolume,
  getOutputVolume,
  className,
}: {
  style?: OrbStyle;
  colors: string[];
  state: OrbState;
  size: number;
  getInputVolume?: () => number;
  getOutputVolume?: () => number;
  className?: string;
}) {
  const main = colors[0] ?? "#7c3aed";
  const accent = colors[1] ?? mix(main, "#ffffff", 0.4);
  const level = useMotionValue(0);

  useAnimationFrame((time) => {
    if (style === "orb") return;
    const t = time / 1000;
    const next =
      state === "listening"
        ? (getInputVolume?.() ?? 0)
        : state === "speaking"
          ? (getOutputVolume?.() ?? 0)
          : state === "thinking"
            ? 0.3 + 0.15 * Math.sin(t * 4)
            : 0.06 + 0.04 * Math.sin(t * 1.2);
    level.set(Math.min(1, Math.max(0, next)));
  });

  return (
    <div className={className} style={{ width: size, height: size }}>
      {style === "siri" ? (
        <SiriOrb
          size={`${size}px`}
          state={SIRI_STATE[state]}
          amplitude={level}
          colors={{
            bg: mix(main, "#ffffff", 0.85),
            c1: main,
            c2: accent,
            c3: mix(main, accent, 0.5),
            c4: mix(main, "#ffffff", 0.3),
          }}
        />
      ) : style === "aurora" ? (
        <AuroraOrb size={size} level={level} colors={[main, accent]} />
      ) : (
        <ElevenOrb
          className="relative h-full w-full"
          colors={[main, accent]}
          agentState={state === "idle" ? null : state === "speaking" ? "talking" : state}
          volumeMode={state === "listening" || state === "speaking" ? "manual" : "auto"}
          getInputVolume={getInputVolume}
          getOutputVolume={getOutputVolume}
        />
      )}
    </div>
  );
}
