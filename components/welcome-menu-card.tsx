"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  DEFAULT_BUTTON_TEXT,
  WELCOME_LIMITS,
  showsAsCards,
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
import { putFile } from "@/lib/upload";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  Image01Icon,
  PlusSignIcon,
  RoboticIcon,
} from "@hugeicons/core-free-icons";

type MenuData = NonNullable<FunctionReturnType<typeof api.welcomeMenu.get>>;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Picture = { key?: string; file?: File; preview: string };

type DraftOption = WelcomeOption & { picture?: Picture };

type Draft = {
  enabled: boolean;
  body: string;
  header: string;
  headerPicture: Picture | null;
  footer: string;
  buttonText: string;
  custom: boolean;
  options: DraftOption[];
};

function pictureFor(data: MenuData, key: string | undefined): Picture | undefined {
  const url = key ? data.images[key] : undefined;
  return key && url ? { key, preview: url } : undefined;
}

function draftFrom(data: MenuData): Draft {
  const saved = data.saved;
  const custom = Boolean(saved && saved.options.length > 0);
  return {
    enabled: saved?.enabled ?? true,
    body: saved?.body.trim() || data.defaultBody,
    header: saved?.header ?? "",
    headerPicture: pictureFor(data, saved?.headerImageKey) ?? null,
    footer: saved?.footer ?? "",
    buttonText: saved?.buttonText ?? "",
    custom,
    options: custom
      ? saved!.options.map((option) => ({
          title: option.title,
          description: option.description,
          picture: pictureFor(data, option.imageKey),
        }))
      : data.agentOptions,
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

function PicturePicker({
  label,
  picture,
  onChange,
}: {
  label: string;
  picture: Picture | null | undefined;
  onChange: (picture: Picture | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={picture ? `Change ${label}` : `Add ${label}`}
        className="flex size-9 items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/40 text-muted-foreground hover:bg-muted"
        onClick={() => input.current?.click()}
      >
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2 or a local preview
          <img src={picture.preview} alt="" className="size-full object-cover" />
        ) : (
          <HugeiconsIcon icon={Image01Icon} strokeWidth={2} className="size-4" />
        )}
      </button>
      {picture ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background"
          onClick={() => onChange(null)}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-2.5" />
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > MAX_IMAGE_BYTES) {
            toast.add({ title: "Pictures can be up to 5 MB", type: "error" });
            return;
          }
          onChange({ file, preview: URL.createObjectURL(file) });
        }}
      />
    </div>
  );
}

function WelcomeMenuForm({ data }: { data: MenuData }) {
  const workspace = useWorkspace();
  const saveMenu = useMutation(api.welcomeMenu.save);
  const uploadUrl = useMutation(api.welcomeMenu.generateUploadUrl);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(data));
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const options: DraftOption[] = draft.custom ? draft.options : data.agentOptions;
  const asCards = showsAsCards(
    options.map((option) => ({ ...option, imageKey: option.picture ? "set" : undefined }))
  );
  const asList = !asCards && options.length > WELCOME_LIMITS.buttons;

  const editOptions = (change: (current: DraftOption[]) => DraftOption[]) =>
    setDraft((prev) => ({
      ...prev,
      custom: true,
      options: change(prev.custom ? prev.options : data.agentOptions),
    }));
  const setOption = (index: number, patch: Partial<DraftOption>) =>
    editOptions((current) =>
      current.map((option, at) => (at === index ? { ...option, ...patch } : option))
    );

  const upload = async (picture: Picture | null | undefined) => {
    if (!picture) return undefined;
    if (picture.key) return picture.key;
    return await putFile(await uploadUrl({ workspaceId: workspace._id }), picture.file!);
  };

  const save = async () => {
    setSaving(true);
    try {
      const kept = draft.options.filter((option) => option.title.trim());
      const imageKeys = draft.custom
        ? await Promise.all(kept.map((option) => upload(option.picture)))
        : [];
      const headerImageKey = await upload(draft.headerPicture);
      await saveMenu({
        workspaceId: workspace._id,
        menu: {
          enabled: draft.enabled,
          body: draft.body.trim() === data.defaultBody ? "" : draft.body,
          header: draft.header || undefined,
          footer: draft.footer || undefined,
          buttonText: draft.buttonText || undefined,
          headerImageKey,
          options: !draft.custom
            ? []
            : kept.map((option, index) => ({
                title: option.title,
                ...(option.description?.trim()
                  ? { description: option.description }
                  : {}),
                ...(imageKeys[index] ? { imageKey: imageKeys[index] } : {}),
              })),
        },
      });
      // Uploaded pictures now have keys; without them a second save would
      // upload the same files again.
      setDraft((prev) => ({
        ...prev,
        headerPicture:
          prev.headerPicture && headerImageKey
            ? { key: headerImageKey, preview: prev.headerPicture.preview }
            : prev.headerPicture,
        options: prev.custom
          ? kept.map((option, index) => ({
              ...option,
              picture:
                option.picture && imageKeys[index]
                  ? { key: imageKeys[index], preview: option.picture.preview }
                  : undefined,
            }))
          : prev.options,
      }));
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
            {saving ? <Spinner /> : <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} />} Save
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
              <div className="flex items-center gap-2">
                <PicturePicker
                  label="heading picture"
                  picture={draft.headerPicture}
                  onChange={(picture) => set({ headerPicture: picture })}
                />
                <Input
                  id="wm-header"
                  maxLength={WELCOME_LIMITS.header}
                  placeholder={draft.headerPicture ? "The picture is the heading" : undefined}
                  disabled={Boolean(draft.headerPicture)}
                  value={draft.header}
                  onChange={(event) => set({ header: event.target.value })}
                />
              </div>
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
                <PicturePicker
                  label={`picture for button ${index + 1}`}
                  picture={option.picture}
                  onChange={(picture) => setOption(index, { picture: picture ?? undefined })}
                />
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
                    placeholder={
                      asCards
                        ? "Shown on its card"
                        : asList
                          ? "Shown under it in the list"
                          : "Shown in lists only"
                    }
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
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
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
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add button
              </Button>
              {draft.custom && data.agentOptions.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ custom: false, options: data.agentOptions })}
                >
                  <HugeiconsIcon icon={RoboticIcon} strokeWidth={2} /> Follow my agents
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {draft.custom
                ? `Up to ${WELCOME_LIMITS.options}, ${WELCOME_LIMITS.title} characters each. WhatsApp shows three as buttons; four or more become a list behind one button. Give every button a picture and the menu goes out as a swipeable row of cards instead — without the heading and footer.`
                : "One button per live agent, kept up to date as agents are added or paused. Change any of them, or add pictures, to set your own."}
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

        {asCards ? (
          <CardsPreview body={draft.body.trim() || data.defaultBody} options={options} />
        ) : (
          <WhatsAppPreview
            body={draft.body.trim() || data.defaultBody}
            header={draft.headerPicture ? undefined : draft.header}
            headerMedia={
              draft.headerPicture
                ? { type: "image", url: draft.headerPicture.preview }
                : undefined
            }
            footer={draft.footer}
            buttons={options
              .filter((option) => option.title.trim())
              .map((option) => ({ type: "quick_reply" as const, text: option.title }))}
            business={workspace.name}
          />
        )}
      </CardContent>
    </Card>
  );
}

function CardsPreview({ body, options }: { body: string; options: DraftOption[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 self-start rounded-xl bg-muted p-3">
      <p className="max-w-[88%] rounded-lg rounded-tl-none bg-background px-2.5 py-1.5 text-[12.5px] leading-snug shadow-sm">
        {body}
      </p>
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {options.map((option, index) => (
          <div
            key={index}
            className="w-40 shrink-0 snap-start overflow-hidden rounded-lg bg-background text-xs shadow-sm"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- R2 or a local preview */}
            <img src={option.picture?.preview} alt="" className="h-24 w-full bg-muted object-cover" />
            <div className="px-2 py-1.5">
              <p className="font-medium">{option.title || "Button"}</p>
              {option.description ? (
                <p className="text-muted-foreground">{option.description}</p>
              ) : null}
            </div>
            <p className="border-t py-1.5 text-center font-medium text-primary">
              {option.title || "Button"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
