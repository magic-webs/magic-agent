"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#work", label: "Product" },
  { href: "/#use-cases", label: "Use cases" },
  { href: "/#templates", label: "Templates" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      setHidden(y > last && y > window.innerHeight * 0.8);
      last = y;
    };
    const frame = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 text-(--ink) transition-[translate,background-color,border-color] duration-500 ease-out",
        scrolled
          ? "border-b border-(--line) bg-(--paper)/80 backdrop-blur-xl"
          : "border-b border-transparent",
        hidden && "-translate-y-full"
      )}
    >
      <div className="mx-auto flex h-21 w-full max-w-[1600px] items-center justify-between gap-6 px-4 sm:px-8 max-[600px]:h-16">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="h-7" />
          <span className="font-display text-[22px] font-semibold tracking-[-0.02em] max-[600px]:text-lg">
            Magic Agent
          </span>
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-full border border-(--line) p-1 text-[15px] lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 transition-colors hover:bg-(--ink)/6"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden h-11 items-center rounded-full px-4 text-[15px] font-medium transition-opacity hover:opacity-70 sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center rounded-full bg-(--ink) px-5 text-[15px] font-medium text-(--paper) transition-transform hover:-translate-y-0.5 max-[600px]:h-10 max-[600px]:px-4 max-[600px]:text-sm"
          >
            <span className="max-[600px]:hidden">Create your agent</span>
            <span className="min-[601px]:hidden">Get started</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
