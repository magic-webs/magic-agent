"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  DEFAULT_BUTTON_TEXT,
  WELCOME_LIMITS,
  type WelcomeOption,
} from "@/convex/lib/welcomeMenu";
import { useWorkspace } from "@/components/workspace-provider";
import { WhatsAppPreview } from "@/components/marketing/whatsapp-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { FloppyDiskIcon, PlusIcon, RobotIcon, TrashIcon } from "@phosphor-icons/react";

type MenuData = NonNullable<FunctionReturnType<typeof api.welcomeMenu.get>>;

type Draft = {
  enabled: boolean;
  body: string;
  header: string;
  footer: string;
  buttonText: string;
  custom: boolean;
  options: WelcomeOption[];
};

function draftFrom(data: MenuData): Draft {
  const saved = data.saved;
  const custom = Boolean(saved && saved.options.length > 0);
  return {
    enabled: saved?.enabled ?? true,
    body: saved?.body.trim() || data.defaultBody,
    header: saved?.header ?? "",
    footer: saved?.footer ?? "",
    buttonText: saved?.buttonText ?? "",
    custom,
    options: custom ? saved!.options : data.agentOptions,
  };
}

export function WelcomeMenuCard() {
  const workspace = useWorkspace();
  const data = useQuery(api.welcomeMenu.get, { workspaceId: workspace._id });

  if (data === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading welcome menu…
        </CardContent>
      </Card>
    );
  }
  if (data === null) return null;
  return <WelcomeMenuForm key={workspace._id} data={data} />;
}

function WelcomeMenuForm({ data }: { data: MenuData }) {
  const workspace = useWorkspace();
  const saveMenu = useMutation(api.welcomeMenu.save);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(data));
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const options = draft.custom ? draft.options : data.agentOptions;
  const asList = options.length > WELCOME_LIMITS.buttons;

  const editOptions = (change: (current: WelcomeOption[]) => WelcomeOption[]) =>
    setDraft((prev) => ({
      ...prev,
      custom: true,
      options: change(prev.custom ? prev.options : data.agentOptions),
    }));
  const setOption = (index: number, patch: Partial<WelcomeOption>) =>
    editOptions((current) =>
      current.map((option, at) => (at === index ? { ...option, ...patch } : option))
    );

  const save = async () => {
    setSaving(true);
    try {
      await saveMenu({
        workspaceId: workspace._id,
        menu: {
          enabled: draft.enabled,
          body: draft.body.trim() === data.defaultBody ? "" : draft.body,
          header: draft.header || undefined,
          footer: draft.footer || undefined,
          buttonText: draft.buttonText || undefined,
          options: !draft.custom
            ? []
            : draft.options
                .filter((option) => option.title.trim())
                .map((option) => ({
                  title: option.title,
                  ...(option.description?.trim()
                    ? { description: option.description }
                    : {}),
                })),
        },
      });
      toast.add({ title: "Welcome menu saved", type: "success" });
    } catch (error) {
      toast.add({ title: "Save failed", description: friendlyError(error), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Welcome menu</CardTitle>
          <CardDescription className="max-w-2xl">
            When someone opens a chat with just “hi”, “hello” or a message that
            doesn&apos;t say what they want, the front desk answers with this
            message and a button for each thing you help with — instead of
            asking. Tapping one hands them to the right agent.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={draft.enabled}
              onCheckedChange={(value) => set({ enabled: value })}
              aria-label="Send the welcome menu"
            />
            {draft.enabled ? "On" : "Off"}
          </label>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner /> : <FloppyDiskIcon />} Save
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_296px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wm-body">Message</Label>
            <Textarea
              id="wm-body"
              rows={3}
              maxLength={WELCOME_LIMITS.body}
              placeholder={data.defaultBody}
              value={draft.body}
              onChange={(event) => set({ body: event.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wm-header">Heading (optional)</Label>
              <Input
                id="wm-header"
                maxLength={WELCOME_LIMITS.header}
                value={draft.header}
                onChange={(event) => set({ header: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wm-footer">Footer (optional)</Label>
              <Input
                id="wm-footer"
                maxLength={WELCOME_LIMITS.footer}
                placeholder="Reply anytime — we're here 9am–6pm"
                value={draft.footer}
                onChange={(event) => set({ footer: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Buttons</Label>
            {options.map((option, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <Input
                    aria-label={`Button ${index + 1}`}
                    placeholder="Book a visit"
                    maxLength={WELCOME_LIMITS.title}
                    value={option.title}
                    onChange={(event) => setOption(index, { title: event.target.value })}
                  />
                  <Input
                    aria-label={`Button ${index + 1} description`}
                    placeholder={asList ? "Shown under it in the list" : "Shown in lists only"}
                    maxLength={WELCOME_LIMITS.description}
                    value={option.description ?? ""}
                    onChange={(event) =>
                      setOption(index, { description: event.target.value })
                    }
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove button ${index + 1}`}
                  onClick={() =>
                    editOptions((current) => current.filter((_, at) => at !== index))
                  }
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
            {options.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No live agents take handovers yet, so the menu is not sent. Add a
                button, or make an agent live.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={options.length >= WELCOME_LIMITS.options}
                onClick={() => editOptions((current) => [...current, { title: "" }])}
              >
                <PlusIcon /> Add button
              </Button>
              {draft.custom && data.agentOptions.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ custom: false, options: data.agentOptions })}
                >
                  <RobotIcon /> Follow my agents
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {draft.custom
                ? `Up to ${WELCOME_LIMITS.options}, ${WELCOME_LIMITS.title} characters each. WhatsApp shows three as buttons; four or more become a list behind one button.`
                : "One button per live agent, kept up to date as agents are added or paused. Change any of them to set your own."}
            </p>
          </div>

          {asList ? (
            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label htmlFor="wm-list-button">List button</Label>
              <Input
                id="wm-list-button"
                maxLength={WELCOME_LIMITS.buttonText}
                placeholder={DEFAULT_BUTTON_TEXT}
                value={draft.buttonText}
                onChange={(event) => set({ buttonText: event.target.value })}
              />
            </div>
          ) : null}
        </div>

        <WhatsAppPreview
          body={draft.body.trim() || data.defaultBody}
          header={draft.header}
          footer={draft.footer}
          buttons={options
            .filter((option) => option.title.trim())
            .map((option) => ({ type: "quick_reply" as const, text: option.title }))}
          business={workspace.name}
        />
      </CardContent>
    </Card>
  );
}
