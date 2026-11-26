"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { moderationReason, tidyWords } from "@/convex/lib/instagram";
import { fail, useInstagram } from "@/components/instagram/context";
import { TableSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Link01Icon,
  Shield01Icon,
  SparklesIcon,
  TextFontIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";

type Moderation = {
  enabled: boolean;
  action: "hide" | "delete";
  blockLinks: boolean;
  blockedWords: string[];
  screenWithAi: boolean;
};

const MAX_WORDS = 50;

export default function InstagramModerationPage() {
  const { channel } = useInstagram();
  const settings = useQuery(api.instagramAutomation.getSettings, { channelId: channel._id });

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-xl font-semibold tracking-tight">Moderation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Checked on every new comment before any rule runs. A comment that breaks these
          rules is hidden or deleted and never gets a reply.
        </p>
      </header>
      {settings === undefined ? (
        <TableSkeleton rows={4} columns={2} />
      ) : (
        <ModerationForm key={channel._id} channelId={channel._id} initial={settings.moderation} />
      )}
    </div>
  );
}

function ModerationForm({
  channelId,
  initial,
}: {
  channelId: Id<"channels">;
  initial: Moderation;
}) {
  const save = useMutation(api.instagramAutomation.saveSettings);
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Moderation>) => setForm((current) => ({ ...current, ...patch }));

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const off = !form.enabled;
  const checks = [form.blockLinks, form.blockedWords.length > 0, form.screenWithAi].filter(
    Boolean
  ).length;

  const submit = async () => {
    setSaving(true);
    try {
      await save({ channelId, moderation: form });
      setSaved(form);
      toast.add({ title: "Moderation saved", type: "success" });
    } catch (error) {
      fail("Could not save moderation", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex items-center gap-3 rounded-xl border border-border p-4">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              form.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            <HugeiconsIcon icon={Shield01Icon} strokeWidth={2} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <Label htmlFor="moderation-on" className="text-sm font-semibold">
              Moderate comments
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {form.enabled
                ? `${checks} ${checks === 1 ? "check" : "checks"} on — flagged comments are ${form.action === "hide" ? "hidden" : "deleted"}.`
                : "Off — every comment stays up and goes on to your comment rules."}
            </p>
          </div>
          <Switch
            id="moderation-on"
            checked={form.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </section>

        <fieldset
          disabled={off}
          className={cn("flex flex-col gap-4 transition-opacity", off && "opacity-50")}
        >
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">When a comment is flagged</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <ActionOption
                selected={form.action === "hide"}
                onSelect={() => set({ action: "hide" })}
                icon={ViewOffSlashIcon}
                title="Hide it"
                body="Still visible to its writer and their friends, so they don’t notice. You can unhide it from the post."
              />
              <ActionOption
                selected={form.action === "delete"}
                onSelect={() => set({ action: "delete" })}
                icon={Delete02Icon}
                title="Delete it"
                body="Removed for everyone, for good. It can’t be brought back."
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Checks</h2>
            <div className="divide-y divide-border rounded-xl border border-border">
              <CheckRow
                id="moderation-links"
                icon={Link01Icon}
                title="Block links"
                body="Comments with a web address, usually spam or scams."
                checked={form.blockLinks}
                onChange={(blockLinks) => set({ blockLinks })}
              />
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <CheckIcon icon={TextFontIcon} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Blocked words</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Whole words only, any capitalisation. Press Enter or a comma to add one.
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {form.blockedWords.length}/{MAX_WORDS}
                  </span>
                </div>
                <WordsInput
                  words={form.blockedWords}
                  onChange={(blockedWords) => set({ blockedWords })}
                />
              </div>
              <CheckRow
                id="moderation-ai"
                icon={SparklesIcon}
                title="Screen with AI"
                badge="AI usage"
                body="Also catches insults, hate, threats and spam that no word list covers. Complaints and criticism are left up."
                checked={form.screenWithAi}
                onChange={(screenWithAi) => set({ screenWithAi })}
              />
            </div>
          </section>
        </fieldset>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={submit} disabled={!dirty || saving}>
            {saving ? <Spinner /> : null} Save
          </Button>
          {dirty && !saving ? (
            <Button size="sm" variant="ghost" onClick={() => setForm(saved)}>
              Discard
            </Button>
          ) : null}
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <Tester moderation={form} />
        <RecentModerated channelId={channelId} />
      </aside>
    </div>
  );
}

function CheckIcon({ icon }: { icon: typeof Link01Icon }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
    </span>
  );
}

function CheckRow({
  id,
  icon,
  title,
  body,
  badge,
  checked,
  onChange,
}: {
  id: string;
  icon: typeof Link01Icon;
  title: string;
  body: string;
  badge?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <CheckIcon icon={icon} />
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge ? <Badge variant="outline">{badge}</Badge> : null}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ActionOption({
  selected,
  onSelect,
  icon,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: typeof Link01Icon;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"
      )}
    >
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={cn("mt-0.5 size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}

function WordsInput({
  words,
  onChange,
}: {
  words: string[];
  onChange: (words: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const full = words.length >= MAX_WORDS;

  const add = (text: string) => {
    const next = tidyWords([...words, ...text.split(/[,\n]/)]);
    if (next.length !== words.length) onChange(next);
    setDraft("");
  };

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      {words.map((word) => (
        <span
          key={word}
          className="flex items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs font-medium"
        >
          {word}
          <button
            type="button"
            aria-label={`Remove ${word}`}
            onClick={() => onChange(words.filter((item) => item !== word))}
            className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={full}
        maxLength={60}
        placeholder={full ? "That’s the most you can block" : words.length ? "Add a word" : "scam, fake, free followers"}
        onChange={(event) => {
          const value = event.target.value;
          if (/[,\n]/.test(value)) add(value);
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          } else if (event.key === "Backspace" && !draft && words.length) {
            onChange(words.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (/[,\n]/.test(text)) {
            event.preventDefault();
            add(draft + text);
          }
        }}
        className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}

function Tester({ moderation }: { moderation: Moderation }) {
  const [text, setText] = useState("");
  const sample = text.trim();
  const reason = sample && moderation.enabled ? moderationReason(moderation, sample) : null;

  let result: ReactNode = null;
  if (sample) {
    if (!moderation.enabled) {
      result = <Verdict ok title="Stays up" body="Moderation is off." />;
    } else if (reason) {
      result = (
        <Verdict
          ok={false}
          title={moderation.action === "hide" ? "Would be hidden" : "Would be deleted"}
          body={reason}
        />
      );
    } else {
      result = (
        <Verdict
          ok
          title="Passes"
          body={
            moderation.screenWithAi
              ? "No link or blocked word. AI screening still runs on real comments."
              : "No link or blocked word."
          }
        />
      );
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <Label htmlFor="moderation-test" className="text-sm font-semibold">
        Try a comment
      </Label>
      <p className="text-xs text-muted-foreground">
        Checked against your unsaved settings. Nothing is posted.
      </p>
      <Textarea
        id="moderation-test"
        rows={3}
        value={text}
        placeholder="Get free followers at bit.ly/xyz"
        onChange={(event) => setText(event.target.value)}
      />
      {result}
    </section>
  );
}

function Verdict({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg p-2.5 text-xs",
        ok ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-destructive/10 text-destructive"
      )}
    >
      <HugeiconsIcon
        icon={ok ? CheckmarkCircle02Icon : AlertCircleIcon}
        strokeWidth={2}
        className="mt-px size-4 shrink-0"
      />
      <span>
        <span className="font-semibold">{title}</span>
        <span className="block opacity-90">{body}</span>
      </span>
    </div>
  );
}

function RecentModerated({ channelId }: { channelId: Id<"channels"> }) {
  const rows = useQuery(api.instagramAutomation.recentModerated, { channelId });

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold">Recently moderated</h2>
      {rows === undefined ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comment has been flagged yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row._id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate font-medium">{row.from}</span>
                <Badge variant={row.action === "deleted" ? "destructive" : "secondary"}>
                  {row.action === "deleted" ? "Deleted" : "Hidden"}
                </Badge>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {formatDistanceToNow(row.createdAt, { addSuffix: true })}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{row.text}</p>
              {row.reason ? (
                <p className="text-[11px] text-muted-foreground/80">{row.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
