"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { htmlToText } from "@/convex/lib/notifications";
import { broadcastEmailHtml, textToEmailHtml } from "@/convex/lib/platformEmail";
import { smsSegments } from "@/convex/lib/sms";
import { WorkspacePicker, errorText } from "@/components/admin-account-fields";
import { SelectField } from "@/components/select-field";
import { useSession } from "@/components/use-session";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { putFile } from "@/lib/upload";
import {
  CalendarBlankIcon,
  FloppyDiskIcon,
  ImageIcon,
  PaperPlaneTiltIcon,
  SparkleIcon,
  SquaresFourIcon,
  TestTubeIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  CATEGORIES,
  CHANNELS,
  PushPreview,
  STAGES,
  SmsPreview,
  type Audience,
  type Broadcast,
  type Category,
  type Channel,
} from "./shared";
import { AiDraftDialog, type AiDraft } from "./ai-draft-dialog";
import { TemplateGallery } from "./template-gallery";
import { placeholdersIn, type NotificationTemplate } from "./templates";

type Form = {
  title: string;
  body: string;
  category: Category;
  channels: Record<Channel, boolean>;
  emailSubject: string;
  emailBody: string;
  emailFormat: "text" | "html";
  smsText: string;
  smsTemplateId: string;
  imageKey?: string;
  imageUrl?: string;
  link: string;
  linkLabel: string;
  audience: Audience;
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function formOf(broadcast?: Broadcast): Form {
  return {
    title: broadcast?.title ?? "",
    body: broadcast?.body ?? "",
    category: broadcast?.category ?? "update",
    channels: broadcast?.channels ?? { push: true, email: true, sms: false },
    emailSubject: broadcast?.emailSubject ?? "",
    emailBody: broadcast?.emailBody ?? "",
    emailFormat: broadcast?.emailFormat ?? "text",
    smsText: broadcast?.smsText ?? "",
    smsTemplateId: broadcast?.smsTemplateId ?? "",
    imageKey: broadcast?.imageKey,
    imageUrl: broadcast?.imageUrl ?? undefined,
    link: broadcast?.link ?? "",
    linkLabel: broadcast?.linkLabel ?? "",
    audience: broadcast?.audience ?? { kind: "all" },
  };
}

function toggle<T>(list: T[] | undefined, value: T, on: boolean): T[] {
  const rest = (list ?? []).filter((item) => item !== value);
  return on ? [...rest, value] : rest;
}

function localInput(time: number) {
  return format(new Date(time), "yyyy-MM-dd'T'HH:mm");
}

export function Composer({ broadcast }: { broadcast?: Broadcast }) {
  const router = useRouter();
  const modifies = useSession().canModify("notifications");
  const settings = useQuery(api.platformNotifications.settings, {});
  const workspaces = useQuery(api.workspaces.list, {});
  const save = useMutation(api.platformNotifications.save);
  const send = useMutation(api.platformNotifications.send);
  const cancel = useMutation(api.platformNotifications.cancel);
  const remove = useMutation(api.platformNotifications.remove);
  const sendTest = useAction(api.platformNotificationsSend.sendTest);
  const generateUploadUrl = useMutation(api.platformNotifications.generateUploadUrl);

  const [form, setForm] = useState<Form>(() => formOf(broadcast));
  const [busy, setBusy] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(() =>
    localInput(broadcast?.scheduledAt ?? Date.now() + 60 * 60 * 1000)
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(() => !broadcast && modifies);
  const [aiOpen, setAiOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);

  const reach = useQuery(api.platformNotifications.audience, { audience: form.audience });
  const configured = settings?.configured;
  const set = (patch: Partial<Form>) => setForm((prev) => ({ ...prev, ...patch }));
  const sms = smsSegments(form.smsText || form.body);

  const workspaceOptions = useMemo(
    () =>
      (workspaces ?? [])
        .filter((workspace) => workspace.status === "active")
        .map((workspace) => ({ _id: workspace._id, name: workspace.name, slug: workspace.slug })),
    [workspaces]
  );

  const emailHtml = useMemo(
    () =>
      broadcastEmailHtml({
        category: form.category,
        heading: form.title || "Notification title",
        body: (form.emailFormat === "text" && form.emailBody) || form.body || "Your message appears here.",
        bodyHtml: form.emailFormat === "html" && form.emailBody ? form.emailBody : undefined,
        imageUrl: form.imageUrl,
        link: form.link,
        linkLabel: form.linkLabel,
        unsubscribeUrl: form.category === "offer" ? "#" : undefined,
        brand: "Magic Agent",
      }),
    [form]
  );

  const persist = async (): Promise<Id<"platformBroadcasts">> => {
    const id = await save({
      id: broadcast?._id,
      title: form.title,
      body: form.body,
      category: form.category,
      channels: form.channels,
      emailSubject: form.emailSubject || undefined,
      emailBody: form.emailBody || undefined,
      emailFormat: form.emailFormat,
      smsText: form.smsText || undefined,
      smsTemplateId: form.smsTemplateId || undefined,
      imageKey: form.imageKey,
      link: form.link || undefined,
      linkLabel: form.linkLabel || undefined,
      audience: form.audience,
    });
    if (!broadcast) router.replace(`/admin/notifications/${id}`);
    return id;
  };

  const run = async (label: string, task: () => Promise<void>, failTitle: string) => {
    setBusy(label);
    try {
      await task();
    } catch (error) {
      toast.add({ title: failTitle, description: errorText(error), type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_MAX_BYTES) {
      toast.add({ title: "Use a PNG, JPG, WebP or GIF under 2 MB", type: "error" });
      return;
    }
    await run(
      "upload",
      async () => {
        const key = await putFile(await generateUploadUrl({}), file);
        set({ imageKey: key, imageUrl: URL.createObjectURL(file) });
      },
      "Could not upload the image"
    );
  };

  const keepsWriting = (what: string) => {
    const written = form.title.trim() || form.body.trim() || form.emailBody.trim() || form.smsText.trim();
    return Boolean(written) && !window.confirm(`Replace what you have written with ${what}?`);
  };

  const applyTemplate = (template: NotificationTemplate) => {
    if (keepsWriting("this template")) return;
    const available = configured ?? { push: true, email: true, sms: true };
    set({
      title: template.title,
      body: template.body,
      category: template.category,
      channels: {
        push: template.channels.push && available.push,
        email: template.channels.email && available.email,
        sms: template.channels.sms && available.sms,
      },
      emailSubject: template.emailSubject ?? "",
      emailBody: template.emailBody,
      emailFormat: "text",
      smsText: template.smsText,
      linkLabel: template.linkLabel ?? "",
    });
    setGalleryOpen(false);
  };

  const applyDraft = (draft: AiDraft) => {
    if (keepsWriting("the AI draft")) return;
    set(draft);
    setAiOpen(false);
    toast.add({ title: "Draft written", description: "Read it through and fill any [placeholders].", type: "success" });
  };

  const switchEmailFormat = (next: "text" | "html") => {
    if (next === form.emailFormat) return;
    const current = form.emailBody.trim();
    set({
      emailFormat: next,
      emailBody:
        next === "html"
          ? textToEmailHtml(current || form.body)
          : current
            ? htmlToText(current)
            : "",
    });
  };

  const unfilled = placeholdersIn(
    form.title,
    form.body,
    form.linkLabel,
    form.channels.email ? `${form.emailSubject} ${form.emailBody}` : "",
    form.channels.sms ? form.smsText : ""
  );

  const readOnly = !modifies;
  const scheduled = broadcast?.status === "scheduled";
  const channelOn = CHANNELS.some((channel) => form.channels[channel.value]);
  const ready =
    form.title.trim() &&
    form.body.trim() &&
    channelOn &&
    unfilled.length === 0 &&
    (reach?.workspaces ?? 0) > 0;
  const previews = CHANNELS.filter((channel) => form.channels[channel.value]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {broadcast ? broadcast.title : "New notification"}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Reaches workspace owners by app push, email and SMS. Push also lands in the bell in
            their mobile app.
          </p>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            {broadcast?.status === "draft" ? (
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    "delete",
                    async () => {
                      await remove({ id: broadcast._id });
                      router.replace("/admin/notifications");
                    },
                    "Could not delete the draft"
                  )
                }
              >
                <TrashIcon /> Delete
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy !== null} onClick={() => setGalleryOpen(true)}>
              <SquaresFourIcon /> Templates
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => setAiOpen(true)}>
              <SparkleIcon /> Draft with AI
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "save",
                  async () => {
                    await persist();
                    toast.add({ title: "Draft saved", type: "success" });
                  },
                  "Could not save the draft"
                )
              }
            >
              {busy === "save" ? <Spinner /> : <FloppyDiskIcon />} Save draft
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null || !form.title.trim() || !form.body.trim()}
              onClick={() => setTestOpen(true)}
            >
              <TestTubeIcon /> Send test
            </Button>
            <Button variant="outline" disabled={busy !== null || !ready} onClick={() => setScheduleOpen(true)}>
              <CalendarBlankIcon /> {scheduled ? "Reschedule" : "Schedule"}
            </Button>
            <Button disabled={busy !== null || !ready} onClick={() => setConfirmOpen(true)}>
              <PaperPlaneTiltIcon /> Send now
            </Button>
          </div>
        )}
      </header>

      {unfilled.length > 0 && !readOnly ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          Replace the placeholders before sending:{" "}
          <span className="font-mono text-xs">{unfilled.join(" ")}</span>
        </div>
      ) : null}

      {scheduled && broadcast?.scheduledAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm">
          <span>
            Scheduled for <strong>{format(new Date(broadcast.scheduledAt), "d MMM yyyy, h:mm a")}</strong>.
            Saving changes keeps the schedule.
          </span>
          {readOnly ? null : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "unschedule",
                  async () => {
                    await cancel({ id: broadcast._id });
                    toast.add({ title: "Back to draft", type: "success" });
                  },
                  "Could not unschedule"
                )
              }
            >
              <XIcon /> Unschedule
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Message</CardTitle>
              <CardDescription>The title and message are used on every channel unless you customise one below.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pn-category">Type</Label>
                <SelectField
                  id="pn-category"
                  className="w-full sm:w-64"
                  disabled={readOnly}
                  value={form.category}
                  onValueChange={(value) => set({ category: value as Category })}
                  options={CATEGORIES.map((category) => ({ value: category.value, label: category.label }))}
                />
                <p className="text-xs text-muted-foreground">
                  {CATEGORIES.find((category) => category.value === form.category)?.hint}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pn-title" className="flex justify-between">
                  Title
                  <span className="font-normal text-muted-foreground">{form.title.length}/65</span>
                </Label>
                <Input
                  id="pn-title"
                  value={form.title}
                  maxLength={120}
                  placeholder="WhatsApp catalogue sharing is here"
                  onChange={(event) => set({ title: event.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pn-body" className="flex justify-between">
                  Message
                  <span className="font-normal text-muted-foreground">{form.body.length}/178 shows on a lock screen</span>
                </Label>
                <Textarea
                  id="pn-body"
                  rows={4}
                  value={form.body}
                  placeholder="Agents can now send your full catalogue as a WhatsApp list. Turn it on from Catalogue."
                  onChange={(event) => set({ body: event.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Image</Label>
                <input
                  ref={imageInput}
                  type="file"
                  accept={IMAGE_TYPES.join(",")}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                  }}
                />
                {form.imageUrl ? (
                  <div className="flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.imageUrl} alt="" className="h-24 w-40 rounded-md border object-cover" />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => set({ imageKey: undefined, imageUrl: undefined })}
                    >
                      <TrashIcon /> Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-fit"
                    disabled={busy === "upload"}
                    onClick={() => imageInput.current?.click()}
                  >
                    {busy === "upload" ? <Spinner /> : <ImageIcon />} Add image
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">Shown in the email. PNG, JPG, WebP or GIF up to 2 MB.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pn-link">Link</Label>
                  <Input
                    id="pn-link"
                    type="url"
                    value={form.link}
                    placeholder="https://agent.magicwebs.ai/whats-new"
                    onChange={(event) => set({ link: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pn-link-label">Button label</Label>
                  <Input
                    id="pn-link-label"
                    value={form.linkLabel}
                    placeholder="Learn more"
                    onChange={(event) => set({ linkLabel: event.target.value })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Channels</CardTitle>
              <CardDescription>Each person is sent one copy per channel, however many workspaces they own.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {CHANNELS.map((channel) => {
                const available = configured ? configured[channel.value] : true;
                return (
                  <div key={channel.value} className="flex flex-col gap-3 rounded-lg border p-3">
                    <label className="flex cursor-pointer items-center gap-3">
                      <channel.icon className="size-5 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">{channel.label}</span>
                      {available ? null : <Badge variant="outline">Not configured</Badge>}
                      <Switch
                        checked={form.channels[channel.value]}
                        disabled={!available && !form.channels[channel.value]}
                        onCheckedChange={(checked) =>
                          set({ channels: { ...form.channels, [channel.value]: checked } })
                        }
                      />
                    </label>

                    {channel.value === "email" && form.channels.email ? (
                      <div className="flex flex-col gap-3 border-t pt-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="pn-subject">Subject</Label>
                          <Input
                            id="pn-subject"
                            value={form.emailSubject}
                            placeholder={form.title || "Uses the title"}
                            onChange={(event) => set({ emailSubject: event.target.value })}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="pn-email-body">
                              {form.emailFormat === "html" ? "Email HTML" : "Email text"}
                            </Label>
                            <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Email format">
                              {(["text", "html"] as const).map((format) => (
                                <button
                                  key={format}
                                  type="button"
                                  role="radio"
                                  aria-checked={form.emailFormat === format}
                                  onClick={() => switchEmailFormat(format)}
                                  className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${
                                    form.emailFormat === format
                                      ? "bg-primary text-primary-foreground"
                                      : "text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {format === "html" ? "HTML" : "Text"}
                                </button>
                              ))}
                            </div>
                          </div>
                          <Textarea
                            id="pn-email-body"
                            rows={form.emailFormat === "html" ? 14 : 6}
                            value={form.emailBody}
                            spellCheck={form.emailFormat === "text"}
                            className={form.emailFormat === "html" ? "font-mono text-xs" : undefined}
                            placeholder={
                              form.emailFormat === "html"
                                ? "<p>Hello,</p>\n<p>We have launched <strong>…</strong></p>"
                                : "Uses the message. Write a longer version here; a blank line starts a new paragraph."
                            }
                            onChange={(event) => set({ emailBody: event.target.value })}
                          />
                          {form.emailFormat === "html" ? (
                            <p className="text-xs text-muted-foreground">
                              Goes inside the branded layout, between the heading and the button.
                              Use inline styles; scripts, forms and frames are removed.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {channel.value === "sms" && form.channels.sms ? (
                      <div className="flex flex-col gap-3 border-t pt-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="pn-sms" className="flex justify-between">
                            SMS text
                            <span className="font-normal text-muted-foreground">
                              {sms.length} chars · {sms.segments} part{sms.segments === 1 ? "" : "s"}
                              {sms.unicode ? " · Unicode" : ""}
                            </span>
                          </Label>
                          <Textarea
                            id="pn-sms"
                            rows={3}
                            value={form.smsText}
                            placeholder="Uses the message. Keep it short; each part is billed."
                            onChange={(event) => set({ smsText: event.target.value })}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="pn-dlt">DLT template ID</Label>
                          <Input
                            id="pn-dlt"
                            value={form.smsTemplateId}
                            placeholder="Uses the default MSG91 template"
                            onChange={(event) => set({ smsTemplateId: event.target.value })}
                          />
                          <p className="text-xs text-muted-foreground">
                            Operators in India deliver only registered templates. The text fills the
                            template&apos;s variable, so it must match the registered wording.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audience</CardTitle>
              <CardDescription>Archived workspaces are never included.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Tabs
                value={form.audience.kind}
                onValueChange={(kind) =>
                  set({ audience: { ...form.audience, kind: kind as Audience["kind"] } })
                }
              >
                <TabsList className="w-full">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="stages">By stage</TabsTrigger>
                  <TabsTrigger value="plans">By plan</TabsTrigger>
                  <TabsTrigger value="workspaces">Pick</TabsTrigger>
                </TabsList>
                <TabsContent value="all">
                  <p className="text-sm text-muted-foreground">Every active workspace your role covers.</p>
                </TabsContent>
                <TabsContent value="stages">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {STAGES.map((stage) => (
                      <label key={stage.value} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.audience.stages?.includes(stage.value) ?? false}
                          onCheckedChange={(value) =>
                            set({
                              audience: {
                                ...form.audience,
                                stages: toggle(form.audience.stages, stage.value, value === true),
                              },
                            })
                          }
                        />
                        {stage.label}
                      </label>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="plans">
                  {settings?.plans.length ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {settings.plans.map((plan) => (
                        <label key={plan._id} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={form.audience.planIds?.includes(plan._id) ?? false}
                            onCheckedChange={(value) =>
                              set({
                                audience: {
                                  ...form.audience,
                                  planIds: toggle(form.audience.planIds, plan._id, value === true),
                                },
                              })
                            }
                          />
                          {plan.name}
                          {plan.status === "hidden" ? (
                            <span className="text-xs text-muted-foreground">(hidden)</span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No plans have been set up.</p>
                  )}
                </TabsContent>
                <TabsContent value="workspaces">
                  <WorkspacePicker
                    workspaces={workspaceOptions}
                    selected={form.audience.workspaceIds ?? []}
                    onChange={(workspaceIds) => set({ audience: { ...form.audience, workspaceIds } })}
                  />
                </TabsContent>
              </Tabs>

              <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">
                {[
                  { label: "Workspaces", value: reach?.workspaces },
                  { label: "Devices", value: reach?.devices },
                  { label: "Emails", value: reach?.emails },
                  { label: "Phones", value: reach?.phones },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="font-heading text-lg font-semibold tabular-nums">
                      {item.value === undefined ? "–" : item.value}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </fieldset>

        <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {previews.length === 0 ? (
                <p className="text-sm text-muted-foreground">Turn on a channel to preview it.</p>
              ) : (
                <Tabs key={previews.map((item) => item.value).join()} defaultValue={previews[0].value}>
                  <TabsList className="w-full">
                    {previews.map((channel) => (
                      <TabsTrigger key={channel.value} value={channel.value}>
                        <channel.icon /> {channel.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <TabsContent value="push">
                    <PushPreview title={form.title} body={form.body} />
                  </TabsContent>
                  <TabsContent value="email">
                    <p className="mb-2 truncate text-sm">
                      <span className="text-muted-foreground">Subject: </span>
                      {form.emailSubject || form.title || "—"}
                    </p>
                    <iframe
                      title="Email preview"
                      srcDoc={emailHtml}
                      sandbox=""
                      className="h-[520px] w-full rounded-md border bg-white"
                    />
                  </TabsContent>
                  <TabsContent value="sms">
                    <SmsPreview text={form.smsText || form.body} />
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <TemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onPick={applyTemplate}
        onAi={() => {
          setGalleryOpen(false);
          setAiOpen(true);
        }}
      />
      <AiDraftDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        channels={form.channels}
        emailFormat={form.emailFormat}
        onDraft={applyDraft}
      />

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send a test</DialogTitle>
            <DialogDescription>
              The email goes to your own address. Push is not tested here, because it only reaches
              customers&apos; app devices.
            </DialogDescription>
          </DialogHeader>
          {form.channels.sms ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pn-test-phone">Phone for the SMS</Label>
              <Input
                id="pn-test-phone"
                type="tel"
                value={testPhone}
                placeholder="+91 98765 43210"
                onChange={(event) => setTestPhone(event.target.value)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy !== null || (!form.channels.email && !form.channels.sms)}
              onClick={() =>
                void run(
                  "test",
                  async () => {
                    const id = await persist();
                    const outcome = await sendTest({ id, phone: testPhone || undefined });
                    toast.add({
                      title: "Test sent",
                      description: [outcome.email, outcome.sms].filter(Boolean).join(" · "),
                      type: "success",
                    });
                    setTestOpen(false);
                  },
                  "Could not send the test"
                )
              }
            >
              {busy === "test" ? <Spinner /> : <TestTubeIcon />} Send test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule</DialogTitle>
            <DialogDescription>Sent within a minute of this time, in your browser&apos;s time zone.</DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            value={scheduleAt}
            onChange={(event) => setScheduleAt(event.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy !== null || !scheduleAt}
              onClick={() =>
                void run(
                  "schedule",
                  async () => {
                    const at = new Date(scheduleAt).getTime();
                    if (!(at > Date.now() + 60_000)) throw new Error("Pick a time at least a couple of minutes ahead.");
                    const id = await persist();
                    await send({ id, at });
                    toast.add({ title: `Scheduled for ${format(new Date(at), "d MMM, h:mm a")}`, type: "success" });
                    setScheduleOpen(false);
                  },
                  "Could not schedule"
                )
              }
            >
              {busy === "schedule" ? <Spinner /> : <CalendarBlankIcon />} Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {reach?.workspaces ?? 0} workspaces now?</AlertDialogTitle>
            <AlertDialogDescription>
              {[
                form.channels.push ? `${reach?.devices ?? 0} app devices` : null,
                form.channels.email ? `${reach?.emails ?? 0} email addresses` : null,
                form.channels.sms ? `${reach?.phones ?? 0} phone numbers` : null,
              ]
                .filter(Boolean)
                .join(", ")}
              . Once sending starts it can be stopped, but what has gone out cannot be recalled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
            <AlertDialogAction
              render={
                <Button
                  onClick={() =>
                    void run(
                      "send",
                      async () => {
                        const id = await persist();
                        await send({ id });
                        toast.add({ title: "Sending started", type: "success" });
                      },
                      "Could not send"
                    )
                  }
                >
                  <PaperPlaneTiltIcon /> Send now
                </Button>
              }
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
