import { HugeiconsIcon } from "@hugeicons/react";
import {
  AppleIcon,
  PlayStoreIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

const PLAY_URL = "https://play.google.com/store/apps/details?id=ai.magicagent.app";

const BADGE =
  "inline-flex h-12 items-center gap-2.5 rounded-xl border border-white/20 bg-black px-4 text-left text-white";

export function StoreBadges({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <a
        href={PLAY_URL}
        target="_blank"
        rel="noreferrer"
        className={cn(BADGE, "transition-transform duration-300 hover:-translate-y-0.5")}
      >
        <HugeiconsIcon icon={PlayStoreIcon} strokeWidth={2} className="size-6" />
        <span className="flex flex-col leading-none">
          <span className="text-[10px] tracking-wide text-white/70 uppercase">Get it on</span>
          <span className="mt-1 text-[17px] font-medium">Google Play</span>
        </span>
      </a>
      <span aria-disabled="true" className={cn(BADGE, "cursor-default opacity-60")}>
        <HugeiconsIcon icon={AppleIcon} strokeWidth={2} className="size-6" />
        <span className="flex flex-col leading-none">
          <span className="text-[10px] tracking-wide text-white/70 uppercase">Coming soon on the</span>
          <span className="mt-1 text-[17px] font-medium">App Store</span>
        </span>
      </span>
    </div>
  );
}
