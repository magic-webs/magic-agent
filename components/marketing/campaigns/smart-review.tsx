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
  GAP_DAYS,
  LIMIT_TIERS,
  MAX_WAVES,
  RECOMMENDED_SHARES,
  dailyLimit,
  limitLabel,
  planWaves,
  recommendedPlan,
  validPlan,
} from "@/convex/lib/rollout";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  FloppyDiskIcon,
  PlusIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

type Estimate = FunctionReturnType<typeof api.marketingBroadcasts.estimate>;

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

export function SmartReview({
  draft,
  fills,
  template,
  estimate,
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
  estimate: Estimate | undefined;
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
  const setShare = (index: number, value: number) =>
    setPlan({ shares: plan.shares.map((share, i) => (i === index ? value : share)) });

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
  const total = plan.shares.reduce((sum, share) => sum + share, 0);
  const blocker = template ? templateBlocker(template) : null;
  const short =
    estimate?.balanceMicros !== null &&
    estimate?.balanceMicros !== undefined &&
    estimate.costMicros > estimate.balanceMicros;
  const first = schedule.waves[0];
  const startLabel =
    draft.when === "now" ? "now" : `${dayLabel(draft.date)} at ${hourLabel(draft.sendHour)}`;
  const quality = QUALITY[health?.quality ?? "UNKNOWN"];
  const recommended =
    plan.gapDays === 1 &&
    plan.engagedFirst &&
    plan.shares.join() === RECOMMENDED_SHARES.join();

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
            {estimate === undefined ? (
              <Spinner />
            ) : (
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Row label="Name">{draft.title}</Row>
                <Row label="Template">{template?.name ?? "—"}</Row>
                {fills.length > 0 ? (
                  <div className="flex justify-between gap-3 sm:col-span-2">
                    <dt className="text-muted-foreground">Blanks</dt>
                    <dd className="text-right">
                      {fills.map((fill, index) => `{{${index + 1}}} ${fillLabel(fill)}`).join(" · ")}
                    </dd>
                  </div>
                ) : null}
                <Row label="Will receive it">
                  {plural(estimate.reachable, "person", "people")}
                  {estimate.partial ? "+" : ""}
                </Row>
                <Row label="Left out">
                  {estimate.optedOut} unsubscribed · {estimate.overCap} over the limit
                </Row>
                {money(estimate.costMicros) ? <Row label="Estimated cost">{money(estimate.costMicros)}</Row> : null}
                {estimate.balanceMicros !== null && money(estimate.balanceMicros) ? (
                  <Row label="Wallet">
                    <span className={short ? "text-destructive" : undefined}>{money(estimate.balanceMicros)}</span>
                  </Row>
                ) : null}
              </dl>
            )}
            {blocker ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <WarningCircleIcon className="size-3.5" /> {blocker}
              </p>
            ) : null}
            {short ? (
              <p className="text-xs text-destructive">
                The wallet does not cover everyone. Waves stop when it runs out — top up on the Billing
                page first.
              </p>
            ) : null}
          </Panel>

          <Panel
            title="Your WhatsApp number"
            action={
              <Button size="sm" variant="ghost" disabled={checking} onClick={() => void check()}>
                {checking ? <Spinner /> : <ArrowsClockwiseIcon />} Check again
              </Button>
            }
          >
            {health === undefined ? (
              <Spinner />
            ) : health === null ? (
              <p className="text-sm text-destructive">
                There is no active WhatsApp channel to send from. Connect one first.
              </p>
            ) : (
              <>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <Row label="Quality">
                    <span className={cn("rounded-md px-1.5 py-0.5 text-xs", quality.className)}>{quality.label}</span>
                  </Row>
                  <Row label="Daily limit">{knownTier ? limitLabel(knownTier) : "Not known"}</Row>
                  <Row label="Sent in the last 24 hours">{health.used24h.toLocaleString()}</Row>
                  <Row label="Checked">
                    {health.checkedAt
                      ? new Date(health.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                      : "—"}
                  </Row>
                </dl>
                {health.quality === "RED" ? (
                  <p className="text-xs font-medium text-destructive">
                    Quality is red. The campaign will pause before the first wave until it recovers.
                  </p>
                ) : health.quality === "YELLOW" ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Quality is yellow. The first wave waits 48 hours and goes out at half size.
                  </p>
                ) : null}
                {health.alert ? <p className="text-xs text-muted-foreground">Meta: {health.alert}</p> : null}
                {knownTier ? null : (
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
            <div className="flex flex-col gap-2">
              <Label>Wave sizes</Label>
              <div className="flex flex-wrap items-center gap-2">
                {plan.shares.map((share, index) => (
                  <div key={index} className="flex items-center gap-1 rounded-lg border border-border py-1 pr-1 pl-2">
                    <span className="text-xs text-muted-foreground">Wave {index + 1}</span>
                    <Input
                      aria-label={`Wave ${index + 1} percentage`}
                      type="number"
                      min={1}
                      max={100}
                      value={Number.isFinite(share) ? share : ""}
                      onChange={(e) => setShare(index, Math.round(Number(e.target.value)))}
                      className="h-7 w-16 text-right tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                    {plan.shares.length > 1 ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove wave ${index + 1}`}
                        onClick={() => setPlan({ shares: plan.shares.filter((_, i) => i !== index) })}
                      >
                        <TrashIcon />
                      </Button>
                    ) : null}
                  </div>
                ))}
                {plan.shares.length < MAX_WAVES ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPlan({ shares: [...plan.shares, Math.max(1, 100 - total)] })}
                  >
                    <PlusIcon /> Add wave
                  </Button>
                ) : null}
              </div>
              <p className={cn("text-xs", total === 100 ? "text-muted-foreground" : "font-medium text-destructive")}>
                {total === 100 ? "Adds up to 100%." : (problem ?? `Adds up to ${total}%.`)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Days between waves</Label>
                <SelectField
                  aria-label="Days between waves"
                  value={String(plan.gapDays)}
                  onValueChange={(value) => setPlan({ gapDays: Number(value) })}
                  options={GAP_DAYS.map((days) => ({
                    value: String(days),
                    label: days === 1 ? "Every day" : `Every ${days} days`,
                  }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Send hour ({workspace.timezone})</Label>
                <SelectField
                  aria-label="Send hour"
                  value={String(draft.sendHour)}
                  onValueChange={(value) => onChange({ sendHour: Number(value) })}
                  options={HOURS}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={plan.engagedFirst}
                onCheckedChange={(next) => setPlan({ engagedFirst: next === true })}
              />
              <span>
                Most engaged contacts first
                <span className="block text-xs text-muted-foreground">
                  People who replied, ordered or read recently go in the early waves. Their good
                  response keeps your quality high for the colder contacts later.
                </span>
              </span>
            </label>

            {reachable === 0 ? (
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
                    {schedule.waves.map((wave, index) => (
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
                <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
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
                  <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
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
          <ArrowLeftIcon /> Back to edit
        </Button>
        <Button variant="outline" onClick={() => void onSave(true)} disabled={busy || Boolean(problem)}>
          <FloppyDiskIcon /> Save as draft
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
          {busy ? <Spinner /> : <RocketLaunchIcon />} Launch smart campaign
        </ConfirmButton>
      </div>
    </div>
  );
}
