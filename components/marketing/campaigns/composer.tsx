"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatMoney } from "@/convex/lib/billing";
import { renderTemplate, templateBlocker } from "@/convex/lib/marketing";
import {
  fillProblems,
  fillsFor,
  personalValues,
  type Person,
  type VariableFill,
} from "@/convex/lib/personalise";
import { recommendedPlan, type RolloutPlan } from "@/convex/lib/rollout";
import {
  HOURS,
  dayLabel,
  fail,
  hourLabel,
  templateOptionLabel,
  templateReady,
} from "@/components/marketing/format";
import { ConfirmButton } from "@/components/marketing/calendar";
import { TestSendButton } from "@/components/marketing/test-send";
import { WhatsAppPreview } from "@/components/marketing/whatsapp-preview";
import {
  PartialNote,
  ReachBreakdown,
  ReachValue,
  SmartReview,
  ValueSkeleton,
  reachRange,
  type Estimate,
} from "@/components/marketing/campaigns/smart-review";
import { VariableMapper } from "@/components/marketing/campaigns/variable-mapper";
import {
  AudiencePicker,
  EVERYONE,
  type AudienceChoice,
} from "@/components/marketing/audience/audience-picker";
import { plural, type Category } from "@/components/marketing/audience/shared";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";

type Template = Doc<"marketingTemplates"> & {
  metaBody: string;
  headerMediaUrl?: string | null;
};

export type CampaignMode = "manual" | "smart";

export type CampaignDraft = {
  mode: CampaignMode;
  plan: RolloutPlan;
  eventId?: Id<"marketingEvents">;
  title: string;
  templateId?: Id<"marketingTemplates">;
  message: string;
  variables: VariableFill[];
  audience: AudienceChoice;
  date: string;
  sendHour: number;
  ratePerMinute?: number;
  trackLinks: boolean;
  smartTiming: boolean;
  replyAgentId?: Id<"agents">;
  when: "now" | "later";
};

export function emptyCampaign(today: string, mode: CampaignMode = "manual"): CampaignDraft {
  return {
    mode,
    plan: recommendedPlan(),
    title: "",
    message: "",
    variables: [],
    audience: EVERYONE,
    date: today,
    sendHour: 10,
    trackLinks: true,
    smartTiming: false,
    when: "later",
  };
}

const SPEEDS = [
  { value: "0", label: "As fast as allowed" },
  { value: "300", label: "300 a minute" },
  { value: "100", label: "100 a minute" },
  { value: "30", label: "30 a minute" },
];

const SAMPLE_PERSON: Person = { name: "Asha Sharma" };

const FRONT_DESK = "front-desk";

/**
 * The live estimate, swapped for an exact count when the live one could only
 * count part of a big workspace.
 */
function useFullEstimate(args: {
  workspaceId: Id<"workspaces">;
  templateId?: Id<"marketingTemplates">;
  audience: AudienceChoice;
  now: number;
}): { estimate: Estimate | undefined; counting: boolean } {
  const quick = useQuery(api.marketingBroadcasts.estimate, args);
  const countAudience = useAction(api.marketingBroadcasts.countAudience);
  const [full, setFull] = useState<{ key: string; value: Estimate } | null>(null);
  const key = JSON.stringify(args);
  const partial = quick?.partial ?? false;

  useEffect(() => {
    if (!partial) return;
    let live = true;
    const timer = setTimeout(() => {
      countAudience(JSON.parse(key))
        .then((value) => {
          if (live) setFull({ key, value });
        })
        .catch(() => {});
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, partial, countAudience]);

  const exact = full?.key === key ? full.value : null;
  return { estimate: exact ?? quick, counting: partial && !exact };
}

function personName(person: Person) {
  return person.name?.trim() || (person.externalId ? `+${person.externalId}` : "a contact");
}

function Section({ step, title, children }: { step: number; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">
          {step}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Heading({ editing, smart }: { editing: boolean; smart: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">
        {editing ? "Edit" : "New"} {smart ? "smart campaign" : "campaign"}
      </h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {smart
          ? "Pick who gets it and what they read. Next you review the wave plan before anything is sent."
          : "One approved WhatsApp template, sent to the people you choose. Unsubscribed contacts are always left out."}
      </p>
    </div>
  );
}

const CHIP_WIDTHS = ["w-24", "w-32", "w-20", "w-28"];

export function CampaignComposerSkeleton({ mode }: { mode?: CampaignMode }) {
  const workspace = useWorkspace();
  const smart = mode === "smart";
  const fields = [
    { label: "Day", width: "w-full" },
    { label: `At (${workspace.timezone})`, width: "w-28" },
    { label: "Speed", width: "w-40" },
  ].slice(0, smart ? 2 : 3);
  const checkRow = (
    <div className="flex items-start gap-2">
      <Skeleton className="size-4 shrink-0 rounded-[4px]" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-36" />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-full max-w-xl" />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-2/3 max-w-sm" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5" aria-hidden>
      {mode ? (
        <Heading editing={false} smart={smart} />
      ) : (
        <div className="flex flex-col gap-1">
          <Skeleton className="my-1 h-5 w-52" />
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-[36rem] max-w-full" />
          </div>
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_296px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section step={1} title="Name it">
            <Skeleton className="h-8 w-full rounded-lg" />
          </Section>
          <Section step={2} title="Who gets it">
            <Skeleton className="h-8 w-64 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="my-0.5 h-3 w-28" />
              <div className="flex flex-wrap gap-1.5">
                {CHIP_WIDTHS.map((width) => (
                  <Skeleton key={width} className={`h-6.5 rounded-full ${width}`} />
                ))}
              </div>
            </div>
          </Section>
          <Section step={3} title="What they read">
            <Skeleton className="h-8 w-56 rounded-lg" />
            {checkRow}
          </Section>
          <Section
            step={4}
            title={mode ? (smart ? "When it starts" : "When it goes") : <Skeleton className="h-3.5 w-24" />}
          >
            <Skeleton className="h-8 w-44 rounded-lg" />
            <div className="grid gap-3 sm:grid-cols-3">
              {fields.map((field) => (
                <div key={field.label} className="flex flex-col gap-1.5">
                  <Label>{field.label}</Label>
                  <Skeleton className={`h-8 rounded-lg ${field.width}`} />
                </div>
              ))}
            </div>
            <div className="flex flex-col">
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-full max-w-xl" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-1/2 max-w-xs" />
              </div>
            </div>
            {smart ? null : checkRow}
          </Section>
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Before it goes</p>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Will receive it</dt>
                <dd>
                  <ValueSkeleton className="h-3.5 w-20" />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Left out</dt>
                <dd>
                  <ValueSkeleton className="h-3.5 w-40" />
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-4 flex flex-col gap-2">
            <p className="text-center text-xs font-medium text-muted-foreground">
              What a customer reads
            </p>
            <WhatsAppPreview body="" business={workspace.name} />
          </div>
        </aside>
      </div>
      <div className="sticky -bottom-4 z-20 -mx-4 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6">
        <Skeleton className="h-8 w-18 rounded-lg" />
        <Skeleton className="h-8 w-26 rounded-lg" />
      </div>
    </div>
  );
}

export function CampaignComposer({
  draft: initial,
  templates,
  categories,
  today,
  startInReview = false,
  onClose,
  onSaved,
}: {
  draft: CampaignDraft;
  templates: Template[];
  categories: Category[];
  today: string;
  startInReview?: boolean;
  onClose: () => void;
  onSaved: (eventId: Id<"marketingEvents">, sentNow: boolean) => void;
}) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const save = useMutation(api.marketingBroadcasts.save);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(startInReview && initial.mode === "smart");
  const [audienceValid, setAudienceValid] = useState(true);
  const [sample, setSample] = useState(0);
  const smart = draft.mode === "smart";
  const set = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const template = templates.find((t) => t._id === draft.templateId);
  const { estimate, counting } = useFullEstimate({
    workspaceId: workspace._id,
    templateId: draft.templateId,
    audience: draft.audience,
    now,
  });
  const people = useQuery(
    api.marketing.previewContacts,
    template && audienceValid ? { workspaceId: workspace._id, audience: draft.audience, now } : "skip"
  );
  const replyTargets = useQuery(api.agents.replyTargets, { workspaceId: workspace._id });
  const replyAgent = replyTargets?.find((agent) => agent._id === draft.replyAgentId);
  const replyAgentGone = Boolean(draft.replyAgentId && replyTargets && !replyAgent);
  const fills = template ? fillsFor(template.body, draft.variables, draft.message) : [];
  const blanks = template ? fillProblems(template.body, fills) : [];
  const blocker = template ? templateBlocker(template) : null;
  const person = people?.length ? people[sample % people.length] : SAMPLE_PERSON;
  const setFills = (next: VariableFill[]) =>
    set({
      variables: next,
      message: next.find((fill) => fill.variable === "message" && fill.source === "text")?.text ?? draft.message,
    });
  const range = estimate ? reachRange(estimate) : null;
  const short =
    estimate?.balanceMicros !== null &&
    estimate?.balanceMicros !== undefined &&
    (range?.maxCostMicros ?? 0) > estimate.balanceMicros;

  const sortedTemplates = [...templates].sort(
    (a, b) => Number(templateReady(b)) - Number(templateReady(a))
  );

  const submit = async (asDraft = false) => {
    if (!draft.templateId) return;
    setBusy(true);
    const now = draft.when === "now" && !asDraft;
    try {
      const eventId = await save({
        workspaceId: workspace._id,
        eventId: draft.eventId,
        title: draft.title,
        templateId: draft.templateId,
        message: draft.message,
        variables: fills,
        audience: draft.audience,
        date: draft.when === "now" ? today : draft.date,
        sendHour: draft.sendHour,
        ratePerMinute: smart ? undefined : draft.ratePerMinute,
        trackLinks: draft.trackLinks,
        smartTiming: smart ? undefined : draft.smartTiming,
        replyAgentId: draft.replyAgentId,
        rollout: smart ? draft.plan : undefined,
        draft: asDraft || undefined,
        sendNow: now,
      });
      toast.add({
        title: asDraft
          ? "Saved as a draft"
          : now
            ? smart
              ? "Smart campaign started"
              : "Sending now"
            : smart
              ? "Smart campaign scheduled"
              : "Campaign scheduled",
        description: asDraft
          ? "Open it from Campaigns to launch it."
          : now
            ? smart
              ? "It checks your number, then sends the first wave."
              : "Watch it go out in the report."
            : `${dayLabel(draft.date)} at ${hourLabel(draft.sendHour)}.`,
        type: "success",
      });
      onSaved(eventId, now);
    } catch (error) {
      fail("Could not save the campaign", error);
    } finally {
      setBusy(false);
    }
  };

  const cannotReview =
    busy ||
    !audienceValid ||
    !draft.title.trim() ||
    !draft.templateId ||
    blanks.length > 0;
  const cannotSubmit = cannotReview || (draft.when === "now" && Boolean(blocker));

  const money = (micros: number) =>
    estimate?.currency ? formatMoney(micros, estimate.currency) : null;

  const previewBody = () => {
    if (!template) return "";
    const values = personalValues(
      fills,
      {
        business: workspace.name,
        event: draft.title.trim() || "the day",
        date: dayLabel(draft.when === "now" ? today : draft.date),
        venue: "",
        message: "",
      },
      person
    );
    for (const key of Object.keys(values) as Array<keyof typeof values>) values[key] ||= "…";
    return renderTemplate(template.body, values).text;
  };

  const previewAs =
    template && fills.length > 0 ? (
      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        {people && people.length > 1 ? (
          <Button size="icon-sm" variant="ghost" aria-label="Previous contact" onClick={() => setSample((n) => n + people.length - 1)}>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
        ) : null}
        <span>
          {people?.length ? "As " : "Sample: "}
          <span className="font-medium text-foreground">{personName(person)}</span>
        </span>
        {people && people.length > 1 ? (
          <Button size="icon-sm" variant="ghost" aria-label="Next contact" onClick={() => setSample((n) => n + 1)}>
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
        ) : null}
      </div>
    ) : null;

  const preview = (size: "card" | "phone") => (
    <WhatsAppPreview
      size={size}
      className={size === "card" ? "lg:hidden" : undefined}
      body={previewBody()}
      header={template?.header}
      headerMedia={
        template?.headerMedia
          ? { type: template.headerMedia.type, url: template.headerMediaUrl ?? undefined }
          : undefined
      }
      footer={template?.footer}
      buttons={template?.buttons}
      business={workspace.name}
      occasion={template?.occasion}
    />
  );

  if (smart && reviewing) {
    return (
      <SmartReview
        draft={draft}
        fills={fills}
        template={template}
        replyTo={replyAgent?.name ?? "Front desk"}
        estimate={estimate}
        counting={counting}
        preview={
          <>
            {previewAs}
            {preview("phone")}
          </>
        }
        today={today}
        busy={busy}
        launchBlocked={cannotSubmit}
        onChange={set}
        onBack={() => setReviewing(false)}
        onSave={submit}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
        <Heading editing={Boolean(draft.eventId)} smart={smart} />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_296px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section step={1} title="Name it">
            <Input
              value={draft.title}
              maxLength={80}
              placeholder="Campaign name"
              onChange={(e) => set({ title: e.target.value })}
            />
          </Section>

          <Section step={2} title="Who gets it">
            <AudiencePicker
              value={draft.audience}
              categories={categories}
              onChange={(audience) => set({ audience })}
              onValidChange={setAudienceValid}
            />
          </Section>

          <Section step={3} title="What they read">
            <SelectField
              aria-label="Template"
              value={draft.templateId ?? ""}
              placeholder="Pick an approved template"
              onValueChange={(value) => set({ templateId: value as Id<"marketingTemplates"> })}
              options={sortedTemplates.map((t) => ({ value: t._id, label: templateOptionLabel(t) }))}
            />
            {blocker ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="size-3.5" /> {blocker}
              </p>
            ) : null}
            {template ? <VariableMapper body={template.body} fills={fills} onChange={setFills} /> : null}
            {template ? (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground lg:hidden">
                  What a customer reads
                </p>
                <div className="lg:hidden">{previewAs}</div>
                {preview("card")}
                <TestSendButton
                  templateId={template._id}
                  message={draft.message}
                  variables={fills}
                  disabledReason={blocker ?? blanks[0] ?? null}
                />
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={draft.trackLinks}
                onCheckedChange={(next) => set({ trackLinks: next === true })}
              />
              <span>
                Track link clicks
                <span className="block text-xs text-muted-foreground">
                  A link in the message is swapped for a short one per person, so clicks are
                  counted, and tagged for Google Analytics (utm_source=whatsapp).
                </span>
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <Label>Replies go to</Label>
              <SelectField
                aria-label="Replies go to"
                className="w-full sm:w-72"
                value={draft.replyAgentId ?? FRONT_DESK}
                onValueChange={(value) =>
                  set({ replyAgentId: value === FRONT_DESK ? undefined : (value as Id<"agents">) })
                }
                options={[
                  { value: FRONT_DESK, label: "Front desk" },
                  ...(replyTargets ?? []).map((agent) => ({ value: agent._id, label: agent.name })),
                  ...(replyAgentGone && draft.replyAgentId
                    ? [{ value: draft.replyAgentId, label: "An agent that is no longer available", disabled: true }]
                    : []),
                ]}
              />
              <p className={replyAgentGone ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {replyAgentGone
                  ? "That agent is paused or can no longer take conversations. Pick another, or the front desk."
                  : replyAgent
                    ? `${replyAgent.name} answers whoever replies — unless they wrote to you in the last day, or someone on your team is handling their chat.`
                    : "The front desk reads each reply and hands it to the agent it belongs to."}
              </p>
            </div>
          </Section>

          <Section step={4} title={smart ? "When it starts" : "When it goes"}>
            <ToggleGroup
              variant="outline"
              value={[draft.when]}
              onValueChange={(next) => next[0] && set({ when: next[0] as CampaignDraft["when"] })}
            >
              <ToggleGroupItem value="later">Schedule</ToggleGroupItem>
              <ToggleGroupItem value="now">{smart ? "Start now" : "Send now"}</ToggleGroupItem>
            </ToggleGroup>
            <div className="grid gap-3 sm:grid-cols-3">
              {draft.when === "later" ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="campaign-date">Day</Label>
                    <Input
                      id="campaign-date"
                      type="date"
                      min={today}
                      value={draft.date}
                      onChange={(e) => set({ date: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>At ({workspace.timezone})</Label>
                    <SelectField
                      aria-label="Hour"
                      value={String(draft.sendHour)}
                      onValueChange={(value) => set({ sendHour: Number(value) })}
                      options={HOURS}
                    />
                  </div>
                </>
              ) : null}
              {smart ? null : (
                <div className="flex flex-col gap-1.5">
                  <Label>Speed</Label>
                  <SelectField
                    aria-label="Speed"
                    value={String(draft.ratePerMinute ?? 0)}
                    onValueChange={(value) => set({ ratePerMinute: Number(value) || undefined })}
                    options={SPEEDS}
                  />
                </div>
              )}
            </div>
            {smart ? (
              <p className="text-xs text-muted-foreground">
                The first wave goes out then. Later waves go at the same hour on the days in the
                plan, each only after a health check. Smart sets the speed.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Sending slower spreads replies out so your team can keep up, and is gentler on a
                  new number&apos;s quality rating.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={draft.smartTiming}
                    onCheckedChange={(next) => set({ smartTiming: next === true })}
                  />
                  <span>
                    Send at each person&apos;s best time
                    <span className="block text-xs text-muted-foreground">
                      Goes out over the next 24 hours, each person at the hour they usually read
                      your messages. People without a habit yet get it at the time above.
                    </span>
                  </span>
                </label>
              </>
            )}
          </Section>

          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Before it goes</p>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Will receive it</dt>
                <dd className="font-medium tabular-nums">
                  {estimate ? <ReachValue estimate={estimate} /> : <ValueSkeleton className="h-3.5 w-20" />}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Left out</dt>
                <dd className="tabular-nums">
                  {estimate ? (
                    <>
                      {estimate.optedOut} unsubscribed · {estimate.overCap} over the limit
                    </>
                  ) : (
                    <ValueSkeleton className="h-3.5 w-40" />
                  )}
                </dd>
              </div>
              {estimate && range && money(estimate.costMicros) ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Estimated cost</dt>
                  <dd className="font-medium tabular-nums">
                    {range.upTo
                      ? `${money(estimate.costMicros)} – ${money(range.maxCostMicros)}`
                      : `${estimate.partial ? "At least " : ""}${money(estimate.costMicros)}`}
                  </dd>
                </div>
              ) : null}
              {estimate && estimate.balanceMicros !== null && money(estimate.balanceMicros) ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Wallet</dt>
                  <dd className={short ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>
                    {money(estimate.balanceMicros)}
                  </dd>
                </div>
              ) : null}
            </dl>
            {estimate ? (
              <ReachBreakdown
                estimate={estimate}
                filtered={draft.audience.excludeAudienceIds.length > 0 || Boolean(draft.audience.segments?.length)}
              />
            ) : null}
            {estimate ? <PartialNote estimate={estimate} counting={counting} /> : null}
            {short ? (
              <p className="text-xs text-destructive">
                The wallet {estimate?.partial ? "may not cover" : "does not cover"} everyone. Sending
                stops when it runs out — top up on the Billing page first.
              </p>
            ) : null}
            {estimate && estimate.reachable === 0 ? (
              <Badge variant="outline" className="w-fit">
                Nobody matches these choices yet
              </Badge>
            ) : null}
          </div>
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-4 flex flex-col gap-2">
            <p className="text-center text-xs font-medium text-muted-foreground">
              What a customer reads
            </p>
            {previewAs}
            {preview("phone")}
          </div>
        </aside>
        </div>
        {/* Sticky stops at the scroller's padding, so the bar reaches into it. */}
        <div className="sticky -bottom-4 z-20 -mx-4 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {smart ? (
            <Button onClick={() => setReviewing(true)} disabled={cannotReview}>
              Review plan <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
            </Button>
          ) : draft.when === "now" ? (
            <ConfirmButton
              disabled={cannotSubmit}
              heading="Send it now?"
              description={`${draft.title.trim() || "This campaign"} goes to ${
                estimate ? `${plural(estimate.reachable, "person", "people")}${estimate.partial ? " or more" : ""}` : "everyone you picked"
              } straight away. This cannot be undone.`}
              confirmLabel="Send now"
              onConfirm={submit}
            >
              {busy ? <Spinner /> : <HugeiconsIcon icon={SentIcon} strokeWidth={2} />} Send now
            </ConfirmButton>
          ) : (
            <Button onClick={() => void submit()} disabled={cannotSubmit}>
              {busy ? <Spinner /> : <HugeiconsIcon icon={SentIcon} strokeWidth={2} />} Schedule
            </Button>
          )}
        </div>
    </div>
  );
}
