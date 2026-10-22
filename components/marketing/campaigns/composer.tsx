"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
import { SmartReview } from "@/components/marketing/campaigns/smart-review";
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
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "@/components/ui/toast";
import {
  ArrowRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PaperPlaneTiltIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

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

function personName(person: Person) {
  return person.name?.trim() || (person.externalId ? `+${person.externalId}` : "a contact");
}

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
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
  const estimate = useQuery(api.marketingBroadcasts.estimate, {
    workspaceId: workspace._id,
    templateId: draft.templateId,
    audience: draft.audience,
    now,
  });
  const people = useQuery(
    api.marketing.previewContacts,
    template && audienceValid ? { workspaceId: workspace._id, audience: draft.audience, now } : "skip"
  );
  const fills = template ? fillsFor(template.body, draft.variables, draft.message) : [];
  const blanks = template ? fillProblems(template.body, fills) : [];
  const blocker = template ? templateBlocker(template) : null;
  const person = people?.length ? people[sample % people.length] : SAMPLE_PERSON;
  const setFills = (next: VariableFill[]) =>
    set({
      variables: next,
      message: next.find((fill) => fill.variable === "message" && fill.source === "text")?.text ?? draft.message,
    });
  const short =
    estimate?.balanceMicros !== null &&
    estimate?.balanceMicros !== undefined &&
    estimate.costMicros > estimate.balanceMicros;

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
            <CaretLeftIcon />
          </Button>
        ) : null}
        <span>
          {people?.length ? "As " : "Sample: "}
          <span className="font-medium text-foreground">{personName(person)}</span>
        </span>
        {people && people.length > 1 ? (
          <Button size="icon-sm" variant="ghost" aria-label="Next contact" onClick={() => setSample((n) => n + 1)}>
            <CaretRightIcon />
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
        estimate={estimate}
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
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {draft.eventId ? "Edit" : "New"} {smart ? "smart campaign" : "campaign"}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {smart
              ? "Pick who gets it and what they read. Next you review the wave plan before anything is sent."
              : "One approved WhatsApp template, sent to the people you choose. Unsubscribed contacts are always left out."}
          </p>
        </div>
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
                <WarningCircleIcon className="size-3.5" /> {blocker}
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
            {estimate === undefined ? (
              <Spinner />
            ) : (
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Will receive it</dt>
                  <dd className="font-medium tabular-nums">
                    {plural(estimate.reachable, "person", "people")}
                    {estimate.partial ? "+" : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Left out</dt>
                  <dd className="tabular-nums">
                    {estimate.optedOut} unsubscribed · {estimate.overCap} over the limit
                  </dd>
                </div>
                {money(estimate.costMicros) ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Estimated cost</dt>
                    <dd className="font-medium tabular-nums">{money(estimate.costMicros)}</dd>
                  </div>
                ) : null}
                {estimate.balanceMicros !== null && money(estimate.balanceMicros) ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Wallet</dt>
                    <dd className={short ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>
                      {money(estimate.balanceMicros)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
            {short ? (
              <p className="text-xs text-destructive">
                The wallet does not cover everyone. Sending stops when it runs out — top up on the
                Billing page first.
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
              Review plan <ArrowRightIcon />
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
              {busy ? <Spinner /> : <PaperPlaneTiltIcon />} Send now
            </ConfirmButton>
          ) : (
            <Button onClick={() => void submit()} disabled={cannotSubmit}>
              {busy ? <Spinner /> : <PaperPlaneTiltIcon />} Schedule
            </Button>
          )}
        </div>
    </div>
  );
}
