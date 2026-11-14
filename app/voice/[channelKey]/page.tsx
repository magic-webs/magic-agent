"use client";

import { use, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { VoiceOrb, type OrbState } from "@/components/voice-orb";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { cn } from "@/lib/utils";

const ORB_SIZE = { small: 88, medium: 120, large: 160 } as const;
const STANDALONE_ORB = 240;

const STATUS: Record<OrbState, string> = {
  idle: "Tap to talk",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Tap to end",
};

const noopSubscribe = () => () => {};
const sessions = new Map<string, string>();

function readOrCreateSession(storageKey: string): string {
  const cached = sessions.get(storageKey);
  if (cached) return cached;
  let existing: string | null = null;
  try {
    existing = window.localStorage.getItem(storageKey);
  } catch {}
  if (!existing || !/^voice-[a-z0-9]+$/i.test(existing)) {
    existing = `voice-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    try {
      window.localStorage.setItem(storageKey, existing);
    } catch {}
  }
  sessions.set(storageKey, existing);
  return existing;
}

function useSessionId(channelKey: string): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => readOrCreateSession(`magic-ai-bot:voice-session:${channelKey}`),
    () => null
  );
}

function useEmbedded(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get("embed") === "1",
    () => false
  );
}

function useTransparentDocument(embedded: boolean) {
  useEffect(() => {
    if (!embedded) return;
    const root = document.documentElement;
    const previous = {
      root: root.style.background,
      body: document.body.style.background,
      scheme: root.style.colorScheme,
    };
    root.style.background = "transparent";
    document.body.style.background = "transparent";
    root.style.colorScheme = "normal";
    return () => {
      root.style.background = previous.root;
      document.body.style.background = previous.body;
      root.style.colorScheme = previous.scheme;
    };
  }, [embedded]);
}

function useReportSize(embedded: boolean, channelKey: string) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!embedded || !element || window.parent === window) return;
    const report = () => {
      const rect = element.getBoundingClientRect();
      window.parent.postMessage(
        {
          type: "magic-ai-bot:voice-size",
          channelKey,
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        },
        "*"
      );
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  });
  return box;
}

export default function VoiceWidgetPage({
  params,
}: {
  params: Promise<{ channelKey: string }>;
}) {
  const { channelKey } = use(params);
  const sessionId = useSessionId(channelKey);
  const embedded = useEmbedded();
  const widget = useQuery(api.voiceWidget.bootstrap, { channelKey });
  const greetAction = useAction(api.engine.greetFromVoice);
  const respondAction = useAction(api.engine.respondFromVoice);
  useTransparentDocument(embedded);

  const greet = useCallback(
    () => greetAction({ channelKey, sessionId: sessionId ?? "" }),
    [greetAction, channelKey, sessionId]
  );
  const respond = useCallback(
    (audio: ArrayBuffer) => respondAction({ channelKey, sessionId: sessionId ?? "", audio }),
    [respondAction, channelKey, sessionId]
  );
  const call = useVoiceCall({ greet, respond });
  const box = useReportSize(embedded, channelKey);

  if (widget === undefined) return null;
  if (widget === null) {
    return embedded ? null : (
      <main className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
        This voice assistant is not available.
      </main>
    );
  }

  const top = widget.position.startsWith("top");
  const align = widget.position.endsWith("left")
    ? "items-start"
    : widget.position.endsWith("right")
      ? "items-end"
      : "items-center";
  const size = embedded ? ORB_SIZE[widget.size] : STANDALONE_ORB;
  const inCall = call.state !== "idle";
  const caption = widget.captions || call.caption?.who === "error" ? call.caption : null;

  const orb = (
    <button
      type="button"
      onClick={call.toggle}
      disabled={!call.supported || !sessionId}
      aria-label={inCall ? `End the call with ${widget.botName}` : `Talk to ${widget.botName}`}
      aria-pressed={inCall}
      className="shrink-0 cursor-pointer rounded-full outline-none transition-transform duration-200 hover:scale-[1.04] active:scale-95 focus-visible:ring-4 focus-visible:ring-white/60 disabled:cursor-not-allowed"
    >
      <VoiceOrb
        style={widget.style}
        colors={widget.colors}
        state={call.state}
        size={size}
        getInputVolume={call.getInputVolume}
        getOutputVolume={call.getOutputVolume}
      />
    </button>
  );

  const label = (
    <div className={cn("flex max-w-[280px] flex-col gap-1.5", align)}>
      {caption ? (
        <p
          key={caption.text}
          role="status"
          className={cn(
            "line-clamp-4 animate-in fade-in slide-in-from-bottom-1 rounded-2xl px-3.5 py-2 text-[13px] leading-snug shadow-lg backdrop-blur-md duration-300",
            caption.who === "error"
              ? "bg-red-600/90 text-white"
              : caption.who === "you"
                ? "bg-white/85 text-neutral-600 italic"
                : "bg-neutral-900/85 text-white"
          )}
        >
          {caption.text}
        </p>
      ) : null}
      <span className="rounded-full bg-neutral-900/75 px-2.5 py-1 text-[11px] font-medium text-white shadow backdrop-blur-md">
        {call.supported ? (call.state === "idle" ? `Talk to ${widget.botName}` : STATUS[call.state]) : "Voice is not supported in this browser"}
      </span>
    </div>
  );

  if (!embedded) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_50%_30%,#1f1b3a,#08070f)] p-6 text-white">
        <p className="text-sm text-white/60">{widget.workspaceName}</p>
        {orb}
        <div className="flex min-h-24 flex-col items-center">{label}</div>
      </main>
    );
  }

  return (
    <div
      ref={box}
      className={cn("inline-flex flex-col gap-1 p-2", align, top ? "" : "flex-col-reverse")}
    >
      {orb}
      {label}
    </div>
  );
}
