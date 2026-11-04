"use client";

import { cn } from "cn";
import { renderTemplate, sampleValues } from "@/convex/lib/marketing";
import {
  orderedButtons,
  tidyParts,
  type TemplateButton,
  type TemplateCard,
} from "@/convex/lib/templateParts";
import { WhatsAppText } from "@/components/whatsapp-text";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowTurnBackwardIcon,
  Attachment01Icon,
  BatteryFullIcon,
  Call02Icon,
  Camera01Icon,
  CheckmarkBadge01Icon,
  Image01Icon,
  LeftToRightListBulletIcon,
  LinkSquare02Icon,
  Mic01Icon,
  PlayIcon,
  SignalFull02Icon,
  SmileIcon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons";

const BUTTON_ICON = {
  quick_reply: ArrowTurnBackwardIcon,
  url: LinkSquare02Icon,
  phone: Call02Icon,
} as const;

export type PreviewCard = {
  media?: { type: "image" | "video"; url?: string };
  body: string;
  buttons: TemplateButton[];
};

/** A saved template's cards, in the shape the preview takes. */
export function previewCards(template?: {
  cards?: TemplateCard[];
  cardMediaUrls?: Array<string | null>;
}): PreviewCard[] | undefined {
  if (!template?.cards?.length) return undefined;
  return template.cards.map((card, index) => ({
    media: card.media
      ? { type: card.media.type, url: template.cardMediaUrls?.[index] ?? undefined }
      : undefined,
    body: card.body,
    buttons: card.buttons,
  }));
}

function MediaFrame({
  media,
  className,
}: {
  media: { type: "image" | "video"; url?: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        className
      )}
    >
      {media.url && media.type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" className="size-full object-cover" />
      ) : media.url ? (
        <video src={media.url} muted className="size-full object-cover" />
      ) : (
        <HugeiconsIcon icon={Image01Icon} strokeWidth={2} className="size-6" />
      )}
      {media.type === "video" ? (
        <span className="absolute flex size-9 items-center justify-center rounded-full bg-black/50 text-white">
          <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-4" />
        </span>
      ) : null}
    </div>
  );
}

function CarouselCards({ cards }: { cards: PreviewCard[] }) {
  return (
    <div className="-mr-2 flex shrink-0 snap-x snap-mandatory gap-1.5 overflow-x-auto pr-2 pb-1">
      {cards.map((card, index) => (
        <div
          key={index}
          className="flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-lg bg-background text-[12.5px] leading-snug text-foreground shadow-sm"
        >
          {card.media ? (
            <MediaFrame media={card.media} className="aspect-square" />
          ) : (
            <MediaFrame media={{ type: "image" }} className="aspect-square" />
          )}
          <p className="flex-1 px-2.5 py-1.5 break-words whitespace-pre-wrap">
            {card.body.trim() || <span className="text-muted-foreground italic">Card text</span>}
          </p>
          {card.buttons.map((button, buttonIndex) => (
            <span
              key={`${button.type}-${buttonIndex}`}
              className="flex items-center justify-center gap-1.5 border-t border-border/70 px-2 py-2 font-medium text-[var(--chat-action)]"
            >
              <HugeiconsIcon icon={BUTTON_ICON[button.type]} strokeWidth={2} className="size-3.5 shrink-0" />
              <span className="truncate">{button.text || "Button"}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function WhatsAppPreview({
  body,
  header,
  headerMedia,
  footer,
  buttons,
  cards,
  business,
  occasion,
  size = "phone",
  className,
}: {
  body: string;
  header?: string;
  headerMedia?: { type: "image" | "video"; url?: string };
  footer?: string;
  buttons?: TemplateButton[];
  cards?: PreviewCard[];
  business: string;
  occasion?: string;
  size?: "phone" | "card";
  className?: string;
}) {
  const carousel = cards && cards.length > 0 ? cards : null;
  const parts: ReturnType<typeof tidyParts> = carousel ? {} : tidyParts({ header, footer, buttons });
  const text = body.trim()
    ? renderTemplate(body.trim(), sampleValues(business, occasion)).text
    : "";
  const shown = orderedButtons(parts.buttons);
  const visible = shown.length > 3 ? shown.slice(0, 2) : shown;

  const bubble = (
    <div className="flex max-w-[88%] shrink-0 flex-col self-start">
      <div className="relative rounded-lg rounded-tl-none bg-background px-2.5 pt-1.5 pb-1 text-[12.5px] leading-snug text-foreground shadow-sm">
        {headerMedia && !carousel ? (
          <div className="relative -mx-1.5 mb-1.5 flex aspect-[1.91/1] items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
            {headerMedia.url && headerMedia.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={headerMedia.url} alt="" className="size-full object-cover" />
            ) : headerMedia.url ? (
              <video src={headerMedia.url} muted className="size-full object-cover" />
            ) : (
              <HugeiconsIcon icon={Image01Icon} strokeWidth={2} className="size-6" />
            )}
            {headerMedia.type === "video" ? (
              <span className="absolute flex size-9 items-center justify-center rounded-full bg-black/50 text-white">
                <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-4" />
              </span>
            ) : null}
          </div>
        ) : parts.header ? (
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
              return (
                <span
                  key={`${button.type}-${index}`}
                  className="flex items-center justify-center gap-1.5 border-t border-border/70 px-2 py-2 text-[12.5px] font-medium text-[var(--chat-action)]"
                >
                  <HugeiconsIcon icon={BUTTON_ICON[button.type]} strokeWidth={2} className="size-3.5 shrink-0" />
                  <span className="truncate">{button.text || "Button"}</span>
                </span>
              );
            })}
            {shown.length > 3 ? (
              <span className="flex items-center justify-center gap-1.5 border-t border-border/70 px-2 py-2 text-[12.5px] font-medium text-[var(--chat-action)]">
                <HugeiconsIcon icon={LeftToRightListBulletIcon} strokeWidth={2} className="size-3.5 shrink-0" />
                See all options
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  const message = carousel ? (
    <div className="flex shrink-0 flex-col gap-1.5">
      {bubble}
      <CarouselCards cards={carousel} />
    </div>
  ) : (
    bubble
  );

  if (size === "card") {
    return (
      <div
        data-chat="whatsapp"
        className={cn("overflow-hidden rounded-md border border-border", className)}
      >
        <div
          data-slot="message-scroller-viewport"
          className={cn("flex flex-col overflow-y-auto overscroll-contain p-2.5", carousel ? "max-h-[26rem]" : "max-h-56")}
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
                <HugeiconsIcon icon={SignalFull02Icon} strokeWidth={2} className="size-3" />
                <HugeiconsIcon icon={Wifi01Icon} strokeWidth={2} className="size-3" />
                <HugeiconsIcon icon={BatteryFullIcon} strokeWidth={2} className="size-3.5" />
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden className="size-4 shrink-0 text-[var(--chat-action)]" />
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white"
              >
                {(business.trim()[0] ?? "B").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-[12.5px] leading-tight font-semibold">
                  <span className="truncate">{business || "Your business"}</span>
                  <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-3 shrink-0 text-emerald-500" />
                </span>
                <span className="block truncate text-[9.5px] leading-tight text-muted-foreground">
                  Business account
                </span>
              </span>
            </div>
            <div
              data-slot="message-scroller-viewport"
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-2 py-2.5"
            >
              <span className="mx-auto mt-auto mb-1 shrink-0 rounded-md bg-background/80 px-2 py-0.5 text-[8.5px] font-medium tracking-wide text-muted-foreground uppercase shadow-sm">
                Today
              </span>
              {message}
            </div>
            <div aria-hidden className="flex shrink-0 items-center gap-1.5 px-2 pt-1.5 pb-3">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1.5">
                <HugeiconsIcon icon={SmileIcon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-[11px] text-muted-foreground">Message</span>
                <HugeiconsIcon icon={Attachment01Icon} strokeWidth={2} className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                <HugeiconsIcon icon={Camera01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
              </span>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} className="size-3.5" />
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
