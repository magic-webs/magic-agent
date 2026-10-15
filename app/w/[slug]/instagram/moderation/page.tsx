"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fail, useInstagram } from "@/components/instagram/context";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Moderation = {
  enabled: boolean;
  action: "hide" | "delete";
  blockLinks: boolean;
  blockedWords: string[];
  screenWithAi: boolean;
};

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

function Row({
  id,
  title,
  body,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  title: string;
  body: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{title}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
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
  const [form, setForm] = useState(initial);
  const [words, setWords] = useState(initial.blockedWords.join(", "));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Moderation>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        channelId,
        moderation: {
          ...form,
          blockedWords: words.split(/[,\n]/).map((word) => word.trim()).filter(Boolean),
        },
      });
      toast.add({ title: "Moderation saved", type: "success" });
    } catch (error) {
      fail("Could not save moderation", error);
    } finally {
      setSaving(false);
    }
  };

  const off = !form.enabled;

  return (
    <div className="flex max-w-2xl flex-col gap-5 rounded-lg border border-border p-4">
      <Row
        id="moderation-on"
        title="Moderate comments"
        body="Turn on to check every new comment against the rules below."
        checked={form.enabled}
        onChange={(enabled) => set({ enabled })}
      />

      <div className="flex flex-col gap-2">
        <Label>What happens to a flagged comment</Label>
        <ToggleGroup
          value={[form.action]}
          onValueChange={(value) => {
            const next = value[0] as Moderation["action"] | undefined;
            if (next) set({ action: next });
          }}
          className="w-fit rounded-lg border p-0.5"
          disabled={off}
        >
          <ToggleGroupItem value="hide">Hide</ToggleGroupItem>
          <ToggleGroupItem value="delete">Delete</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {form.action === "hide"
            ? "A hidden comment stays visible to its writer and their followers, so they do not notice. You can unhide it in Instagram."
            : "A deleted comment is gone for good."}
        </p>
      </div>

      <Row
        id="moderation-links"
        title="Block links"
        body="Comments with a web address, usually spam or scams."
        checked={form.blockLinks}
        onChange={(blockLinks) => set({ blockLinks })}
        disabled={off}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="moderation-words">Blocked words</Label>
        <Textarea
          id="moderation-words"
          rows={3}
          value={words}
          onChange={(event) => setWords(event.target.value)}
          placeholder="Separate with commas: scam, fake, free followers"
          disabled={off}
        />
        <p className="text-xs text-muted-foreground">
          Whole words only, any capitalisation.
        </p>
      </div>

      <Row
        id="moderation-ai"
        title="Screen with AI"
        body="Also catches insults, hate, threats and spam that no word list covers. Complaints and criticism are left up. Billed as AI usage."
        checked={form.screenWithAi}
        onChange={(screenWithAi) => set({ screenWithAi })}
        disabled={off}
      />

      <Button className="self-start" onClick={submit} disabled={saving}>
        {saving ? <Spinner /> : null} Save
      </Button>
    </div>
  );
}
