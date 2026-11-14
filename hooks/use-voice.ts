"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_RECORDING_MS = 60_000;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(
    (type) => MediaRecorder.isTypeSupported(type)
  );
}

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const finished = useRef<((audio: ArrayBuffer | null) => void) | null>(null);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const start = useCallback(async () => {
    if (recorder.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    const next = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    cancelled.current = false;
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    next.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) clearTimeout(timer.current);
      recorder.current = null;
      setRecording(false);
      const blob = new Blob(chunks.current, { type: next.mimeType });
      const audio = cancelled.current || blob.size === 0 ? null : await blob.arrayBuffer();
      finished.current?.(audio);
      finished.current = null;
    };
    recorder.current = next;
    next.start();
    setRecording(true);
    timer.current = setTimeout(() => {
      if (next.state === "recording") next.stop();
    }, MAX_RECORDING_MS);
  }, []);

  const stop = useCallback(
    () =>
      new Promise<ArrayBuffer | null>((resolve) => {
        const current = recorder.current;
        if (!current || current.state !== "recording") return resolve(null);
        finished.current = resolve;
        current.stop();
      }),
    []
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  useEffect(() => () => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  return { supported, recording, start, stop, cancel };
}

export function usePlayer(load: (id: string) => Promise<{ url: string }>) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const stop = useCallback(() => {
    audio.current?.pause();
    setPlayingId(null);
  }, []);

  const play = useCallback(async (id: string) => {
    audio.current?.pause();
    setPlayingId(null);
    setLoadingId(id);
    try {
      const { url } = await loadRef.current(id);
      const element = audio.current ?? new Audio();
      audio.current = element;
      element.src = url;
      element.onended = () => setPlayingId((current) => (current === id ? null : current));
      element.onerror = () => setPlayingId((current) => (current === id ? null : current));
      await element.play();
      setPlayingId(id);
    } finally {
      setLoadingId((current) => (current === id ? null : current));
    }
  }, []);

  const toggle = useCallback(
    (id: string) => (playingId === id ? stop() : play(id)),
    [playingId, play, stop]
  );

  useEffect(() => () => audio.current?.pause(), []);

  return { playingId, loadingId, play, stop, toggle };
}

export function useAutoSpeak(
  messages: { id: string; role: string }[] | undefined,
  shouldSpeak: () => boolean,
  speak: (id: string) => void
) {
  const seen = useRef<Set<string> | null>(null);
  const shouldRef = useRef(shouldSpeak);
  const speakRef = useRef(speak);
  useEffect(() => {
    shouldRef.current = shouldSpeak;
    speakRef.current = speak;
  });

  useEffect(() => {
    if (!messages) return;
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id));
      return;
    }
    const fresh = messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    const reply = fresh.findLast((m) => m.role === "assistant");
    if (reply && shouldRef.current()) speakRef.current(reply.id);
  }, [messages]);
}

export function useTypewriter(target: string, charsPerFrame = 3): string {
  const [shown, setShown] = useState(0);
  const length = target.length;

  useEffect(() => {
    if (shown >= length) return;
    const frame = requestAnimationFrame(() => {
      const behind = length - shown;
      setShown((prev) => Math.min(length, prev + Math.max(charsPerFrame, Math.ceil(behind / 20))));
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, length, charsPerFrame]);

  return target.slice(0, Math.min(shown, length));
}

export function useStoredFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initial;
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* blocked site data */
      }
    },
    [key]
  );
  return [value, update] as const;
}
