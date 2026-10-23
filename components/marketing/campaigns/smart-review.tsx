"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { formatMoney } from "@/convex/lib/billing";
import { templateBlocker } from "@/convex/lib/marketing";
import {
  ASSUMED_LIMIT,
  LIMIT_TIERS,
  dailyLimit,
  isRecommended,
  limitLabel,
  planWaves,
  recommendedPlan,
  validPlan,
} from "@/convex/lib/rollout";
import { WaveFields } from "@/components/marketing/campaigns/wave-plan";
import type { VariableFill } from "@/convex/lib/personalise";
import type { CampaignDraft } from "@/components/marketing/campaigns/composer";
import { fillLabel } from "@/components/marketing/campaigns/variable-mapper";
import { HOURS, QUALITY, dayLabel, hourLabel, shortDayLabel } from "@/components/marketing/format";
import { ConfirmButton } from "@/components/marketing/calendar";
import { plural } from "@/components/marketing/audience/shared";
import { useWorkspace } from "@/components/workspace-provider";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowLeft02Icon,
  FloppyDiskIcon,
  RefreshIcon,
  Rocket01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

export type Estimate = FunctionReturnType<typeof api.marketingBroadcasts.estimate>;

/** When the count is partial, the ceiling the chosen lists put on it, and the cost at that ceiling. */
export function reachRange(estimate: Estimate) {
  const upTo = estimate.partial && estimate.upTo && estimate.upTo > estimate.reachable ? estimate.upTo : null;
  const perPerson = estimate.reachable > 0 ? estimate.costMicros / estimate.reachable : 0;
  return { upTo, maxCostMicros: upTo ? Math.round(perPerson * upTo) : estimate.costMicros };
}

export function ReachValue({ estimate }: { estimate: Estimate }) {
  const { upTo } = reachRange(estimate);
  if (upTo) {
    return (
      <>
        {estimate.reachable.toLocaleString()} – {plural(upTo, "person", "people")}
      </>
    );
  }
  return (
    <>
      {estimate.partial ? "At least " : ""}
      {plural(estimate.reachable, "person", "people")}
    </>
  );
}

/** Where the people the choices match went, from the lists' size down to who is sent it. */
export function ReachBreakdown({ estimate, filtered }: { estimate: Estimate; filtered: boolean }) {
  if (estimate.partial) return null;
  const fromLists = estimate.listTotal !== null && estimate.listTotal >= estimate.matched;
  const start = fromLists && estimate.listTotal !== null ? estimate.listTotal : estimate.matched;
  const repeats = start - estimate.matched;
  const parts = [
    repeats > 0
      ? `${repeats.toLocaleString()} ${filtered ? "on more than one list or left out by your filters" : "on more than one list"}`
      : null,
    estimate.notWhatsApp > 0 ? `${estimate.notWhatsApp.toLocaleString()} not on WhatsApp` : null,
    estimate.optedOut > 0 ? `${estimate.optedOut.toLocaleString()} unsubscribed` : null,
    estimate.overCap > 0 ? `${estimate.overCap.toLocaleString()} over the weekly limit` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {start.toLocaleString()} {fromLists ? "on your lists" : "match your choices"} → {parts.join(" · ")} →{" "}
      {plural(estimate.reachable, "person", "people")} will receive it.
    </p>
  );
}

export function PartialNote({ estimate, counting }: { estimate: Estimate; counting: boolean }) {
  if (!estimate.partial) return null;
  if (counting) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" /> Counting everyone in this workspace — the exact number shows in a moment.
      </p>
    );
  }
  const { upTo } = reachRange(estimate);
  return (
    <p className="text-xs text-muted-foreground">
      {estimate.partialBecause === "cap"
        ? `The weekly limit is only checked for the first ${estimate.capLimit.toLocaleString()} people here, so the count is partial.`
        : `Only the first ${estimate.scanLimit.toLocaleString()} contacts in this workspace are counted here, so the count is partial.`}{" "}
      The campaign still goes to everyone who matches.
      {upTo
        ? ` Your lists hold ${upTo.toLocaleString()} people between them — fewer once anyone on more than one list is counted once, and unsubscribed people are left out.`
        : ""}
    </p>
  );
}

const SAFETY_RULES = [
  "Checks your number's quality and daily limit before every wave.",
  "Pauses if quality turns red, Meta reports spam, or the template is paused.",
  "Waits 48 hours and halves the next wave if quality turns yellow.",
  "Holds a day if more than 1.5% unsubscribe, and pauses at 3%.",
  "Never uses more than 80% of your daily limit, counting your other messages.",
  "Sends each wave slowly over about two hours, so problems show early.",
];

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

export function ValueSkeleton({ className }: { className: string }) {
  return (
    <div className="flex h-5 items-center justify-end" aria-hidden>
      <Skeleton className={className} />
    </div>
  );
}

export function SmartReview({
  draft,
  fills,
  template,
  replyTo,
  estimate,
  counting,
  preview,
  today,
  busy,
  launchBlocked,
  onChange,
  onBack,
  onSave,
}: {
  draft: CampaignDraft;
  fills: VariableFill[];
  template: Doc<"marketingTemplates"> | undefined;
  replyTo: string;
  estimate: Estimate | undefined;
  counting: boolean;
  preview: ReactNode;
  today: string;
  busy: boolean;
  launchBlocked: boolean;
  onChange: (patch: Partial<CampaignDraft>) => void;
  onBack: () => void;
  onSave: (asDraft?: boolean) => Promise<void>;
}) {
  const workspace = useWorkspace();
  const now = useHourBucket();
  const health = useQuery(api.marketingRollout.health, { workspaceId: workspace._id, now });
  const refresh = useAction(api.marketingRollout.refreshHealth);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      await refresh({ workspaceId: workspace._id });
    } catch {
      // Unreadable health leaves the limit picked here in charge.
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    refresh({ workspaceId: workspace._id }).catch(() => undefined);
  }, [refresh, workspace._id]);

  const plan = draft.plan;
  const setPlan = (patch: Partial<CampaignDraft["plan"]>) => onChange({ plan: { ...plan, ...patch } });

  const knownTier = health?.limitTier ?? null;
  const tier = knownTier ?? plan.limitTier ?? null;
  const limit = dailyLimit(tier);
  const startDate = draft.when === "now" ? today : draft.date;
  const reachable = estimate?.reachable ?? 0;
  const schedule = planWaves({
    reachable,
    shares: plan.shares,
    gapDays: plan.gapDays,
    limit,
    used24h: health?.used24h ?? 0,
    startDate,
  });
  const problem = validPlan(plan);
  const capped = schedule.waves.some((wave) => wave.capped);
  const perPerson = estimate && estimate.reachable > 0 ? estimate.costMicros / estimate.reachable : 0;
  const money = (micros: number) => (estimate?.currency ? formatMoney(micros, estimate.currency) : null);
  const blocker = template ? templateBlocker(template) : null;
  const range = estimate ? reachRange(estimate) : null;
  const short =
    estimate?.balanceMicros !== null &&
    estimate?.balanceMicros !== undefined &&
    (range?.maxCostMicros ?? 0) > estimate.balanceMicros;
  const first = schedule.waves[0];
  const startLabel =
    draft.when === "now" ? "now" : `${dayLabel(draft.date)} at ${hourLabel(draft.sendHour)}`;
  const quality = QUALITY[health?.quality ?? "UNKNOWN"];
  const recommended = isRecommended(plan);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Review smart campaign</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Check the plan and change anything you like. Nothing is sent until you launch.
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_296px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Campaign">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Row label="Name">{draft.title}</Row>
              <Row label="Template">{template?.name ?? "—"}</Row>
              <Row label="Replies go to">{replyTo}</Row>
              {fills.length > 0 ? (
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <dt className="text-muted-foreground">Blanks</dt>
                  <dd className="text-right">
                    {fills.map((fill, index) => `{{${index + 1}}} ${fillLabel(fill)}`).join(" · ")}
                  </dd>
                </div>
              ) : null}
              <Row label="Will receive it">
                {estimate ? <ReachValue estimate={estimate} /> : <ValueSkeleton className="h-3.5 w-20" />}
              </Row>
              <Row label="Left out">
                {estimate ? (
                  <>
                    {estimate.optedOut} unsubscribed · {estimate.overCap} over the limit
                  </>
                ) : (
                  <ValueSkeleton className="h-3.5 w-40" />
                )}
              </Row>
              {estimate && range && money(estimate.costMicros) ? (
                <Row label="Estimated cost">
                  {range.upTo
                    ? `${money(estimate.costMicros)} – ${money(range.maxCostMicros)}`
                    : `${estimate.partial ? "At least " : ""}${money(estimate.costMicros)}`}
                </Row>
              ) : null}
              {estimate && estimate.balanceMicros !== null && money(estimate.balanceMicros) ? (
                <Row label="Wallet">
                  <span className={short ? "text-destructive" : undefined}>{money(estimate.balanceMicros)}</span>
                </Row>
              ) : null}
            </dl>
            {estimate ? (
              <ReachBreakdown
                estimate={estimate}
                filtered={draft.audience.excludeAudienceIds.length > 0 || Boolean(draft.audience.segments?.length)}
              />
            ) : null}
            {estimate ? <PartialNote estimate={estimate} counting={counting} /> : null}
            {blocker ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="size-3.5" /> {blocker}
              </p>
            ) : null}
            {short ? (
              <p className="text-xs text-destructive">
                The wallet {estimate?.partial ? "may not cover" : "does not cover"} everyone. Waves stop
                when it runs out — top up on the Billing page first.
              </p>
            ) : null}
          </Panel>

          <Panel
            title="Your WhatsApp number"
            action={
              <Button size="sm" variant="ghost" disabled={checking} onClick={() => void check()}>
                {checking ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />} Check again
              </Button>
            }
          >
            {health === null ? (
              <p className="text-sm text-destructive">
                There is no active WhatsApp channel to send from. Connect one first.
              </p>
            ) : (
              <>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <Row label="Quality">
                    {health ? (
                      <span className={cn("rounded-md px-1.5 py-0.5 text-xs", quality.className)}>{quality.label}</span>
                    ) : (
                      <ValueSkeleton className="h-5 w-14" />
                    )}
                  </Row>
                  <Row label="Daily limit">
                    {health ? (knownTier ? limitLabel(knownTier) : "Not known") : <ValueSkeleton className="h-3.5 w-24" />}
                  </Row>
                  <Row label="Sent in the last 24 hours">
                    {health ? health.used24h.toLocaleString() : <ValueSkeleton className="h-3.5 w-10" />}
                  </Row>
                  <Row label="Checked">
                    {health ? (
                      health.checkedAt
                        ? new Date(health.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                        : "—"
                    ) : (
                      <ValueSkeleton className="h-3.5 w-16" />
                    )}
                  </Row>
                </dl>
                {health?.quality === "RED" ? (
                  <p className="text-xs font-medium text-destructive">
                    Quality is red. The campaign will pause before the first wave until it recovers.
                  </p>
                ) : health?.quality === "YELLOW" ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Quality is yellow. The first wave waits 48 hours and goes out at half size.
                  </p>
                ) : null}
                {health?.alert ? <p className="text-xs text-muted-foreground">Meta: {health.alert}</p> : null}
                {!health || knownTier ? null : (
                  <div className="flex flex-col gap-1.5">
                    <Label>Your daily limit</Label>
                    <SelectField
                      aria-label="Daily limit"
                      value={plan.limitTier ?? ""}
                      placeholder={`Not sure — assume ${ASSUMED_LIMIT.toLocaleString()} a day`}
                      onValueChange={(value) => setPlan({ limitTier: value || undefined })}
                      options={LIMIT_TIERS.map((option) => ({ value: option.value, label: option.label }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Meta did not tell us your limit. Pick the one WhatsApp Manager shows under
                      Account tools → Messaging limits.
                    </p>
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel
            title="Rollout plan"
            action={
              recommended ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ plan: { ...recommendedPlan(), limitTier: plan.limitTier } })}
                >
                  Reset to recommended
                </Button>
              )
            }
          >
            <WaveFields
              plan={plan}
              onChange={setPlan}
              aside={
                <div className="flex flex-col gap-1.5">
                  <Label>Send hour ({workspace.timezone})</Label>
                  <SelectField
                    aria-label="Send hour"
                    value={String(draft.sendHour)}
                    onValueChange={(value) => onChange({ sendHour: Number(value) })}
                    options={HOURS}
                  />
                </div>
              }
            />

            {estimate && reachable === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody matches this audience yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Wave</TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">People</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Cost</TableHead>
                      <TableHead className="hidden md:table-cell">Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {estimate === undefined ? plan.shares.map((_, index) => (
                      <TableRow key={index} className="hover:bg-transparent" aria-hidden>
                        <TableCell>
                          <Skeleton className="h-3.5 w-3" />
                        </TableCell>
                        <TableCell>
                          <div className="flex h-5 items-center">
                            <Skeleton className="h-3.5 w-20" />
                          </div>
                          <div className="flex h-4 items-center">
                            <Skeleton className="h-3 w-12" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className="ml-auto h-3.5 w-10" />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Skeleton className="ml-auto h-3.5 w-14" />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {index === 0 ? <Skeleton className="h-3 w-28" /> : null}
                        </TableCell>
                      </TableRow>
                    )) : schedule.waves.map((wave, index) => (
                      <TableRow key={wave.wave}>
                        <TableCell className="font-medium">{wave.wave}</TableCell>
                        <TableCell>
                          {shortDayLabel(wave.date)}
                          <span className="block text-xs text-muted-foreground">
                            {index === 0 && draft.when === "now" ? "right after the check" : hourLabel(draft.sendHour)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{wave.size.toLocaleString()}</TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {money(perPerson * wave.size) ?? "—"}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                          {wave.continued
                            ? "Rest of the last wave, held back by the daily limit"
                            : index === 0 && plan.engagedFirst
                              ? "Most engaged first"
                              : index === schedule.waves.length - 1
                                ? "Everyone left"
                                : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {reachable > 0 ? (
              <p className="text-xs text-muted-foreground">
                {plural(schedule.waves.length, "wave", "waves")} over{" "}
                {plural(schedule.days, "day", "days")}, if every check passes. A wave waits when a check
                fails, so the real dates can move later.
                {estimate?.partial
                  ? " Counted from your first contacts; the full list is made when it starts."
                  : ""}
              </p>
            ) : null}
            {capped ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} className="mt-0.5 size-3.5 shrink-0" />
                Some waves are over your safe daily limit of{" "}
                {Number.isFinite(schedule.safeDaily) ? schedule.safeDaily.toLocaleString() : "—"}, so the extra
                goes out the next day.
              </p>
            ) : null}
          </Panel>

          <Panel title="Safety checks">
            <ul className="flex flex-col gap-1.5 text-sm">
              {SAFETY_RULES.map((rule) => (
                <li key={rule} className="flex items-start gap-2">
                  <HugeiconsIcon icon={SecurityCheckIcon} strokeWidth={2} className="mt-0.5 size-4 shrink-0 text-primary" />
                  {rule}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              These always apply. You get a notification whenever a wave goes out, holds or pauses.
            </p>
          </Panel>
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-4 flex flex-col gap-2">
            <p className="text-center text-xs font-medium text-muted-foreground">What a customer reads</p>
            {preview}
          </div>
        </aside>
      </div>
      <div className="sticky -bottom-4 z-20 -mx-4 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} /> Back to edit
        </Button>
        <Button variant="outline" onClick={() => void onSave(true)} disabled={busy || Boolean(problem)}>
          <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} /> Save as draft
        </Button>
        <ConfirmButton
          disabled={busy || launchBlocked || Boolean(problem) || reachable === 0 || health === null}
          heading="Launch this smart campaign?"
          description={`${first ? `Wave 1 goes to about ${plural(first.size, "person", "people")}` : "Wave 1 goes out"} ${
            draft.when === "now" ? "once the first health check passes" : startLabel
          }, and the rest follow the plan.${
            money(estimate?.costMicros ?? 0) ? ` About ${money(estimate?.costMicros ?? 0)} in total.` : ""
          } You can pause or stop it at any time.`}
          confirmLabel="Launch"
          onConfirm={() => onSave(false)}
        >
          {busy ? <Spinner /> : <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} />} Launch smart campaign
        </ConfirmButton>
      </div>
    </div>
  );
}
