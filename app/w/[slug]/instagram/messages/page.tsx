"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fail, useInstagram } from "@/components/instagram/context";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";

const MAX_ICE_BREAKERS = 4;

export default function InstagramMessagesPage() {
  const { channel } = useInstagram();
  const settings = useQuery(api.instagramAutomation.getSettings, { channelId: channel._id });

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">DM tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything else in DMs is answered by @{channel.username}’s agent, as before.
        </p>
      </header>
      {settings === undefined ? (
        <TableSkeleton rows={4} columns={2} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <StoryMentionCard
            key={`story-${channel._id}`}
            channelId={channel._id}
            initial={settings.storyMention}
          />
          <IceBreakersCard
            key={`ice-${channel._id}`}
            channelId={channel._id}
            initial={settings.iceBreakers.map((item) => item.question)}
            sync={settings.iceBreakersSync}
          />
        </div>
      )}
    </div>
  );
}

function StoryMentionCard({
  channelId,
  initial,
}: {
  channelId: Id<"channels">;
  initial: { enabled: boolean; message: string };
}) {
  const save = useMutation(api.instagramAutomation.saveSettings);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [message, setMessage] = useState(initial.message);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await save({ channelId, storyMention: { enabled, message } });
      toast.add({ title: "Story mention reply saved", type: "success" });
    } catch (error) {
      fail("Could not save", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Story mention reply</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A DM to anyone who tags the account in their story. Their reply goes to the
            agent.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Reply to story mentions" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="story-message">Message</Label>
        <Textarea
          id="story-message"
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={!enabled}
        />
        <p className="text-xs text-muted-foreground">
          {"{{username}}"} becomes their @handle.
        </p>
      </div>
      <Button className="self-start" onClick={submit} disabled={saving}>
        {saving ? <Spinner /> : null} Save
      </Button>
    </section>
  );
}

function IceBreakersCard({
  channelId,
  initial,
  sync,
}: {
  channelId: Id<"channels">;
  initial: string[];
  sync?: { ok: boolean; error?: string; at: number };
}) {
  const save = useMutation(api.instagramAutomation.saveSettings);
  const [questions, setQuestions] = useState<string[]>(initial.length ? initial : [""]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        channelId,
        iceBreakers: questions.map((question) => ({ question })),
      });
      toast.add({ title: "Ice breakers saved", description: "Sending them to Instagram…", type: "success" });
    } catch (error) {
      fail("Could not save ice breakers", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-medium">Ice breakers</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Up to four questions shown to someone opening a DM with you for the first time.
          Tapping one sends it to the agent as their message.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {questions.map((question, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={question}
              maxLength={80}
              placeholder={index === 0 ? "What are your prices?" : "Another question"}
              onChange={(event) =>
                setQuestions((current) =>
                  current.map((item, at) => (at === index ? event.target.value : item))
                )
              }
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove question"
              onClick={() => setQuestions((current) => current.filter((_, at) => at !== index))}
            >
              <TrashIcon />
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
            <PlusIcon /> Add question
          </Button>
        ) : null}
      </div>
      {sync ? (
        <p className={sync.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {sync.ok
            ? `Updated on Instagram ${formatDistanceToNow(sync.at, { addSuffix: true })}.`
            : `Instagram did not take them: ${sync.error ?? "unknown error"}`}
        </p>
      ) : null}
      <Button className="self-start" onClick={submit} disabled={saving}>
        {saving ? <Spinner /> : null} Save
      </Button>
    </section>
  );
}
