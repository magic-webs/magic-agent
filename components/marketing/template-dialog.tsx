"use client";

import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/billing";
import {
  metaBody,
  metaNameFor,
  templateBlocker,
  templateProblems,
} from "@/convex/lib/marketing";
import {
  BUTTON_TEXT_LIMIT,
  CARD_BODY_LIMIT,
  FOOTER_LIMIT,
  HEADER_LIMIT,
  HEADER_MEDIA_TYPES,
  MAX_BUTTONS,
  MAX_CARD_BUTTONS,
  MAX_CARDS,
  MAX_PHONE_BUTTONS,
  MAX_URL_BUTTONS,
  STOP_BUTTON,
  cardsProblems,
  partsProblems,
  sameParts,
  tidyCards,
  type HeaderMedia,
  type TemplateButton,
  type TemplateCard,
} from "@/convex/lib/templateParts";
import { putFile } from "@/lib/upload";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { templateStanding } from "@/components/marketing/format";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TestSendButton } from "@/components/marketing/test-send";
import { WhatsAppPreview } from "@/components/marketing/whatsapp-preview";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  Call02Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  HandIcon,
  Image01Icon,
  LinkSquare02Icon,
  PlusSignIcon,
  SentIcon,
  SparklesIcon,
  Upload01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";

import { fail, type Occasion, type Template } from "@/components/marketing/calendar";

type TemplateCategory = NonNullable<Doc<"marketingTemplates">["category"]>;
type HeaderKind = "none" | "text" | HeaderMedia["type"];

const HEADER_KINDS: { value: HeaderKind; label: string }[] = [
  { value: "none", label: "None" },
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];

/**
 * Meta's template categories, which are also what each send is billed at.
 * Service is missing on purpose: it is not something a template can be.
 */
const TEMPLATE_CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: "marketing", label: CATEGORY_LABELS.marketing },
  { value: "utility", label: CATEGORY_LABELS.utility },
  { value: "authentication", label: CATEGORY_LABELS.authentication },
];

const OCCASIONS: { value: Occasion; label: string }[] = [
  { value: "festival", label: "Festival" },
  { value: "birthday", label: "Birthday" },
  { value: "event", label: "Event reminder" },
  { value: "offer", label: "Offer" },
  { value: "general", label: "General" },
];

type MediaKind = HeaderMedia["type"];
type TemplateKind = "standard" | "carousel";

export type DraftCard = {
  media: (HeaderMedia & { url: string }) | null;
  body: string;
  buttons: TemplateButton[];
};

export type TemplateDraft = {
  templateId?: Id<"marketingTemplates">;
  kind: TemplateKind;
  cardMediaKind: MediaKind;
  cards: DraftCard[];
  name: string;
  occasion: Occasion;
  category: TemplateCategory;
  body: string;
  metaTemplateName: string;
  languageCode: string;
  headerKind: HeaderKind;
  header: string;
  headerMedia: (HeaderMedia & { url: string }) | null;
  footer: string;
  buttons: TemplateButton[];
};

function draftCards(draft: TemplateDraft): TemplateCard[] | undefined {
  if (draft.kind !== "carousel") return undefined;
  return draft.cards.map((card) => ({
    ...(card.media && card.media.type === draft.cardMediaKind
      ? { media: { type: card.media.type, key: card.media.key, mimeType: card.media.mimeType } }
      : {}),
    body: card.body,
    buttons: card.buttons,
  }));
}

const sameCards = (a: TemplateCard[] | undefined, b: TemplateCard[] | undefined) =>
  JSON.stringify(tidyCards(a) ?? null) === JSON.stringify(tidyCards(b) ?? null);

function blankCard(like?: DraftCard): DraftCard {
  return {
    media: null,
    body: "",
    buttons: like ? like.buttons.map((button) => ({ ...button })) : [{ type: "quick_reply", text: "" }],
  };
}

function draftParts(draft: TemplateDraft) {
  if (draft.kind === "carousel") {
    return { header: "", headerMedia: undefined, footer: "", buttons: [] as TemplateButton[] };
  }
  const media =
    draft.headerMedia && draft.headerMedia.type === draft.headerKind ? draft.headerMedia : null;
  return {
    header: draft.headerKind === "text" ? draft.header : "",
    headerMedia: media ? { type: media.type, key: media.key, mimeType: media.mimeType } : undefined,
    footer: draft.footer,
    buttons: draft.buttons,
  };
}

const BUTTON_KINDS: Array<{
  type: TemplateButton["type"];
  label: string;
  icon: IconSvgElement;
}> = [
  { type: "quick_reply", label: "Quick reply", icon: ArrowTurnBackwardIcon },
  { type: "url", label: "Website", icon: LinkSquare02Icon },
  { type: "phone", label: "Call", icon: Call02Icon },
];

function blankButton(type: TemplateButton["type"]): TemplateButton {
  if (type === "url") return { type, text: "Visit website", url: "https://" };
  if (type === "phone") return { type, text: "Call us", phone: "+91" };
  return { type, text: "" };
}

export function TemplateDialog({
  draft,
  setDraft,
  templates,
}: {
  draft: TemplateDraft | null;
  setDraft: (next: TemplateDraft | null) => void;
  templates: Template[];
}) {
  const workspace = useWorkspace();
  const saveTemplate = useMutation(api.marketing.saveTemplate);
  const removeTemplate = useMutation(api.marketing.removeTemplate);
  const draftTemplate = useAction(api.marketingAi.draft);
  const applyTemplate = useAction(api.marketingTemplates.apply);
  const generateUploadUrl = useMutation(api.marketing.generateTemplateUploadUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const cardInput = useRef<HTMLInputElement>(null);
  const cardTarget = useRef(0);

  if (!draft) {
    return <Dialog open={false} />;
  }

  // The stored row, live, for where Meta's review of it stands.
  const saved = draft.templateId
    ? templates.find((t) => t._id === draft.templateId)
    : undefined;
  const status = saved?.metaStatus;
  const edited =
    !!saved &&
    (draft.body.trim() !== saved.body ||
      draft.category !== (saved.category ?? "marketing") ||
      draft.languageCode.trim() !== saved.languageCode ||
      !sameParts(draftParts(draft), saved) ||
      !sameCards(draftCards(draft), saved.cards));
  const inReview = status === "PENDING" || status === "IN_APPEAL";
  // Approved, or linked by hand, and not touched since: nothing to apply.
  const settled =
    !!saved?.metaTemplateName && (status === undefined || status === "APPROVED") && !edited;
  const parts = draftParts(draft);
  const mediaKind =
    draft.headerKind === "image" || draft.headerKind === "video" ? draft.headerKind : null;
  const carousel = draft.kind === "carousel";
  const cards = draftCards(draft);
  const problems = [
    ...templateProblems(draft.body),
    ...partsProblems(parts),
    ...(!carousel && mediaKind && !parts.headerMedia ? [`Add the header ${mediaKind} first.`] : []),
    ...(cards ? cardsProblems(cards) : []),
  ];
  const cardButtons = draft.cards[0]?.buttons ?? [];
  const setCard = (index: number, next: DraftCard) =>
    setDraft({ ...draft, cards: draft.cards.map((card, i) => (i === index ? next : card)) });
  const moveCard = (index: number, by: number) => {
    const next = [...draft.cards];
    const [card] = next.splice(index, 1);
    next.splice(index + by, 0, card);
    setDraft({ ...draft, cards: next });
  };
  const cardKindAllowed = (type: TemplateButton["type"]) =>
    cardButtons.length < MAX_CARD_BUTTONS &&
    (type !== "phone" || !cardButtons.some((button) => button.type === "phone"));
  const addCardButton = (type: TemplateButton["type"]) =>
    setDraft({
      ...draft,
      cards: draft.cards.map((card) => ({ ...card, buttons: [...card.buttons, blankButton(type)] })),
    });
  const removeCardButton = (index: number) =>
    setDraft({
      ...draft,
      cards: draft.cards.map((card) => ({
        ...card,
        buttons: card.buttons.filter((_, i) => i !== index),
      })),
    });
  const setKind = (kind: TemplateKind) =>
    setDraft({
      ...draft,
      kind,
      cards: kind === "carousel" && draft.cards.length === 0 ? [blankCard(), blankCard()] : draft.cards,
    });
  const approvedChange = edited && saved?.metaStatus === "APPROVED";
  const urlButtons = draft.buttons.filter((button) => button.type === "url").length;
  const phoneButtons = draft.buttons.filter((button) => button.type === "phone").length;
  const isStop = (button: TemplateButton) =>
    button.type === "quick_reply" && button.text.trim().toLowerCase() === STOP_BUTTON.toLowerCase();
  const hasStop = draft.buttons.some(isStop);
  const setButton = (index: number, next: TemplateButton) =>
    setDraft({ ...draft, buttons: draft.buttons.map((button, i) => (i === index ? next : button)) });
  const kindAllowed = (type: TemplateButton["type"]) =>
    draft.buttons.length < MAX_BUTTONS &&
    (type !== "url" || urlButtons < MAX_URL_BUTTONS) &&
    (type !== "phone" || phoneButtons < MAX_PHONE_BUTTONS);

  const fields = () => ({
    workspaceId: workspace._id,
    templateId: draft.templateId,
    name: draft.name,
    occasion: draft.occasion,
    category: draft.category,
    body: draft.body,
    metaTemplateName: draft.metaTemplateName,
    languageCode: draft.languageCode,
    header: parts.header,
    headerMedia: parts.headerMedia ?? null,
    footer: parts.footer,
    buttons: parts.buttons,
    cards: cards ?? null,
  });

  const uploadCardMedia = async (index: number, file: File | undefined) => {
    if (!file) return;
    const kind = draft.cardMediaKind;
    const allowed = HEADER_MEDIA_TYPES[kind];
    if (
      !(allowed.mimeTypes as readonly string[]).includes(file.type) ||
      file.size > allowed.maxBytes
    ) {
      toast.add({ title: `The ${kind} must be ${allowed.label}`, type: "error" });
      return;
    }
    setBusy(`card-${index}`);
    try {
      const key = await putFile(await generateUploadUrl({ workspaceId: workspace._id }), file);
      setCard(index, {
        ...draft.cards[index],
        media: { type: kind, key, mimeType: file.type, url: URL.createObjectURL(file) },
      });
    } catch (error) {
      fail(`Could not upload the ${kind}`, error);
    } finally {
      setBusy(null);
    }
  };

  const uploadMedia = async (file: File | undefined) => {
    if (!file || !mediaKind) return;
    const allowed = HEADER_MEDIA_TYPES[mediaKind];
    if (
      !(allowed.mimeTypes as readonly string[]).includes(file.type) ||
      file.size > allowed.maxBytes
    ) {
      toast.add({ title: `The ${mediaKind} must be ${allowed.label}`, type: "error" });
      return;
    }
    setBusy("upload");
    try {
      const key = await putFile(await generateUploadUrl({ workspaceId: workspace._id }), file);
      setDraft({
        ...draft,
        headerMedia: { type: mediaKind, key, mimeType: file.type, url: URL.createObjectURL(file) },
      });
    } catch (error) {
      fail(`Could not upload the ${mediaKind}`, error);
    } finally {
      setBusy(null);
    }
  };

  const saveAndApply = async () => {
    setBusy("apply");
    let templateId = draft.templateId;
    try {
      templateId = await saveTemplate(fields());
      const result = await applyTemplate({ templateId });
      toast.add(
        result.status === "APPROVED"
          ? { title: `${draft.name.trim()} is approved`, type: "success" }
          : {
              title: `${draft.name.trim()} sent to Meta for review`,
              description:
                "It sends once Meta approves it — usually within minutes, sometimes a day.",
              type: "success",
            }
      );
      setDraft(null);
    } catch (error) {
      // Saved even if the apply failed, so a second try edits this template
      // rather than making another.
      if (templateId) setDraft({ ...draft, templateId });
      fail("Could not apply it to Meta", error);
    } finally {
      setBusy(null);
    }
  };

  const write = async () => {
    setBusy("write");
    try {
      const written = await draftTemplate({
        workspaceId: workspace._id,
        occasion: draft.occasion,
        eventTitle: draft.name.trim() || undefined,
        notes: draft.body.trim() || undefined,
      });
      setDraft({ ...draft, name: draft.name.trim() || written.name, body: written.body });
    } catch (error) {
      fail("The desk could not write a draft", error);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await saveTemplate(fields());
      toast.add({ title: `${draft.name.trim()} saved`, type: "success" });
      setDraft(null);
    } catch (error) {
      fail("Could not save the template", error);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!draft.templateId) return;
    setBusy("remove");
    try {
      await removeTemplate({ templateId: draft.templateId });
      toast.add({ title: "Template deleted", type: "success" });
      setDraft(null);
    } catch (error) {
      fail("Could not delete the template", error);
    } finally {
      setBusy(null);
    }
  };

  const numbered = metaBody(draft.body.trim());

  return (
    <Dialog open onOpenChange={(open) => (open ? null : setDraft(null))}>
      <DialogContent className="sm:max-w-2xl lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{draft.templateId ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            {draft.occasion === "event" ? (
              <>
                Put <code>{"{{message}}"}</code> where each reminder&apos;s own line goes;{" "}
                <code>{"{{event}}"}</code>, <code>{"{{date}}"}</code> and{" "}
                <code>{"{{venue}}"}</code> come from the event.
              </>
            ) : (
              <>
                Use <code>{"{{name}}"}</code>, <code>{"{{business}}"}</code> and{" "}
                <code>{"{{event}}"}</code> — each customer gets their own.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_296px]">
        <div className="flex min-w-0 flex-col gap-4">
          {saved?.metaTemplateName ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
              <Badge variant="secondary" className={templateStanding(saved).className}>
                {templateStanding(saved).label}
              </Badge>
              <span className="min-w-0 text-muted-foreground">
                {templateBlocker(saved) ?? (
                  <>
                    Sends as <code className="text-foreground">{saved.metaTemplateName}</code>.
                  </>
                )}
              </span>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={draft.name}
                maxLength={60}
                placeholder="Template name"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Occasion</Label>
              <SelectField
                aria-label="Occasion"
                value={draft.occasion}
                onValueChange={(next) => setDraft({ ...draft, occasion: next as Occasion })}
                options={OCCASIONS}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <SelectField
                aria-label="Category"
                value={draft.category}
                onValueChange={(next) =>
                  setDraft({ ...draft, category: next as TemplateCategory })
                }
                options={TEMPLATE_CATEGORIES}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Type</Label>
            <ToggleGroup
              value={[draft.kind]}
              onValueChange={(value) => {
                const next = value[0] as TemplateKind | undefined;
                if (next) setKind(next);
              }}
              variant="outline"
              size="sm"
              aria-label="Template type"
            >
              <ToggleGroupItem value="standard">Standard</ToggleGroupItem>
              <ToggleGroupItem value="carousel">Carousel</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {!carousel ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="template-header">Header</Label>
              <ToggleGroup
                value={[draft.headerKind]}
                onValueChange={(value) => {
                  const next = value[0] as HeaderKind | undefined;
                  if (next) setDraft({ ...draft, headerKind: next });
                }}
                variant="outline"
                size="sm"
                aria-label="Header type"
              >
                {HEADER_KINDS.map((kind) => (
                  <ToggleGroupItem key={kind.value} value={kind.value}>
                    {kind.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {draft.headerKind === "text" ? (
              <>
                <Input
                  id="template-header"
                  value={draft.header}
                  maxLength={HEADER_LIMIT}
                  placeholder="Header text"
                  onChange={(event) => setDraft({ ...draft, header: event.target.value })}
                />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {draft.header.length}/{HEADER_LIMIT}
                </span>
              </>
            ) : mediaKind ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2.5">
                {parts.headerMedia && draft.headerMedia ? (
                  mediaKind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.headerMedia.url}
                      alt=""
                      className="size-14 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <video
                      src={draft.headerMedia.url}
                      muted
                      className="size-14 shrink-0 rounded-md bg-muted object-cover"
                    />
                  )
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    {mediaKind === "image" ? (
                      <HugeiconsIcon icon={Image01Icon} strokeWidth={2} className="size-5" />
                    ) : (
                      <HugeiconsIcon icon={Video01Icon} strokeWidth={2} className="size-5" />
                    )}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {parts.headerMedia ? `Header ${mediaKind}` : `No ${mediaKind} yet`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {HEADER_MEDIA_TYPES[mediaKind].label}
                  </span>
                </div>
                <input
                  ref={mediaInput}
                  type="file"
                  hidden
                  accept={HEADER_MEDIA_TYPES[mediaKind].mimeTypes.join(",")}
                  onChange={(event) => {
                    void uploadMedia(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => mediaInput.current?.click()}
                >
                  {busy === "upload" ? <Spinner /> : <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} />}
                  {parts.headerMedia ? "Replace" : "Upload"}
                </Button>
              </div>
            ) : null}
          </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="template-body">Message</Label>
              <Button size="sm" variant="outline" onClick={() => void write()} disabled={busy !== null}>
                {busy === "write" ? <Spinner /> : <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />}
                {busy === "write" ? "Writing…" : draft.body.trim() ? "Rewrite" : "Write it for me"}
              </Button>
            </div>
            <Textarea
              id="template-body"
              value={draft.body}
              rows={5}
              maxLength={1024}
              placeholder={
                draft.occasion === "event"
                  ? "The message — use {{name}}, {{message}}, {{event}}, {{date}} and {{business}}"
                  : "The message — use {{name}}, {{event}} and {{business}}"
              }
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Jot notes here first and “Write it for me” works from them — an offer, a
              language, a tone. The marketing desk writes it in your company’s voice.
            </p>
          </div>

          {carousel ? (
            <CardsEditor
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              cardButtons={cardButtons}
              setCard={setCard}
              moveCard={moveCard}
              cardKindAllowed={cardKindAllowed}
              addCardButton={addCardButton}
              removeCardButton={removeCardButton}
              pickMedia={(index) => {
                cardTarget.current = index;
                cardInput.current?.click();
              }}
            />
          ) : null}
          <input
            ref={cardInput}
            type="file"
            hidden
            accept={HEADER_MEDIA_TYPES[draft.cardMediaKind].mimeTypes.join(",")}
            onChange={(event) => {
              void uploadCardMedia(cardTarget.current, event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          {!carousel ? (
          <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="template-footer">Footer</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                Optional · {draft.footer.length}/{FOOTER_LIMIT}
              </span>
            </div>
            <Input
              id="template-footer"
              value={draft.footer}
              maxLength={FOOTER_LIMIT}
              placeholder="Footer text"
              onChange={(event) => setDraft({ ...draft, footer: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Buttons</Label>
              <span className="text-xs text-muted-foreground">
                Up to {MAX_BUTTONS} · {MAX_URL_BUTTONS} website · {MAX_PHONE_BUTTONS} call
              </span>
            </div>
            {draft.buttons.map((button, index) => {
              const kind = BUTTON_KINDS.find((item) => item.type === button.type)!;
              return (
                <div
                  key={index}
                  className="flex flex-col gap-2 rounded-lg border border-border p-2.5 sm:flex-row sm:items-center"
                >
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:w-24">
                    <HugeiconsIcon icon={kind.icon} strokeWidth={2} className="size-3.5" /> {kind.label}
                  </span>
                  <Input
                    aria-label="Button label"
                    value={button.text}
                    maxLength={BUTTON_TEXT_LIMIT}
                    placeholder="Button label"
                    className="h-8 sm:max-w-44"
                    onChange={(event) => setButton(index, { ...button, text: event.target.value })}
                  />
                  {button.type === "url" ? (
                    <Input
                      aria-label="Web address"
                      value={button.url}
                      placeholder="Link address"
                      className="h-8 min-w-0 flex-1 font-mono text-xs"
                      onChange={(event) => setButton(index, { ...button, url: event.target.value })}
                    />
                  ) : button.type === "phone" ? (
                    <Input
                      aria-label="Phone number"
                      value={button.phone}
                      inputMode="tel"
                      placeholder="Phone number"
                      className="h-8 min-w-0 flex-1 font-mono text-xs"
                      onChange={(event) => setButton(index, { ...button, phone: event.target.value })}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {isStop(button)
                        ? "Tapping it unsubscribes them."
                        : "Their tap comes back as a reply in the inbox."}
                    </span>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove button"
                    className="self-end sm:self-auto"
                    onClick={() =>
                      setDraft({ ...draft, buttons: draft.buttons.filter((_, i) => i !== index) })
                    }
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                  </Button>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              {BUTTON_KINDS.map((kind) => (
                <Button
                  key={kind.type}
                  size="sm"
                  variant="outline"
                  disabled={!kindAllowed(kind.type)}
                  onClick={() =>
                    setDraft({ ...draft, buttons: [...draft.buttons, blankButton(kind.type)] })
                  }
                >
                  <HugeiconsIcon icon={kind.icon} strokeWidth={2} /> {kind.label}
                </Button>
              ))}
              {!hasStop && draft.category === "marketing" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!kindAllowed("quick_reply")}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      buttons: [...draft.buttons, { type: "quick_reply", text: STOP_BUTTON }],
                    })
                  }
                >
                  <HugeiconsIcon icon={HandIcon} strokeWidth={2} /> Add “{STOP_BUTTON}”
                </Button>
              ) : null}
            </div>
          </div>
          </>
          ) : null}

          {numbered ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                What Meta reviews
              </p>
              <p className="font-mono text-sm whitespace-pre-wrap select-all">{numbered}</p>
              <p className="text-xs text-muted-foreground">
                Category <strong>{CATEGORY_LABELS[draft.category]}</strong> — the category
                Meta approves it under is what each send is billed at. Applying sends it
                through your WhatsApp number&apos;s panel, with a sample for each variable.
              </p>
              {problems.length > 0 ? (
                <ul className="flex flex-col gap-1 text-xs font-medium text-destructive">
                  {problems.map((problem) => (
                    <li key={problem} className="flex items-start gap-1.5">
                      <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
                      {problem}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-meta">Name in Meta</Label>
              <Input
                id="template-meta"
                value={draft.metaTemplateName}
                placeholder={metaNameFor(draft.name || "Template name")}
                className="font-mono"
                onChange={(event) => setDraft({ ...draft, metaTemplateName: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Set when you apply it. Paste one here only for a template approved
                somewhere else.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-language">Language</Label>
              <Input
                id="template-language"
                value={draft.languageCode}
                maxLength={10}
                placeholder="Language code"
                className="font-mono"
                onChange={(event) => setDraft({ ...draft, languageCode: event.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:sticky lg:top-0 lg:self-start">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Preview
          </p>
          <WhatsAppPreview
            body={draft.body}
            header={parts.header}
            headerMedia={
              parts.headerMedia && draft.headerMedia
                ? { type: parts.headerMedia.type, url: draft.headerMedia.url }
                : mediaKind
                  ? { type: mediaKind }
                  : undefined
            }
            footer={draft.footer}
            buttons={draft.buttons}
            cards={
              carousel
                ? draft.cards.map((card) => ({
                    media:
                      card.media && card.media.type === draft.cardMediaKind
                        ? { type: card.media.type, url: card.media.url }
                        : { type: draft.cardMediaKind },
                    body: card.body,
                    buttons: card.buttons,
                  }))
                : undefined
            }
            business={workspace.name}
            occasion={draft.occasion}
          />
        </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          {draft.templateId ? (
            <Button variant="ghost" onClick={() => void remove()} disabled={busy !== null}>
              {busy === "remove" ? <Spinner /> : <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />} Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {approvedChange ? (
              <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="size-3.5" />
                Saving pauses it until Meta approves the change.
              </span>
            ) : null}
            {saved ? (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => setDraft(copyDraftOf(saved))}
              >
                <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} /> Duplicate
              </Button>
            ) : null}
            {saved ? (
              <TestSendButton
                templateId={saved._id}
                disabledReason={
                  edited
                    ? "Save the change first — the test sends what Meta approved."
                    : templateBlocker(saved)
                }
              />
            ) : null}
            <Button
              variant={settled ? "default" : "outline"}
              onClick={() => void save()}
              disabled={busy !== null || !draft.name.trim() || !draft.body.trim()}
            >
              {busy === "save" ? <Spinner /> : null} Save template
            </Button>
            {inReview ? (
              <Button disabled>In review with Meta</Button>
            ) : !settled ? (
              <Button
                onClick={() => void saveAndApply()}
                disabled={
                  busy !== null || !draft.name.trim() || !draft.body.trim() || problems.length > 0
                }
              >
                {busy === "apply" ? <Spinner /> : <HugeiconsIcon icon={SentIcon} strokeWidth={2} />}
                {saved?.metaTemplateId ? "Save and apply the change" : "Save and apply to Meta"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function draftFor(template?: Template): TemplateDraft {
  return template
    ? {
        templateId: template._id,
        kind: template.cards?.length ? "carousel" : "standard",
        cardMediaKind: template.cards?.find((card) => card.media)?.media?.type ?? "image",
        cards: (template.cards ?? []).map((card, index) => {
          const url = template.cardMediaUrls?.[index];
          return {
            media: card.media && url ? { ...card.media, url } : null,
            body: card.body,
            buttons: card.buttons,
          };
        }),
        name: template.name,
        occasion: template.occasion,
        category: template.category ?? "marketing",
        body: template.body,
        metaTemplateName: template.metaTemplateName ?? "",
        languageCode: template.languageCode,
        headerKind: template.headerMedia?.type ?? (template.header ? "text" : "none"),
        header: template.header ?? "",
        headerMedia:
          template.headerMedia && template.headerMediaUrl
            ? { ...template.headerMedia, url: template.headerMediaUrl }
            : null,
        footer: template.footer ?? "",
        buttons: template.buttons ?? [],
      }
    : {
        kind: "standard",
        cardMediaKind: "image",
        cards: [],
        name: "",
        occasion: "festival",
        category: "marketing",
        body: "",
        metaTemplateName: "",
        languageCode: "en",
        headerKind: "none",
        header: "",
        headerMedia: null,
        footer: "",
        buttons: [],
      };
}

export function copyDraftOf(template: Template): TemplateDraft {
  return {
    ...draftFor(template),
    templateId: undefined,
    name: `${template.name} (copy)`,
    metaTemplateName: "",
  };
}

function CardsEditor({
  draft,
  setDraft,
  busy,
  cardButtons,
  setCard,
  moveCard,
  cardKindAllowed,
  addCardButton,
  removeCardButton,
  pickMedia,
}: {
  draft: TemplateDraft;
  setDraft: (next: TemplateDraft) => void;
  busy: string | null;
  cardButtons: TemplateButton[];
  setCard: (index: number, next: DraftCard) => void;
  moveCard: (index: number, by: number) => void;
  cardKindAllowed: (type: TemplateButton["type"]) => boolean;
  addCardButton: (type: TemplateButton["type"]) => void;
  removeCardButton: (index: number) => void;
  pickMedia: (index: number) => void;
}) {
  const kind = draft.cardMediaKind;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Cards</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Each card shows</span>
          <ToggleGroup
            value={[kind]}
            onValueChange={(value) => {
              const next = value[0] as MediaKind | undefined;
              if (next) setDraft({ ...draft, cardMediaKind: next });
            }}
            variant="outline"
            size="sm"
            aria-label="Card media"
          >
            <ToggleGroupItem value="image">Image</ToggleGroupItem>
            <ToggleGroupItem value="video">Video</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Card buttons</span>
          <span className="text-xs text-muted-foreground">
            Up to {MAX_CARD_BUTTONS} · the same on every card
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cardButtons.map((button, index) => {
            const item = BUTTON_KINDS.find((one) => one.type === button.type)!;
            return (
              <span
                key={index}
                className="flex h-7 items-center gap-1.5 rounded-md bg-secondary pr-0.5 pl-2 text-xs font-medium"
              >
                <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-3.5" />
                {item.label}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-6"
                  aria-label={`Remove ${item.label.toLowerCase()} button`}
                  onClick={() => removeCardButton(index)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                </Button>
              </span>
            );
          })}
          {BUTTON_KINDS.map((item) => (
            <Button
              key={item.type}
              size="sm"
              variant="outline"
              disabled={!cardKindAllowed(item.type)}
              onClick={() => addCardButton(item.type)}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> {item.label}
            </Button>
          ))}
        </div>
      </div>

      {draft.cards.map((card, index) => {
        const media = card.media && card.media.type === kind ? card.media : null;
        return (
          <div key={index} className="flex flex-col gap-2.5 rounded-lg border border-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Card {index + 1}</span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Move card earlier"
                  disabled={index === 0}
                  onClick={() => moveCard(index, -1)}
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Move card later"
                  disabled={index === draft.cards.length - 1}
                  onClick={() => moveCard(index, 1)}
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove card"
                  disabled={draft.cards.length <= 2}
                  onClick={() =>
                    setDraft({ ...draft, cards: draft.cards.filter((_, i) => i !== index) })
                  }
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {media ? (
                kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={media.url} alt="" className="size-14 shrink-0 rounded-md object-cover" />
                ) : (
                  <video
                    src={media.url}
                    muted
                    className="size-14 shrink-0 rounded-md bg-muted object-cover"
                  />
                )
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <HugeiconsIcon
                    icon={kind === "image" ? Image01Icon : Video01Icon}
                    strokeWidth={2}
                    className="size-5"
                  />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm">{media ? `Card ${kind}` : `No ${kind} yet`}</span>
                <span className="text-xs text-muted-foreground">{HEADER_MEDIA_TYPES[kind].label}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => pickMedia(index)}
              >
                {busy === `card-${index}` ? (
                  <Spinner />
                ) : (
                  <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} />
                )}
                {media ? "Replace" : "Upload"}
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              <Textarea
                aria-label={`Card ${index + 1} text`}
                value={card.body}
                rows={2}
                maxLength={CARD_BODY_LIMIT}
                placeholder="What this card says"
                onChange={(event) => setCard(index, { ...card, body: event.target.value })}
              />
              <span className="self-end text-xs text-muted-foreground tabular-nums">
                {card.body.length}/{CARD_BODY_LIMIT}
              </span>
            </div>

            {card.buttons.map((button, buttonIndex) => {
              const item = BUTTON_KINDS.find((one) => one.type === button.type)!;
              const setButton = (next: TemplateButton) =>
                setCard(index, {
                  ...card,
                  buttons: card.buttons.map((one, i) => (i === buttonIndex ? next : one)),
                });
              return (
                <div key={buttonIndex} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground sm:w-24">
                    <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-3.5" /> {item.label}
                  </span>
                  <Input
                    aria-label="Button label"
                    value={button.text}
                    maxLength={BUTTON_TEXT_LIMIT}
                    placeholder="Button label"
                    className="h-8 sm:max-w-44"
                    onChange={(event) => setButton({ ...button, text: event.target.value })}
                  />
                  {button.type === "url" ? (
                    <Input
                      aria-label="Web address"
                      value={button.url}
                      placeholder="Link address"
                      className="h-8 min-w-0 flex-1 font-mono text-xs"
                      onChange={(event) => setButton({ ...button, url: event.target.value })}
                    />
                  ) : button.type === "phone" ? (
                    <Input
                      aria-label="Phone number"
                      value={button.phone}
                      inputMode="tel"
                      placeholder="Phone number"
                      className="h-8 min-w-0 flex-1 font-mono text-xs"
                      onChange={(event) => setButton({ ...button, phone: event.target.value })}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}

      <Button
        variant="outline"
        disabled={draft.cards.length >= MAX_CARDS}
        onClick={() =>
          setDraft({
            ...draft,
            cards: [...draft.cards, blankCard(draft.cards[draft.cards.length - 1])],
          })
        }
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add card ({draft.cards.length}/
        {MAX_CARDS})
      </Button>
    </div>
  );
}
