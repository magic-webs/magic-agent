import Link from "next/link";
import Script from "next/script";
import { Instrument_Sans } from "next/font/google";
import { Logo } from "@/components/logo";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { SiteNav } from "@/components/landing/site-nav";
import { CONTAINER } from "@/components/landing/bits";
import { StoreBadges } from "@/components/landing/store-badges";
import { cn } from "@/lib/utils";

const display = Instrument_Sans({ subsets: ["latin"], variable: "--font-display" });

export function LandingShell({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      <noscript>
        <style>
          {"[data-reveal],[data-fade],[data-word]{opacity:1!important}[data-line]{transform:none!important}"}
        </style>
      </noscript>

      <div className={cn("landing isolate flex min-h-svh flex-col bg-(--paper) text-(--ink)", display.variable)}>
        <SiteNav />
        <main>{children}</main>
        <SiteFooter />
      </div>

      <Script
        src="https://agent.magicwebs.ai/widget/gpxtzfkin6ma6113t41xib2ib45t/embed.js"
        strategy="lazyOnload"
      />
    </SmoothScroll>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-[#1a1918] text-white">
      <div className={cn(CONTAINER, "pt-6 pb-10")}>
        <div className="grid gap-10 border-t border-white/10 pt-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex flex-col gap-4">
            <span className="flex items-center gap-2">
              <Logo className="h-7" />
              <span className="font-display text-lg font-semibold tracking-tight">Magic Agent</span>
            </span>
            <p className="max-w-xs text-sm leading-relaxed text-white/60">
              AI agents that answer your customers on WhatsApp, Instagram and web chat.
            </p>
            <a href="mailto:support@magicwebs.ai" className="text-sm text-white hover:underline">
              support@magicwebs.ai
            </a>
            <StoreBadges className="mt-2" />
          </div>
          <nav className="flex flex-col gap-3 text-sm text-white/60">
            <span className="text-xs tracking-[0.12em] text-white/40 uppercase">Product</span>
            <Link href="/#work" className="hover:text-white">How it works</Link>
            <Link href="/#use-cases" className="hover:text-white">Use cases</Link>
            <Link href="/#templates" className="hover:text-white">Templates</Link>
            <Link href="/pricing" className="hover:text-white">Pricing</Link>
            <Link href="/login" className="hover:text-white">Sign in</Link>
          </nav>
          {/* The store listing points at these, so they must stay reachable from the front page. */}
          <nav className="flex flex-col gap-3 text-sm text-white/60">
            <span className="text-xs tracking-[0.12em] text-white/40 uppercase">Company</span>
            <Link href="/support" className="hover:text-white">Support</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <Link href="/delete-account" className="hover:text-white">Delete account</Link>
          </nav>
        </div>
        <p className="mt-14 text-xs text-white/40">© 2026 Magic Agent</p>
      </div>
    </footer>
  );
}
