"use client";

import { useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { useCachedQuery } from "@/lib/use-cached-query";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import { fail, useInstagram, type InstagramChannel } from "@/components/instagram/context";
import { AccountAvatar } from "@/components/instagram/account-avatar";
import { TableSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

const MAX_ICE_BREAKERS = 4;
const QUESTION_LIMIT = 80;
const MESSAGE_LIMIT = 1000;
const SAMPLE_HANDLE = "@sunita.designs";

export default function SocialMessagesPage() {
  const { channel } = useInstagram();
  const settings = useCachedQuery(
    api.instagramAutomation.getSettings,
    channel.type === "instagram" ? { channelId: channel._id } : "skip"
  );

  if (channel.type !== "instagram") {
    return (
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">DM tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Story mention replies and ice breakers are Instagram features. Pick an Instagram
          account above to set them. Messages to {channel.label} are answered by its agent.
        </p>
      </header>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">DM tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What people see before {channel.label}’s agent takes over the chat.
        </p>
      </header>
      {settings === undefined ? (
        <TableSkeleton rows={4} columns={2} />
      ) : (
        <div className="flex flex-col gap-4">
          <IceBreakersCard
            key={`ice-${channel._id}`}
            channel={channel}
            initial={settings.iceBreakers.map((item) => item.question)}
            sync={settings.iceBreakersSync}
          />
          <StoryMentionCard
            key={`story-${channel._id}`}
            channel={channel}
            initial={settings.storyMention}
          />
        </div>
      )}
    </div>
  );
}

function ToolCard({
  title,
  description,
  action,
  preview,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  preview: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid overflow-hidden rounded-xl border border-border lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
          {action}
        </div>
        {children}
      </div>
      <div className="flex items-center justify-center border-t border-border bg-muted/40 p-4 lg:border-t-0 lg:border-l">
        {preview}
      </div>
    </section>
  );
}

function Phone({ channel, children }: { channel: InstagramChannel; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-[17rem] flex-col overflow-hidden rounded-[1.5rem] border border-border bg-background shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <AccountAvatar channel={channel} size={22} />
        <span className="truncate text-xs font-semibold">{channel.username}</span>
      </div>
      <div className="flex min-h-56 flex-col gap-2 p-3">{children}</div>
    </div>
  );
}

function SaveRow({
  dirty,
  saving,
  onSave,
  onReset,
  children,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
      <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
        {saving ? <Spinner /> : null} Save
      </Button>
      {dirty && !saving ? (
        <Button size="sm" variant="ghost" onClick={onReset}>
          Discard
        </Button>
      ) : null}
      {children}
    </div>
  );
}

function IceBreakersCard({
  channel,
  initial,
  sync,
}: {
  channel: InstagramChannel;
  initial: string[];
  sync?: { ok: boolean; error?: string; at: number };
}) {
  const save = useMutation(api.instagramAutomation.saveSettings);
  const [saved, setSaved] = useState(initial);
  const [questions, setQuestions] = useState<string[]>(initial.length ? initial : [""]);
  const [saving, setSaving] = useState(false);

  const filled = questions.map((question) => question.trim()).filter(Boolean);
  const dirty = filled.join("\n") !== saved.join("\n");

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        channelId: channel._id,
        iceBreakers: filled.map((question) => ({ question })),
      });
      setSaved(filled);
      toast.add({ title: "Ice breakers saved", description: "Sending them to Instagram…", type: "success" });
    } catch (error) {
      fail("Could not save ice breakers", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ToolCard
      title="Ice breakers"
      description="Up to four questions shown to someone opening a DM with you for the first time. Tapping one sends it to the agent as their message."
      preview={
        <Phone channel={channel}>
          <div className="flex flex-col items-center gap-1 py-3 text-center">
            <AccountAvatar channel={channel} size={56} />
            <p className="mt-1 text-sm font-semibold">{channel.username}</p>
            <p className="text-[11px] text-muted-foreground">Instagram · Business chat</p>
          </div>
          <div className="mt-auto flex flex-col items-end gap-1.5">
            {filled.length ? (
              filled.map((question, index) => (
                <span
                  key={index}
                  className="max-w-full rounded-full border border-border px-3 py-1.5 text-xs wrap-break-word"
                >
                  {question}
                </span>
              ))
            ) : (
              <span className="self-center text-xs text-muted-foreground">No questions yet</span>
            )}
          </div>
        </Phone>
      }
    >
      <div className="flex flex-col gap-2">
        {questions.map((question, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <div className="relative min-w-0 flex-1">
              <Input
                value={question}
                maxLength={QUESTION_LIMIT}
                placeholder={index === 0 ? "What are your prices?" : "Another question"}
                className="pr-12"
                onChange={(event) =>
                  setQuestions((current) =>
                    current.map((item, at) => (at === index ? event.target.value : item))
                  )
                }
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums">
                {question.length}/{QUESTION_LIMIT}
              </span>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remove question"
              onClick={() =>
                setQuestions((current) =>
                  current.length === 1 ? [""] : current.filter((_, at) => at !== index)
                )
              }
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
        ))}
        {questions.length < MAX_ICE_BREAKERS ? (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setQuestions((current) => [...current, ""])}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add question
          </Button>
        ) : null}
      </div>

      <SaveRow
        dirty={dirty}
        saving={saving}
        onSave={submit}
        onReset={() => setQuestions(saved.length ? saved : [""])}
      >
        {sync ? (
          <span
            className={cn(
              "ml-auto flex items-center gap-1 text-xs",
              sync.ok ? "text-muted-foreground" : "text-destructive"
            )}
          >
            <HugeiconsIcon
              icon={sync.ok ? CheckmarkCircle02Icon : AlertCircleIcon}
              strokeWidth={2}
              className={cn("size-3.5", sync.ok && "text-green-600")}
            />
            {sync.ok
              ? `Live on Instagram, updated ${formatDistanceToNow(sync.at, { addSuffix: true })}`
              : `Instagram did not take them: ${sync.error ?? "unknown error"}`}
          </span>
        ) : null}
      </SaveRow>
    </ToolCard>
  );
}

function StoryMentionCard({
  channel,
  initial,
}: {
  channel: InstagramChannel;
  initial: { enabled: boolean; message: string };
}) {
  const save = useMutation(api.instagramAutomation.saveSettings);
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [message, setMessage] = useState(initial.message);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const dirty = enabled !== saved.enabled || message !== saved.message;
  const preview = message.trim().replaceAll("{{username}}", SAMPLE_HANDLE);

  const submit = async () => {
    setSaving(true);
    try {
      await save({ channelId: channel._id, storyMention: { enabled, message } });
      setSaved({ enabled, message });
      toast.add({ title: "Story mention reply saved", type: "success" });
    } catch (error) {
      fail("Could not save", error);
    } finally {
      setSaving(false);
    }
  };

  const insertHandle = () => {
    const input = field.current;
    const start = input?.selectionStart ?? message.length;
    const end = input?.selectionEnd ?? message.length;
    const next = `${message.slice(0, start)}{{username}}${message.slice(end)}`;
    setMessage(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + 12, start + 12);
    });
  };

  return (
    <ToolCard
      title="Story mention reply"
      description="A DM to anyone who tags the account in their story. Their reply goes to the agent."
      action={
        <div className="flex items-center gap-2">
          <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? "On" : "Off"}</Badge>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Reply to story mentions"
          />
        </div>
      }
      preview={
        <Phone channel={channel}>
          <div className={cn("flex flex-1 flex-col gap-2", !enabled && "opacity-50")}>
            <p className="text-center text-[10px] text-muted-foreground">
              {SAMPLE_HANDLE} mentioned you in their story
            </p>
            <div className="flex w-20 flex-col self-start overflow-hidden rounded-xl border border-border">
              <span className="aspect-[9/16] bg-[linear-gradient(160deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)]" />
            </div>
            {preview ? (
              <span className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-[#3797f0] px-3 py-1.5 text-xs whitespace-pre-wrap text-white">
                {preview}
              </span>
            ) : null}
            {!enabled ? (
              <p className="mt-auto text-center text-[10px] text-muted-foreground">
                Off — mentions get no reply
              </p>
            ) : null}
          </div>
        </Phone>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="story-message">Message</Label>
          <Button size="xs" variant="outline" onClick={insertHandle} disabled={!enabled}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Their @handle
          </Button>
        </div>
        <Textarea
          id="story-message"
          ref={field}
          rows={4}
          maxLength={MESSAGE_LIMIT}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={!enabled}
        />
        <p className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>{"{{username}}"} becomes their @handle.</span>
          <span className="tabular-nums">
            {message.length}/{MESSAGE_LIMIT}
          </span>
        </p>
      </div>

      <SaveRow
        dirty={dirty}
        saving={saving}
        onSave={submit}
        onReset={() => {
          setEnabled(saved.enabled);
          setMessage(saved.message);
        }}
      />
    </ToolCard>
  );
}
