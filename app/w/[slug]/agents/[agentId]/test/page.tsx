"use client";

import { use, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveGreeting } from "@/convex/lib/prompt";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  TranscriptItem,
  TranscriptView,
} from "@/components/transcript";
import { TypingBubble } from "@/components/typing-bubble";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowLeft02Icon,
  Mic01Icon,
  PauseIcon,
  RefreshIcon,
  SentIcon,
  SlidersVerticalIcon,
  StopIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { friendlyError } from "@/lib/errors";
import {
  useAutoSpeak,
  usePlayer,
  useRecorder,
  useStoredFlag,
  useTypewriter,
} from "@/hooks/use-voice";

function StreamingReply({ text }: { text: string }) {
  const shown = useTypewriter(text);
  return (
    <Message align="start">
      <MessageContent>
        <Bubble variant="outline">
          <BubbleContent className="whitespace-pre-wrap">
            {shown}
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/50 align-text-bottom" />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

// One browser session == one contact, so the playground behaves like a real
// returning customer across reloads. localStorage is an external store rather
// than React state, so it is read through useSyncExternalStore — that keeps the
// server snapshot null and avoids a hydration mismatch.
const sessionCache = new Map<string, string>();

function readOrCreateSession(storageKey: string): string {
  const cached = sessionCache.get(storageKey);
  if (cached) return cached;

  let existing: string | null = null;
  try {
    existing = window.localStorage.getItem(storageKey);
  } catch {
    /* private browsing or blocked site data */
  }

  if (!existing) {
    existing = `web-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try {
      window.localStorage.setItem(storageKey, existing);
    } catch {
      /* keep the in-memory value for this tab only */
    }
  }

  sessionCache.set(storageKey, existing);
  return existing;
}

const noopSubscribe = () => () => {};

// Generic openers that exercise the retrieval, catalogue and escalation paths.
const STARTER_PROMPTS = [
  "What do you sell?",
  "Do you deliver to my area?",
  "I need a quote",
  "I'd like to speak to someone",
];

function useSessionId(agentId: string): string | null {
  const storageKey = `magic-ai-bot:web-session:${agentId}`;
  return useSyncExternalStore(
    noopSubscribe,
    () => readOrCreateSession(storageKey),
    () => null
  );
}

export default function AgentTestPage({
  params,
}: PageProps<"/w/[slug]/agents/[agentId]/test">) {
  const { agentId } = use(params);
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const typedAgentId = agentId as Id<"agents">;

  const sessionId = useSessionId(agentId);
  const agent = useQuery(api.agents.get, { agentId: typedAgentId });
  const conversation = useQuery(
    api.conversations.findWebConversation,
    sessionId ? { agentId: typedAgentId, sessionId } : "skip"
  );
  const messages = useQuery(api.conversations.listMessages, {
    conversationId: conversation?._id,
  });
  const respond = useAction(api.engine.respondAsUser);
  const resetConversation = useMutation(api.conversations.reset);
  const draft = useQuery(api.drafts.forConversation, {
    conversationId: conversation?._id,
  });
  const transcribe = useAction(api.voice.transcribeAsUser);
  const speak = useAction(api.voice.speakAsUser);
  const recorder = useRecorder();
  const [speakReplies, setSpeakReplies] = useStoredFlag("magic-ai-bot:playground-speak", false);
  const [heard, setHeard] = useState<{ text: string; ms: number } | null>(null);
  const [listening, setListening] = useState<"idle" | "recording" | "transcribing">("idle");
  const spokeLast = useRef(false);
  const player = usePlayer((id) => speak({ messageId: id as Id<"messages"> }));
  useAutoSpeak(
    messages?.map((m) => ({ id: m._id, role: m.kind === "text" ? m.role : "other" })),
    () => {
      const wanted = speakReplies || spokeLast.current;
      spokeLast.current = false;
      return wanted;
    },
    (id) =>
      void player.play(id).catch((error: unknown) =>
        toast.add({ title: "Could not play the reply", description: friendlyError(error), type: "error" })
      )
  );

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !sessionId || sending) return;

    setInput("");
    setSending(true);
    setLastError(null);
    try {
      const result = await respond({
        agentId: typedAgentId,
        channelType: "web",
        externalId: sessionId,
        text,
      });
      if (!result.ok && result.error) setLastError(result.error);
    } catch (error) {
      const description = friendlyError(error);
      setLastError(description);
      toast.add({ title: "The agent did not reply", description, type: "error" });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const toggleMic = async () => {
    if (listening === "recording") {
      const audio = await recorder.stop();
      if (!audio) {
        setListening("idle");
        return;
      }
      setListening("transcribing");
      const started = performance.now();
      try {
        const { text } = await transcribe({ agentId: typedAgentId, audio });
        setHeard({ text, ms: performance.now() - started });
        if (text) {
          spokeLast.current = true;
          await send(text);
        }
      } catch (error) {
        toast.add({ title: "Could not transcribe", description: friendlyError(error), type: "error" });
      } finally {
        setListening("idle");
      }
      return;
    }
    player.stop();
    try {
      await recorder.start();
      setListening("recording");
    } catch {
      toast.add({ title: "Microphone blocked", description: "Allow microphone access to talk to the agent.", type: "error" });
    }
  };

  if (agent === undefined) {
    return (
      <div className="flex flex-1 items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading agent…
      </div>
    );
  }

  if (agent === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This agent no longer exists.{" "}
        <Link href={`${base}/agents`} className="underline">
          Back to agents
        </Link>
      </div>
    );
  }

  const isEmpty = (messages ?? []).length === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            size="icon-lg"
            variant="ghost"
            aria-label="Back"
            nativeButton={false}
            render={<Link href={`${base}/agents`} />}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">
              {agent.botName}{" "}
              <span className="text-muted-foreground">· {agent.role}</span>
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Web playground — same engine that serves WhatsApp
            </p>
          </div>
          <Badge
            variant={agent.status === "active" ? "default" : "secondary"}
          >
            {agent.status}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch
              id="speak-replies"
              size="sm"
              checked={speakReplies}
              onCheckedChange={setSpeakReplies}
            />
            <Label htmlFor="speak-replies" className="text-xs">
              Speak replies
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="show-tools"
              size="sm"
              checked={showTools}
              onCheckedChange={setShowTools}
            />
            <Label htmlFor="show-tools" className="text-xs">
              Tool trace
            </Label>
          </div>
          <Button
            size="lg"
            variant="outline"
            disabled={!conversation}
            onClick={async () => {
              if (!conversation) return;
              await resetConversation({ conversationId: conversation._id });
              setLastError(null);
              toast.add({ title: "Conversation cleared", type: "success" });
            }}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} /> Reset
          </Button>
          <Button
            size="lg"
            variant="ghost"
            nativeButton={false}
            render={<Link href={`${base}/agents/${agentId}`} />}
          >
            <HugeiconsIcon icon={SlidersVerticalIcon} strokeWidth={2} /> Configure
          </Button>
        </div>
      </header>

      {agent.status === "paused" ? (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>This agent is paused</AlertTitle>
            <AlertDescription>
              A paused agent refuses every turn. Set it to Draft or Active on the
              configuration page to test it.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {lastError ? (
        <div className="shrink-0 px-4 pt-3">
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>Last turn reported an error</AlertTitle>
            <AlertDescription className="font-mono text-xs">
              {lastError}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <TranscriptView
        messages={messages}
        showTools={showTools}
        agents={agent ? [agent] : undefined}
        onPick={(text) => void send(text)}
        messageActions={(message) =>
          message.role === "assistant" && message.kind === "text" && message.text ? (
            <Button
              variant="ghost"
              size="xs"
              className="-mt-1.5 self-start text-muted-foreground"
              onClick={() =>
                void Promise.resolve(player.toggle(message._id)).catch((error: unknown) =>
                  toast.add({ title: "Could not play", description: friendlyError(error), type: "error" })
                )
              }
            >
              {player.loadingId === message._id ? (
                <Spinner />
              ) : (
                <HugeiconsIcon
                  icon={player.playingId === message._id ? PauseIcon : VolumeHighIcon}
                  strokeWidth={2}
                />
              )}
              {player.playingId === message._id ? "Stop" : "Listen"}
            </Button>
          ) : null
        }
        leading={
          <>
            <TranscriptItem messageId="greeting">
              <Message align="start">
                <MessageContent>
                  <Bubble variant="outline">
                    <BubbleContent>
                      {resolveGreeting(agent, workspace.name)}
                    </BubbleContent>
                  </Bubble>
                  <MessageFooter>opening line</MessageFooter>
                </MessageContent>
              </Message>
            </TranscriptItem>

            {isEmpty && messages !== undefined ? (
              <TranscriptItem messageId="starters">
                <div className="flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Try one
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {STARTER_PROMPTS.map((prompt) => (
                      <Button
                        key={prompt}
                        size="lg"
                        variant="outline"
                        disabled={!sessionId || sending}
                        onClick={() => void send(prompt)}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              </TranscriptItem>
            ) : null}
          </>
        }
        trailing={
          sending ? (
            <TranscriptItem messageId="typing">
              {draft?.text ? (
                <StreamingReply text={draft.text} />
              ) : (
                <TypingBubble label="The agent is typing" />
              )}
            </TranscriptItem>
          ) : null
        }
      />

      <div className="shrink-0 border-t p-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={2}
            value={input}
            disabled={!sessionId}
            placeholder="Type as a customer would"
            className="resize-none"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {recorder.supported ? (
            <Button
              size="icon-lg"
              variant={listening === "recording" ? "destructive" : "outline"}
              aria-label={listening === "recording" ? "Stop and send" : "Talk to the agent"}
              disabled={!sessionId || sending || listening === "transcribing"}
              onClick={() => void toggleMic()}
            >
              {listening === "transcribing" ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={listening === "recording" ? StopIcon : Mic01Icon} strokeWidth={2} />
              )}
            </Button>
          ) : null}
          <Button
            size="icon-lg"
            aria-label="Send message"
            disabled={sending || !input.trim() || !sessionId}
            onClick={() => void send()}
          >
            {sending ? <Spinner /> : <HugeiconsIcon icon={SentIcon} strokeWidth={2} />}
          </Button>
        </div>
        <p className="mx-auto mt-1.5 w-full max-w-3xl text-xs text-muted-foreground">
          {listening === "recording"
            ? "Listening… press stop to send."
            : heard
              ? `Heard "${heard.text || "nothing"}" · transcribed in ${(heard.ms / 1000).toFixed(1)}s`
              : "Enter to send · Shift+Enter for a new line · mic to talk."}
        </p>
      </div>
    </div>
  );
}
