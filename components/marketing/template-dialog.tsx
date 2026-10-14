"use client";

import { useState } from "react";
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
  FOOTER_LIMIT,
  HEADER_LIMIT,
  MAX_BUTTONS,
  MAX_PHONE_BUTTONS,
  MAX_URL_BUTTONS,
  STOP_BUTTON,
  partsProblems,
  sameParts,
  type TemplateButton,
} from "@/convex/lib/templateParts";
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
import {
  ArrowSquareOutIcon,
  ArrowUUpLeftIcon,
  HandPalmIcon,
  PaperPlaneTiltIcon,
  PhoneIcon,
  SparkleIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { fail, type Occasion, type Template } from "@/components/marketing/calendar";

type TemplateCategory = NonNullable<Doc<"marketingTemplates">["category"]>;

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

export type TemplateDraft = {
  templateId?: Id<"marketingTemplates">;
  name: string;
  occasion: Occasion;
  category: TemplateCategory;
  body: string;
  metaTemplateName: string;
  languageCode: string;
  header: string;
  footer: string;
  buttons: TemplateButton[];
};

const BUTTON_KINDS: Array<{
  type: TemplateButton["type"];
  label: string;
  icon: typeof PhoneIcon;
}> = [
  { type: "quick_reply", label: "Quick reply", icon: ArrowUUpLeftIcon },
  { type: "url", label: "Website", icon: ArrowSquareOutIcon },
  { type: "phone", label: "Call", icon: PhoneIcon },
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
  const [busy, setBusy] = useState<string | null>(null);

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
      !sameParts(draft, saved));
  const inReview = status === "PENDING" || status === "IN_APPEAL";
  // Approved, or linked by hand, and not touched since: nothing to apply.
  const settled =
    !!saved?.metaTemplateName && (status === undefined || status === "APPROVED") && !edited;
  const problems = [...templateProblems(draft.body), ...partsProblems(draft)];
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
    header: draft.header,
    footer: draft.footer,
    buttons: draft.buttons,
  });

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

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="template-header">Header</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                Optional · {draft.header.length}/{HEADER_LIMIT}
              </span>
            </div>
            <Input
              id="template-header"
              value={draft.header}
              maxLength={HEADER_LIMIT}
              placeholder="Header text"
              onChange={(event) => setDraft({ ...draft, header: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="template-body">Message</Label>
              <Button size="sm" variant="outline" onClick={() => void write()} disabled={busy !== null}>
                {busy === "write" ? <Spinner /> : <SparkleIcon />}
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
                    <kind.icon className="size-3.5" /> {kind.label}
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
                    <XIcon />
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
                  <kind.icon /> {kind.label}
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
                  <HandPalmIcon /> Add “{STOP_BUTTON}”
                </Button>
              ) : null}
            </div>
          </div>

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
                      <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
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
            header={draft.header}
            footer={draft.footer}
            buttons={draft.buttons}
            business={workspace.name}
            occasion={draft.occasion}
          />
        </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          {draft.templateId ? (
            <Button variant="ghost" onClick={() => void remove()} disabled={busy !== null}>
              {busy === "remove" ? <Spinner /> : <TrashIcon />} Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {approvedChange ? (
              <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                <WarningCircleIcon className="size-3.5" />
                Saving pauses it until Meta approves the change.
              </span>
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
                {busy === "apply" ? <Spinner /> : <PaperPlaneTiltIcon />}
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
        name: template.name,
        occasion: template.occasion,
        category: template.category ?? "marketing",
        body: template.body,
        metaTemplateName: template.metaTemplateName ?? "",
        languageCode: template.languageCode,
        header: template.header ?? "",
        footer: template.footer ?? "",
        buttons: template.buttons ?? [],
      }
    : {
        name: "",
        occasion: "festival",
        category: "marketing",
        body: "",
        metaTemplateName: "",
        languageCode: "en",
        header: "",
        footer: "",
        buttons: [],
      };
}
