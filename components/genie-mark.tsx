"use client";

import { useState } from "react";
import { AnimatedLogo } from "@/components/animated-logo";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

const line = { stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round", strokeLinecap: "round", fill: "none" };

/** The lamp, drawn as a line icon for the sidebar. */
export const GenieIcon: IconSvgElement = [
  ["path", { d: "M3 12.5h12.5c0 2.4-1.7 4.1-4.1 4.5l.5 1.3H7.6l.5-1.3c-1.5-.3-2.7-1.2-3.4-2.4", ...line, key: "0" }],
  ["path", { d: "M4.7 14.6 3.6 15.3c-.8.5-1.8-.1-1.8-1 0-.8.6-1.4 1.2-1.7", ...line, key: "1" }],
  ["path", { d: "M15.3 13.6c1.4-.2 2.6-1 3.4-2.1l1.8-2.1-.9 2.7c-.7 1.9-2.4 3.2-4.4 3.3", ...line, key: "2" }],
  ["path", { d: "M6.2 20.5h7.6", ...line, key: "3" }],
  ["path", { d: "M6.6 12.5c.2-1.7 1.6-2.9 3.3-2.9s3.1 1.2 3.3 2.9", ...line, key: "4" }],
  ["path", { d: "M18.5 2.8c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1z", ...line, key: "5" }],
];

export type GenieMood =
  | "idle"
  | "thinking"
  | "reading"
  | "success"
  | "error"
  | "sleepy"
  | "hello"
  | "listening";

const ONCE: GenieMood[] = ["success", "error", "hello"];

/** Genie's own mark: the Magic Agent logo, its eyes acting out `mood`. */
export function GenieMark({
  size = 32,
  mood = "idle",
  className,
}: {
  size?: number;
  mood?: GenieMood;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
    >
      <AnimatedLogo
        key={mood}
        src={mood === "idle" ? undefined : `/lottie/genie-${mood}.json`}
        loop={!ONCE.includes(mood)}
        boxClassName="w-full"
        className="h-auto w-full"
      />
    </span>
  );
}

/** Thinking while Genie works, then success or error once as it finishes. */
export function useGenieMood(working: boolean, failed: boolean): GenieMood {
  const [prevWorking, setPrevWorking] = useState(working);
  const [finished, setFinished] = useState(false);
  if (working !== prevWorking) {
    setPrevWorking(working);
    setFinished(!working);
  }
  if (working) return "thinking";
  if (failed) return "error";
  return finished ? "success" : "idle";
}
