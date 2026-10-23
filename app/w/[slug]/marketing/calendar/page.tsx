"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import {
  DayPanel,
  EventDialog,
  MonthGrid,
  daysInMonth,
  localDate,
  monthLabel,
  ymd,
  type CalendarEvent,
  type DayInfo,
  type EventDraft,
  type Festival,
  type Occasion,
} from "@/components/marketing/calendar";
import { TouchDialog } from "@/components/marketing/events";
import { broadcastHref, formatDate, parts, templateReady } from "@/components/marketing/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

const FESTIVAL_WIDTHS = ["w-2/3", "w-1/2", "w-3/4", "w-2/5", "w-3/5", "w-1/2", "w-2/3", "w-1/3"];

function FestivalsSkeleton() {
  return (
    <>
      {FESTIVAL_WIDTHS.map((width, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-1.5" aria-hidden>
          <div className="w-12 shrink-0">
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="flex h-5 min-w-0 flex-1 items-center">
            <Skeleton className={cn("h-3.5", width)} />
          </div>
        </div>
      ))}
    </>
  );
}

export default function MarketingCalendarPage() {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const timezone = workspace.timezone;
  const today = localDate(now, timezone);

  const [cursor, setCursor] = useState(() => {
    const { year, month } = parts(today);
    return { year, month };
  });
  const [selected, setSelected] = useState(today);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [touch, setTouch] = useState<{
    eventId: Id<"marketingEvents">;
    campaignId: Id<"marketingCampaigns">;
  } | null>(null);
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  const from = ymd(cursor.year, cursor.month, 1);
  const to = ymd(cursor.year, cursor.month, daysInMonth(cursor.year, cursor.month));

  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const calendar = useQuery(api.marketing.calendar, { workspaceId: workspace._id, from, to });
  const upcoming = useQuery(api.marketing.upcomingFestivals, {
    workspaceId: workspace._id,
    today,
    days: 120,
  });
  const openCampaign = useQuery(
    api.marketingCampaigns.get,
    touch ? { campaignId: touch.campaignId } : "skip"
  );
  const openTouch = openCampaign?.touches.find((t) => t._id === touch?.eventId);
  const templates = useMemo(() => overview?.templates ?? [], [overview]);

  const byDay = useMemo(() => {
    const map = new Map<string, DayInfo>();
    const slot = (date: string) => {
      const found = map.get(date) ?? { events: [], birthdays: [], festivals: [] };
      map.set(date, found);
      return found;
    };
    for (const event of calendar?.events ?? []) slot(event.date).events.push(event);
    for (const row of calendar?.birthdays ?? []) slot(`${cursor.year}-${row.birthday}`).birthdays.push(row);
    for (const festival of calendar?.festivals ?? []) slot(festival.date).festivals.push(festival);
    return map;
  }, [calendar, cursor.year]);

  const moveMonth = (by: number) => {
    const index = cursor.year * 12 + (cursor.month - 1) + by;
    const next = { year: Math.floor(index / 12), month: (index % 12) + 1 };
    setCursor(next);
    const first = ymd(next.year, next.month, 1);
    setSelected(today.slice(0, 7) === first.slice(0, 7) ? today : first);
  };

  const goToday = () => {
    const { year, month } = parts(today);
    setCursor({ year, month });
    setSelected(today);
  };

  const defaultTemplate = (occasion: Occasion) =>
    templates.find((t) => t.occasion === occasion && templateReady(t))?._id ??
    templates.find((t) => t.occasion === occasion)?._id;

  const newEvent = (date: string, title = "", presetKey?: string) =>
    setEventDraft({
      title,
      date: date < today ? today : date,
      sendHour: 9,
      presetKey,
      templateId: defaultTemplate(presetKey ? "festival" : "offer"),
    });

  const selectDay = (date: string) => {
    setSelected(date);
    if (window.matchMedia("(min-width: 80rem)").matches) return;
    requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const openEvent = (event: CalendarEvent) => {
    if (event.campaignId) {
      setTouch({ eventId: event._id, campaignId: event.campaignId });
      return;
    }
    if (
      event.trackLinks !== undefined ||
      event.audience !== undefined ||
      event.status === "paused" ||
      event.status === "cancelled"
    ) {
      router.push(broadcastHref(`/w/${workspace.slug}/marketing/campaigns`, event));
      return;
    }
    setEventDraft({
      eventId: event._id,
      title: event.title,
      date: event.date,
      sendHour: event.sendHour,
      templateId: event.templateId,
      presetKey: event.presetKey,
      saved: event,
    });
  };

  const newFromFestival = (festival: Festival) => newEvent(festival.date, festival.name, festival.key);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Calendar</h2>
          <p className="text-sm text-muted-foreground">
            Festival greetings, one-off sends, event reminders and birthdays, by day.
          </p>
        </div>
        <Button onClick={() => newEvent(selected)}>
          <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} /> Schedule greeting
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => moveMonth(-1)}>
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <Button size="icon" variant="outline" aria-label="Next month" onClick={() => moveMonth(1)}>
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
            <h3 className="ml-1 text-lg font-semibold">{monthLabel(cursor.year, cursor.month)}</h3>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={goToday}>
              Today
            </Button>
          </div>

          <MonthGrid
            year={cursor.year}
            month={cursor.month}
            today={today}
            selected={selected}
            byDay={byDay}
            onSelect={selectDay}
            onEvent={openEvent}
            onFestival={newFromFestival}
            loading={calendar === undefined}
          />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" /> Scheduled
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/50" /> Sent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-pink-600 dark:bg-pink-400" /> Birthday
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full border border-primary" /> Festival you can schedule
            </span>
          </div>
        </div>

        <div ref={panel} className="flex scroll-mt-4 flex-col gap-4">
          <DayPanel
            date={selected}
            today={today}
            info={byDay.get(selected)}
            onEvent={openEvent}
            onNew={() => newEvent(selected)}
            onFestival={newFromFestival}
            loading={calendar === undefined}
          />

          <Card size="sm">
            <CardHeader>
              <CardTitle>Festivals coming up</CardTitle>
              <CardDescription>
                The next four months. Dates of lunar festivals can shift a day by region — check
                before scheduling.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {upcoming === undefined ? (
                <FestivalsSkeleton />
              ) : upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every festival in the next four months is on your calendar.
                </p>
              ) : (
                upcoming.slice(0, 8).map((festival) => (
                  <button
                    key={`${festival.key}-${festival.date}`}
                    type="button"
                    onClick={() => newFromFestival(festival)}
                    className="group flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDate(festival.date, { day: "numeric", month: "short" })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{festival.name}</span>
                    <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-4 text-muted-foreground group-hover:text-primary" />
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <EventDialog
        draft={eventDraft}
        setDraft={setEventDraft}
        templates={templates}
        today={today}
        timezone={timezone}
        business={workspace.name}
        audienceSize={overview?.audience.whatsapp}
      />
      <TouchDialog
        key={`touch:${touch?.eventId ?? "none"}`}
        campaign={openCampaign ?? null}
        touch={openTouch ?? null}
        templates={templates}
        onClose={() => setTouch(null)}
      />

    </div>
  );
}
