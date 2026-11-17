"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Call02Icon, TickDouble02Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./kit";
import "./whatsapp.css";

export function Msg({ text, time, read }: { text: string; time: string; read?: boolean }) {
  return (
    <>
      <span className="wa-text">
        <span>{text} </span>
        <span className="wa-spacer" aria-hidden>
          {time}
          {read && <span className="wa-spacer__tick" />}
        </span>
      </span>
      <Meta time={time} read={read} />
    </>
  );
}

export function Meta({ time, read }: { time: string; read?: boolean }) {
  return (
    <span className="wa-meta">
      {time}
      {read && <HugeiconsIcon icon={TickDouble02Icon} size={16} strokeWidth={1.8} className="wa-ticks" aria-hidden />}
    </span>
  );
}

export function WhatsAppHeader({ name }: { name: string }) {
  return (
    <header className="wa-head">
      <HugeiconsIcon icon={ArrowLeft01Icon} size={28} strokeWidth={2} className="wa-back" aria-hidden />
      <span className="wa-avatar" data-crop aria-hidden>
        <Icon name="user" filled size={22} />
      </span>
      <span className="wa-who">
        <span className="wa-name">{name}</span>
        <span className="wa-status">Business account</span>
      </span>
      <span className="wa-actions">
        <HugeiconsIcon icon={Video01Icon} size={24} strokeWidth={1.8} aria-hidden />
        <HugeiconsIcon icon={Call02Icon} size={22} strokeWidth={1.8} aria-hidden />
      </span>
    </header>
  );
}
