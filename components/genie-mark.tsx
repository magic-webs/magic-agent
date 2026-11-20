import { useId } from "react";
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

/** Genie's own mark: the lamp on a green tile. */
export function GenieMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={`${id}bg`} x1="3" y1="1" x2="29" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4ADE80" />
          <stop offset=".5" stopColor="#16A34A" />
          <stop offset="1" stopColor="#0F766E" />
        </linearGradient>
        <radialGradient
          id={`${id}gl`}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(9 6) rotate(55) scale(20)"
        >
          <stop stopColor="#fff" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill={`url(#${id}bg)`} />
      <rect width="32" height="32" rx="10" fill={`url(#${id}gl)`} />
      <g fill="#fff">
        <path d="M5.5 15.6h15.2c0 2.9-2.1 5-5 5.5l.7 1.6H11l.7-1.6c-1.9-.4-3.4-1.5-4.2-3l-1.4.9c-1 .6-2.2-.1-2.2-1.2 0-1 .7-1.8 1.6-2.1z" />
        <path d="M20.2 16.8c1.8-.2 3.3-1.2 4.4-2.6l2-2.4c.3-.3.8 0 .7.4l-1 3c-.8 2.3-2.9 3.9-5.3 4.1z" />
        <path d="M9.2 22.9h9.6c.6 0 1 .4 1 1v.3H8.2v-.3c0-.6.4-1 1-1z" />
        <path d="M9.7 14.6c.3-2 2-3.4 3.9-3.4s3.6 1.4 3.9 3.4z" />
        <circle cx="13.6" cy="9.9" r="1.1" />
        <path
          d="M24.4 4.2c.2 1.5.9 2.2 2.4 2.4-1.5.2-2.2.9-2.4 2.4-.2-1.5-.9-2.2-2.4-2.4 1.5-.2 2.2-.9 2.4-2.4z"
          opacity=".9"
        />
      </g>
    </svg>
  );
}
