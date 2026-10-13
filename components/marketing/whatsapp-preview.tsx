"use client";

import { cn } from "cn";
import { renderTemplate, sampleValues } from "@/convex/lib/marketing";
import { orderedButtons, tidyParts, type TemplateButton } from "@/convex/lib/templateParts";
import { WhatsAppText } from "@/components/whatsapp-text";
import {
  ArrowSquareOutIcon,
  ArrowUUpLeftIcon,
  BatteryFullIcon,
  CameraIcon,
  CaretLeftIcon,
  CellSignalFullIcon,
  ListBulletsIcon,
  MicrophoneIcon,
  PaperclipIcon,
  PhoneIcon,
  SealCheckIcon,
  SmileyIcon,
  WifiHighIcon,
} from "@phosphor-icons/react";

const BUTTON_ICON = {
  quick_reply: ArrowUUpLeftIcon,
  url: ArrowSquareOutIcon,
  phone: PhoneIcon,
} as const;

export function WhatsAppPreview({
  body,
  header,
  footer,
  buttons,
  business,
  occasion,
  size = "phone",
  className,
}: {
  body: string;
  header?: string;
  footer?: string;
  buttons?: TemplateButton[];
  business: string;
  occasion?: string;
  size?: "phone" | "card";
  className?: string;
}) {
  const parts = tidyParts({ header, footer, buttons });
  const text = body.trim()
    ? renderTemplate(body.trim(), sampleValues(business, occasion)).text
    : "";
  const shown = orderedButtons(parts.buttons);
  const visible = shown.length > 3 ? shown.slice(0, 2) : shown;

  const message = (
    <div className="flex max-w-[88%] flex-col self-start">
      <div className="relative rounded-lg rounded-tl-none bg-background px-2.5 pt-1.5 pb-1 text-[12.5px] leading-snug text-foreground shadow-sm">
        {parts.header ? (
          <p className="mb-1 font-semibold break-words">{parts.header}</p>
        ) : null}
        {text ? (
          <div className="break-words whitespace-pre-wrap">
            <WhatsAppText text={text} />
          </div>
        ) : (
          <p className="text-muted-foreground italic">Your message shows here</p>
        )}
        {parts.footer ? (
          <p className="mt-1 text-[11px] break-words text-muted-foreground">{parts.footer}</p>
        ) : null}
        <p className="mt-0.5 text-right text-[10px] text-muted-foreground">11:32 am</p>
        {visible.length > 0 ? (
          <div className="-mx-2.5 mt-1 flex flex-col">
            {visible.map((button, index) => {
              const Icon = BUTTON_ICON[button.type];
              return (
                <span
                  key={`${button.type}-${index}`}
                  className="flex items-center justify-center gap-1.5 border-t border-border/70 px-2 py-2 text-[12.5px] font-medium text-[var(--chat-action)]"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{button.text || "Button"}</span>
                </span>
              );
            })}
            {shown.length > 3 ? (
              <span className="flex items-center justify-center gap-1.5 border-t border-border/70 px-2 py-2 text-[12.5px] font-medium text-[var(--chat-action)]">
                <ListBulletsIcon className="size-3.5 shrink-0" />
                See all options
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (size === "card") {
    return (
      <div
        data-chat="whatsapp"
        className={cn("overflow-hidden rounded-md border border-border", className)}
      >
        <div
          data-slot="message-scroller-viewport"
          className="flex max-h-56 flex-col overflow-hidden p-2.5"
        >
          {message}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("mx-auto w-[280px]", className)} aria-label="Preview on a phone">
      <div className="rounded-[2.6rem] bg-gradient-to-b from-neutral-300 via-neutral-400 to-neutral-300 p-[3px] shadow-xl ring-1 ring-foreground/10 dark:from-neutral-700 dark:via-neutral-800 dark:to-neutral-700">
        <div className="rounded-[2.45rem] bg-neutral-950 p-[8px]">
          <div
            data-chat="whatsapp"
            className="relative flex h-[540px] flex-col overflow-hidden rounded-[2.05rem] bg-card"
          >
            <span
              aria-hidden
              className="absolute top-[8px] left-1/2 z-20 h-[18px] w-[70px] -translate-x-1/2 rounded-full bg-neutral-950"
            />
            <div
              aria-hidden
              className="flex shrink-0 items-center justify-between px-5 pt-3 pb-1 text-[10px] font-semibold"
            >
              <span>9:41</span>
              <span className="flex items-center gap-1">
                <CellSignalFullIcon className="size-3" />
                <WifiHighIcon className="size-3" />
                <BatteryFullIcon className="size-3.5" />
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
              <CaretLeftIcon aria-hidden className="size-4 shrink-0 text-[var(--chat-action)]" />
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white"
              >
                {(business.trim()[0] ?? "B").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[12.5px] leading-tight font-semibold">
                  <span className="truncate">{business || "Your business"}</span>
                  <SealCheckIcon weight="fill" className="size-3 shrink-0 text-emerald-500" />
                </span>
                <span className="block truncate text-[9.5px] leading-tight text-muted-foreground">
                  Business account
                </span>
              </span>
            </div>
            <div
              data-slot="message-scroller-viewport"
              className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-y-auto px-2 py-2.5"
            >
              <span className="mx-auto mb-1 rounded-md bg-background/80 px-2 py-0.5 text-[8.5px] font-medium tracking-wide text-muted-foreground uppercase shadow-sm">
                Today
              </span>
              {message}
            </div>
            <div aria-hidden className="flex shrink-0 items-center gap-1.5 px-2 pt-1.5 pb-3">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1.5">
                <SmileyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-[11px] text-muted-foreground">Message</span>
                <PaperclipIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                <CameraIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </span>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <MicrophoneIcon className="size-3.5" />
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Sample values fill the blanks — each customer sees their own.
      </p>
    </div>
  );
}
