"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { GooeyNav } from "@/components/landing/gooey-nav";
import { SpecularButton } from "@/components/landing/specular-button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#work", label: "Product", section: "work" },
  { href: "/#use-cases", label: "Use cases", section: "use-cases" },
  { href: "/#templates", label: "Templates", section: "templates" },
  { href: "/pricing", label: "Pricing", section: "pricing" },
];

const NAV_STYLE = {
  "--gn-ink": "var(--ink)",
  "--gn-muted": "var(--ink-muted)",
  "--gn-frame": "color-mix(in srgb, var(--surface) 72%, transparent)",
  "--gn-frame-edge": "var(--line)",
} as CSSProperties;

export function SiteNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [section, setSection] = useState(0);
  const held = useRef<{ index: number; until: number } | null>(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);

      const line = window.innerHeight * 0.4;
      const reached = Math.max(
        0,
        LINKS.findLastIndex((link) => {
          const top = document.getElementById(link.section)?.getBoundingClientRect().top;
          return top !== undefined && top <= line;
        })
      );
      // A clicked link keeps the pill while the smooth scroll passes the sections before it.
      const hold = held.current;
      if (hold && hold.index !== reached && performance.now() < hold.until) return;
      held.current = null;
      setSection(reached);
    };
    const frame = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const page = LINKS.findIndex((link) => link.href === pathname);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 text-(--ink) transition-colors duration-500 ease-out",
        scrolled && "bg-(--paper)/80 backdrop-blur-xl"
      )}
    >
      <div className="mx-auto flex h-21 w-full max-w-[1600px] items-center justify-between gap-6 px-4 sm:px-8 max-[600px]:h-16">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="h-7" />
          <span className="font-display text-[22px] font-semibold tracking-[-0.02em] max-[600px]:text-lg">
            Magic Agent
          </span>
        </Link>

        <div className="absolute left-1/2 hidden -translate-x-1/2 lg:block">
          <GooeyNav
            items={LINKS}
            activeIndex={page >= 0 ? page : section}
            onChange={(index) => {
              held.current = { index, until: performance.now() + 1500 };
              setSection(index);
            }}
            theme="light"
            color="#1c1b19"
            activeTextColor="#f6f5f1"
            style={NAV_STYLE}
          />
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden h-11 items-center rounded-full px-4 text-[15px] font-medium transition-opacity hover:opacity-70 sm:inline-flex"
          >
            Log in
          </Link>
          <SpecularButton
            href="/signup"
            radius={999}
            tint="var(--ink)"
            tintOpacity={1}
            textColor="var(--paper)"
            lineColor="#10b981"
            autoAnimate
            className="h-11 px-5 py-0 text-[15px] max-[600px]:h-10 max-[600px]:px-4 max-[600px]:text-sm"
          >
            <span className="max-[600px]:hidden">Create your agent</span>
            <span className="min-[601px]:hidden">Get started</span>
          </SpecularButton>
        </div>
      </div>
    </header>
  );
}
