"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { APP_STORE_URL, AppleLogo, PLAY_URL, PlayLogo } from "@/components/landing/store-badges";
import logoMark from "@/public/images/logo.png";
import { cn } from "@/lib/utils";

type Platform = "ios" | "android";

const DISMISSED_KEY = "app-banner-dismissed";
const QUIET_FOR = 7 * 24 * 60 * 60 * 1000;

function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  // iPadOS reports itself as a Mac.
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  return null;
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && Date.now() - at < QUIET_FOR;
  } catch {
    return false;
  }
}

export function AppBanner() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const found = detectPlatform();
    if (!found || recentlyDismissed()) return;
    const timer = window.setTimeout(() => setPlatform(found), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  if (!platform) return null;

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {}
  };

  const ios = platform === "ios";

  return (
    <div
      role="dialog"
      aria-label="Get the Magic Agent app"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "fixed inset-x-3 z-[60] mx-auto max-w-md rounded-2xl border border-black/10 bg-white p-3 text-[#1c1b19] shadow-[0_12px_40px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#1f1e1c] dark:text-[#f1efeb]",
        "bottom-[calc(6rem+env(safe-area-inset-bottom))]",
        "transition-[translate,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-opacity",
        "starting:translate-y-6 starting:opacity-0",
        open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-black/5 bg-[#f6f5f1] dark:border-white/10 dark:bg-white">
          <Image src={logoMark} alt="" width={40} height={22} className="h-auto w-9" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">Magic Agent</p>
          <p className="truncate text-[13px] text-[#67635b] dark:text-[#a29e96]">
            Reply to customers from your phone
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mt-6 -mr-1 flex size-8 shrink-0 items-center justify-center self-start rounded-full text-[#67635b] active:bg-black/5 dark:text-[#a29e96] dark:active:bg-white/10"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </button>
      </div>
      <a
        href={ios ? APP_STORE_URL : PLAY_URL}
        target="_blank"
        rel="noreferrer"
        onClick={dismiss}
        className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-black text-[15px] font-medium text-white transition-transform active:scale-[0.98] dark:bg-white dark:text-black"
      >
        {ios ? <AppleLogo /> : <PlayLogo />}
        {ios ? "Download on the App Store" : "Get it on Google Play"}
      </a>
    </div>
  );
}
