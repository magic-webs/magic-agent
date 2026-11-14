"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { OrbState } from "@/components/voice-orb";

export type VoiceReply = {
  heard: string;
  reply: string | null;
  audio: ArrayBuffer | null;
  mediaType: string | null;
  error?: string;
};

const noop = () => () => {};

const SILENCE_MS = 1100;
const NO_SPEECH_MS = 12_000;
const MAX_TURN_MS = 30_000;
const CALIBRATE_MS = 300;
const MIN_SPEECH_MS = 250;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(
    (type) => MediaRecorder.isTypeSupported(type)
  );
}

function rms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.sqrt(sum / buffer.length);
}

export function useVoiceCall({
  greet,
  respond,
}: {
  greet: () => Promise<VoiceReply>;
  respond: (audio: ArrayBuffer) => Promise<VoiceReply>;
}) {
  const [state, setState] = useState<OrbState>("idle");
  const [caption, setCaption] = useState<{ who: "you" | "agent" | "error"; text: string } | null>(null);
  const active = useRef(false);
  const greeted = useRef(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const outAnalyser = useRef<AnalyserNode | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<OrbState>("idle");
  const handlers = useRef({ greet, respond });
  const sample = useRef(new Float32Array(1024));
  const relisten = useRef<() => void>(() => {});

  useEffect(() => {
    handlers.current = { greet, respond };
  }, [greet, respond]);

  const move = useCallback((next: OrbState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const volume = (analyser: AnalyserNode | null) =>
    analyser ? Math.min(1, rms(analyser, sample.current) * 4) : 0;

  const getInputVolume = useCallback(() => {
    if (stateRef.current === "listening") return volume(micAnalyser.current);
    if (stateRef.current === "speaking") return volume(outAnalyser.current) * 0.8;
    return 0;
  }, []);

  const getOutputVolume = useCallback(
    () => (stateRef.current === "speaking" ? volume(outAnalyser.current) : 0.3),
    []
  );

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const end = useCallback(() => {
    active.current = false;
    clearTimer();
    if (recorder.current?.state === "recording") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    recorder.current = null;
    try {
      source.current?.stop();
    } catch {}
    source.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    micAnalyser.current = null;
    move("idle");
  }, [move]);

  const play = useCallback(
    async (reply: VoiceReply): Promise<void> => {
      const ctx = audioCtx.current;
      if (!ctx || !reply.audio || !active.current) return;
      const decoded = await ctx.decodeAudioData(reply.audio.slice(0));
      if (!active.current) return;
      const node = ctx.createBufferSource();
      node.buffer = decoded;
      node.connect(outAnalyser.current!);
      source.current = node;
      move("speaking");
      await new Promise<void>((resolve) => {
        node.onended = () => resolve();
        node.start();
      });
      source.current = null;
    },
    [move]
  );

  const listen = useCallback(() => {
    const media = stream.current;
    const analyser = micAnalyser.current;
    if (!active.current || !media || !analyser) return;
    const mimeType = pickMimeType();
    const next = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = performance.now();
    let floor = 0;
    let floorSamples = 0;
    let speechAt = 0;
    let lastVoice = 0;

    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    next.onstop = async () => {
      clearTimer();
      recorder.current = null;
      if (!active.current) return;
      if (!speechAt) {
        end();
        return;
      }
      move("thinking");
      try {
        const blob = new Blob(chunks, { type: next.mimeType });
        const reply = await handlers.current.respond(await blob.arrayBuffer());
        if (!active.current) return;
        if (reply.heard) setCaption({ who: "you", text: reply.heard });
        if (reply.error) {
          setCaption({ who: "error", text: reply.error });
        } else if (reply.reply) {
          setCaption({ who: "agent", text: reply.reply });
          await play(reply);
        }
        if (active.current) relisten.current();
      } catch (error) {
        setCaption({
          who: "error",
          text: error instanceof Error && error.message ? error.message.replace(/^.*ConvexError: /, "") : "Something went wrong.",
        });
        end();
      }
    };

    recorder.current = next;
    next.start(250);
    move("listening");
    timer.current = setInterval(() => {
      const now = performance.now();
      const level = rms(analyser, sample.current);
      if (now - startedAt < CALIBRATE_MS) {
        floor = (floor * floorSamples + level) / ++floorSamples;
        return;
      }
      const threshold = Math.max(0.015, floor * 2.5);
      if (level > threshold) {
        if (!speechAt) speechAt = now;
        lastVoice = now;
      }
      let done = now - startedAt > MAX_TURN_MS;
      if (speechAt && now - lastVoice > SILENCE_MS) {
        if (lastVoice - speechAt > MIN_SPEECH_MS) done = true;
        else speechAt = 0;
      }
      if (!speechAt && now - startedAt > NO_SPEECH_MS) done = true;
      if (done) {
        clearTimer();
        if (next.state === "recording") next.stop();
      }
    }, 50);
  }, [end, move, play]);

  useEffect(() => {
    relisten.current = listen;
  }, [listen]);

  const start = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    setCaption(null);
    try {
      const ctx = audioCtx.current ?? new AudioContext();
      audioCtx.current = ctx;
      await ctx.resume();
      if (!outAnalyser.current) {
        const out = ctx.createAnalyser();
        out.fftSize = 1024;
        out.connect(ctx.destination);
        outAnalyser.current = out;
      }
      move("thinking");
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = media;
      const mic = ctx.createAnalyser();
      mic.fftSize = 1024;
      ctx.createMediaStreamSource(media).connect(mic);
      micAnalyser.current = mic;

      if (!greeted.current) {
        greeted.current = true;
        const hello = await handlers.current.greet();
        if (hello.reply) setCaption({ who: "agent", text: hello.reply });
        await play(hello);
      }
      listen();
    } catch (error) {
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      setCaption({
        who: "error",
        text: blocked ? "Allow the microphone to talk to us." : "Could not start the call. Please try again.",
      });
      end();
    }
  }, [end, listen, move, play]);

  const toggle = useCallback(() => {
    if (active.current) end();
    else void start();
  }, [end, start]);

  useEffect(() => () => {
    end();
    void audioCtx.current?.close();
  }, [end]);

  const supported = useSyncExternalStore(
    noop,
    () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined",
    () => true
  );

  return { state, caption, getInputVolume, getOutputVolume, toggle, end, supported };
}
