"use client";

import { GlobeIcon } from "@phosphor-icons/react";
import {
  InstagramLogo,
  RcsLogo,
  TelegramLogo,
  WhatsAppLogo,
} from "@/components/brand-icons";
import { cn } from "@/lib/utils";

export type ChannelKind = "whatsapp" | "instagram" | "rcs" | "telegram" | "web";

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  rcs: "RCS",
  telegram: "Telegram",
  web: "Web chat",
};

export const CHANNEL_TILE: Record<ChannelKind, string> = {
  whatsapp: "bg-[#25D366]",
  instagram:
    "bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)]",
  rcs: "bg-[#1A73E8]",
  telegram: "bg-[#229ED9]",
  web: "bg-sky-500",
};

/** The channel's glyph alone, in `currentColor`. */
export function ChannelGlyph({
  type,
  className,
}: {
  type: ChannelKind;
  className?: string;
}) {
  switch (type) {
    case "whatsapp":
      return <WhatsAppLogo className={className} />;
    case "instagram":
      return <InstagramLogo className={className} />;
    case "rcs":
      return <RcsLogo className={className} />;
    case "telegram":
      return <TelegramLogo className={className} />;
    default:
      return <GlobeIcon weight="bold" className={cn("size-4 shrink-0", className)} />;
  }
}

/** The channel as its own brand draws it: a white glyph on the brand's colour. */
export function ChannelMark({
  type,
  size = 16,
  className,
}: {
  type: ChannelKind;
  size?: number;
  className?: string;
}) {
  const glyph = { width: size * 0.66, height: size * 0.66 };
  return (
    <span
      role="img"
      aria-label={CHANNEL_LABEL[type]}
      title={CHANNEL_LABEL[type]}
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-white",
        CHANNEL_TILE[type],
        className
      )}
    >
      <span style={glyph} className="flex">
        <ChannelGlyph type={type} className="size-full" />
      </span>
    </span>
  );
}
