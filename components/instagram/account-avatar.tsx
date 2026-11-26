"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { InstagramIcon } from "@hugeicons/core-free-icons";
import { ChannelMark } from "@/components/channel-mark";
import { INSTAGRAM_GRADIENT, type InstagramChannel } from "@/components/instagram/context";
import { cn } from "@/lib/utils";

export function AccountAvatar({
  channel,
  size,
  className,
}: {
  channel: Pick<InstagramChannel, "type" | "profilePictureUrl">;
  size: number;
  className?: string;
}) {
  const src = channel.profilePictureUrl;
  const [broken, setBroken] = useState<string | null>(null);
  const style = { width: size, height: size };

  if (src && broken !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        style={style}
        onError={() => setBroken(src)}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  if (channel.type === "messenger") {
    return <ChannelMark type="messenger" size={size} className={className} />;
  }
  return (
    <span
      style={style}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-white",
        INSTAGRAM_GRADIENT,
        className
      )}
    >
      <HugeiconsIcon icon={InstagramIcon} strokeWidth={2} className="size-1/2" />
    </span>
  );
}
