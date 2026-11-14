"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { WIDGET_ICONS, WIDGET_SIZES, widgetInk, type WidgetIcon } from "@/lib/widget-icons";

export type WebWidgetSettings = NonNullable<Doc<"channels">["webWidget"]>;

export const DEFAULT_WEB_WIDGET_SETTINGS: WebWidgetSettings = {
  icon: "chat",
  color: "#2563eb",
  position: "bottom-right",
  size: "medium",
  animation: "none",
};

const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0d9488", "#0f172a"];

const POSITIONS: { value: WebWidgetSettings["position"]; label: string }[] = [
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

const SIZES: { value: WebWidgetSettings["size"]; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const ANIMATIONS: { value: WebWidgetSettings["animation"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "pulse", label: "Pulse" },
  { value: "bounce", label: "Bounce" },
  { value: "wiggle", label: "Wiggle" },
  { value: "breathe", label: "Breathe" },
];

function Glyph({ icon, size }: { icon: WidgetIcon; size: number }) {
  const def = WIDGET_ICONS[icon] ?? WIDGET_ICONS.chat;
  const paint = def.filled
    ? { fill: "currentColor" }
    : {
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
      };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      {...paint}
      dangerouslySetInnerHTML={{ __html: def.svg }}
    />
  );
}

export function WebWidgetLauncher({
  settings,
  scale = 1,
}: {
  settings: WebWidgetSettings;
  scale?: number;
}) {
  const size = WIDGET_SIZES[settings.size] * scale;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full shadow-lg"
      style={{
        width: size,
        height: size,
        background: settings.color,
        color: widgetInk(settings.color),
      }}
    >
      <Glyph icon={settings.icon} size={Math.round(size * 0.48)} />
    </span>
  );
}

export function WebWidgetPreview({ settings }: { settings: WebWidgetSettings }) {
  const left = settings.position === "bottom-left";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2">
        <span className="size-2 rounded-full bg-red-400" />
        <span className="size-2 rounded-full bg-amber-400" />
        <span className="size-2 rounded-full bg-green-400" />
        <span className="ml-2 h-4 flex-1 rounded bg-background" />
      </div>
      <div className="relative h-56 bg-[linear-gradient(180deg,var(--muted)_0,transparent_40%)]">
        <div className="flex flex-col gap-2 p-5 opacity-60">
          <span className="h-3 w-1/3 rounded bg-muted-foreground/25" />
          <span className="h-2 w-2/3 rounded bg-muted-foreground/15" />
          <span className="h-2 w-1/2 rounded bg-muted-foreground/15" />
          <span className="mt-3 h-16 w-full rounded-lg bg-muted-foreground/10" />
        </div>
        <div
          className={cn(
            "absolute bottom-3 flex items-center gap-2 transition-all duration-300",
            left ? "left-3 flex-row-reverse" : "right-3"
          )}
        >
          {settings.teaser ? (
            <span className="max-w-40 rounded-xl border border-border bg-white px-3 py-1.5 text-xs text-gray-900 shadow-md">
              {settings.teaser}
            </span>
          ) : null}
          <span
            className={cn(
              settings.animation === "bounce" && "animate-bounce",
              settings.animation !== "none" && settings.animation !== "bounce" && "animate-pulse"
            )}
          >
            <WebWidgetLauncher settings={settings} scale={0.8} />
          </span>
        </div>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  columns,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  columns: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div role="radiogroup" aria-label={label} className={cn("grid gap-1.5", columns)}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              value === option.value ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WebWidgetAppearance({
  settings,
  onChange,
}: {
  settings: WebWidgetSettings;
  onChange: (patch: Partial<WebWidgetSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Icon</Label>
        <div role="radiogroup" aria-label="Icon" className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
          {(Object.keys(WIDGET_ICONS) as WidgetIcon[]).map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={settings.icon === icon}
              title={WIDGET_ICONS[icon].label}
              onClick={() => onChange({ icon })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                settings.icon === icon ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50"
              )}
            >
              <Glyph icon={icon} size={20} />
              {WIDGET_ICONS[icon].label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Colour</Label>
        <div className="flex flex-wrap items-center gap-2">
          {COLORS.map((color) => {
            const chosen = settings.color.toLowerCase() === color;
            return (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={chosen}
                onClick={() => onChange({ color })}
                style={{ background: color }}
                className={cn(
                  "size-7 rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  chosen && "ring-2 ring-primary"
                )}
              />
            );
          })}
          <span className="mx-1 h-5 w-px bg-border" />
          <input
            type="color"
            aria-label="Custom colour"
            value={settings.color}
            onChange={(event) => onChange({ color: event.target.value })}
            className="size-7 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Choice
          label="Position"
          value={settings.position}
          options={POSITIONS}
          onChange={(position) => onChange({ position })}
          columns="grid-cols-2"
        />
        <Choice
          label="Size"
          value={settings.size}
          options={SIZES}
          onChange={(size) => onChange({ size })}
          columns="grid-cols-3"
        />
      </div>

      <Choice
        label="Animation"
        value={settings.animation}
        options={ANIMATIONS}
        onChange={(animation) => onChange({ animation })}
        columns="grid-cols-5"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ww-label">Button tooltip</Label>
          <Input
            id="ww-label"
            maxLength={60}
            placeholder="Chat with us"
            value={settings.label ?? ""}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ww-auto">Open by itself after (seconds)</Label>
          <Input
            id="ww-auto"
            type="number"
            min={0}
            max={600}
            placeholder="Never"
            value={settings.autoOpenSeconds ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              onChange({ autoOpenSeconds: raw === "" ? undefined : Number(raw) });
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ww-teaser">Teaser bubble</Label>
        <Input
          id="ww-teaser"
          maxLength={120}
          placeholder="Hi! Need a hand?"
          value={settings.teaser ?? ""}
          onChange={(event) => onChange({ teaser: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          A one-line bubble beside the button until someone opens the chat. Leave empty for none.
        </p>
      </div>
    </div>
  );
}
