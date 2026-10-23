"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/billing";
import { templateBlocker } from "@/convex/lib/marketing";
import { useWorkspace } from "@/components/workspace-provider";
import { fail } from "@/components/marketing/calendar";
import { templateReady, templateStanding } from "@/components/marketing/format";
import {
  TemplateDialog,
  copyDraftOf,
  draftFor,
  type TemplateDraft,
} from "@/components/marketing/template-dialog";
import { WhatsAppPreview } from "@/components/marketing/whatsapp-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Megaphone01Icon,
  PlusSignIcon,
  RefreshIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";

const OCCASION_LABELS: Record<string, string> = {
  festival: "Festival",
  birthday: "Birthday",
  event: "Event reminder",
  offer: "Offer",
  general: "General",
};

const TEMPLATE_SKELETONS = [
  { name: "w-2/3", bubble: "h-28", meta: "w-40" },
  { name: "w-1/2", bubble: "h-36", meta: "w-32" },
  { name: "w-3/5", bubble: "h-24", meta: "w-44" },
];

function TemplateCardsSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {TEMPLATE_SKELETONS.map(({ name, bubble, meta }) => (
        <div key={name} className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 min-w-0 flex-1 items-center">
              <Skeleton className={cn("h-4", name)} />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="rounded-md border border-border p-2.5">
            <Skeleton className={cn("w-[88%] rounded-lg rounded-tl-none", bubble)} />
          </div>
          <div className="mt-auto flex h-4 items-center">
            <Skeleton className={cn("h-3", meta)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MarketingTemplatesPage() {
  const workspace = useWorkspace();
  const overview = useQuery(api.marketing.overview, { workspaceId: workspace._id });
  const templates = useMemo(
    () => [...(overview?.templates ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [overview]
  );
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const syncTemplates = useAction(api.marketingTemplates.sync);
  const [checking, setChecking] = useState(false);

  const unlinked = templates.filter((t) => !templateReady(t)).length;
  const inReview = templates.some((t) => t.metaStatus === "PENDING" || t.metaStatus === "IN_APPEAL");

  const runStatusCheck = async () => {
    setChecking(true);
    try {
      const { total, imported, skipped, changed } = await syncTemplates({
        workspaceId: workspace._id,
      });
      toast.add({
        title: "Templates synced",
        description: [
          `${total} in WhatsApp`,
          `${imported} added`,
          changed ? `${changed} updated` : null,
          skipped ? `${skipped} skipped — they need values the desk can't fill` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        type: "success",
      });
    } catch (error) {
      fail("Could not sync templates", error);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Templates</h2>
          <p className="text-sm text-muted-foreground">
            The WhatsApp templates campaigns, events and greetings go out as.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={checking} onClick={() => void runStatusCheck()}>
            {checking ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />} Sync templates
          </Button>
          <Button onClick={() => setDraft(draftFor())}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New template
          </Button>
        </div>
      </div>

      {unlinked > 0 ? (
        <Alert>
          <HugeiconsIcon icon={WhatsappIcon} strokeWidth={2} />
          <AlertTitle>
            {unlinked === 1 ? "1 template can't send yet" : `${unlinked} templates can't send yet`}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <p>
              WhatsApp only delivers marketing messages as templates Meta has approved. Open one and
              apply it to Meta — it sends once approved, and the approval is picked up here on its
              own.
            </p>
            {inReview ? (
              <Button size="sm" variant="outline" disabled={checking} onClick={() => void runStatusCheck()}>
                {checking ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />} Check status now
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {overview === undefined ? (
        <TemplateCardsSkeleton />
      ) : templates.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Megaphone01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No templates yet</EmptyTitle>
            <EmptyDescription>
              Write a birthday wish or a festival greeting — or let the marketing desk draft one in
              your company’s voice.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setDraft(draftFor())}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New template
          </Button>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <div
              key={template._id}
              role="button"
              tabIndex={0}
              onClick={() => setDraft(draftFor(template))}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setDraft(draftFor(template));
                }
              }}
              className="flex cursor-pointer flex-col gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{template.name}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Duplicate ${template.name}`}
                  title="Duplicate"
                  className="-my-1 text-muted-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDraft(copyDraftOf(template));
                  }}
                >
                  <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                </Button>
                <Badge variant="outline">{OCCASION_LABELS[template.occasion] ?? template.occasion}</Badge>
                {template.category && template.category !== "marketing" ? (
                  <Badge variant="outline">{CATEGORY_LABELS[template.category]}</Badge>
                ) : null}
                <Badge variant="secondary" className={templateStanding(template).className}>
                  {templateStanding(template).label}
                </Badge>
              </span>
              <WhatsAppPreview
                size="card"
                body={template.body}
                header={template.header}
                headerMedia={
                  template.headerMedia
                    ? { type: template.headerMedia.type, url: template.headerMediaUrl ?? undefined }
                    : undefined
                }
                footer={template.footer}
                buttons={template.buttons}
                business={workspace.name}
                occasion={template.occasion}
              />
              {template.metaStatus === "REJECTED" || template.metaStatus === "CHANGED" ? (
                <span className="text-xs font-medium text-destructive">{templateBlocker(template)}</span>
              ) : null}
              {template.metaTemplateName ? (
                <span className="mt-auto flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <HugeiconsIcon icon={WhatsappIcon} strokeWidth={2} className="size-3.5" />
                  {template.metaTemplateName} · {template.languageCode}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <TemplateDialog draft={draft} setDraft={setDraft} templates={templates} />
    </div>
  );
}
