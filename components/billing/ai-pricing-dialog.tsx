"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DEFAULT_AI_PRICING,
  aiPriceIn,
  aiReplyMicros,
  formatMoney,
  fromMicros,
  toMicros,
  type AiPricingCard,
} from "@/convex/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";

type Draft = {
  ramp: string;
  prices: Record<string, { first: string; cap: string }>;
};

const show = (micros: number | undefined) =>
  micros === undefined ? "0" : String(fromMicros(micros));

function draftOf(card: AiPricingCard, currencies: string[]): Draft {
  const prices: Draft["prices"] = {};
  for (const currency of currencies) {
    const price =
      aiPriceIn(card, currency) ?? aiPriceIn(DEFAULT_AI_PRICING, currency);
    prices[currency] = {
      first: show(price?.firstMicros),
      cap: show(price?.capMicros),
    };
  }
  return { ramp: String(card.rampReplies), prices };
}

const valid = (value: string) => value.trim() !== "" && Number(value) >= 0;
const validRamp = (value: string) =>
  Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10_000;

/**
 * Edit what an agent's reply costs: the price of the first reply in a
 * conversation, the full price, and the reply that reaches it. With a
 * workspace, that account's own prices; without one, the default.
 */
export function AiPricingDialog({
  workspaceId,
  workspaceName,
  current,
  fallback,
  currencies,
  currency: shown,
  trigger,
}: {
  workspaceId?: Id<"workspaces">;
  workspaceName?: string;
  current: AiPricingCard | null;
  fallback: AiPricingCard;
  currencies: string[];
  currency?: string;
  trigger: React.ReactElement;
}) {
  const setAiPricing = useMutation(api.billing.setAiPricing);
  const clearAiPricing = useMutation(api.billing.clearAiPricing);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const base = current ?? fallback;
  const known = [
    ...new Set([
      ...currencies,
      ...(shown ? [shown] : []),
      ...base.byCurrency.map((entry) => entry.currency),
    ]),
  ];
  const columns = shown ? [shown] : known;
  const [draft, setDraft] = useState<Draft>(() => draftOf(base, known));

  const custom = Boolean(workspaceId && current);
  const entry = (currency: string) =>
    draft.prices[currency] ?? { first: "", cap: "" };
  const setPrice = (currency: string, key: "first" | "cap", value: string) =>
    setDraft((prev) => ({
      ...prev,
      prices: {
        ...prev.prices,
        [currency]: { ...(prev.prices[currency] ?? { first: "", cap: "" }), [key]: value },
      },
    }));

  const rampOk = validRamp(draft.ramp);
  const pricesOk = columns.every((currency) => {
    const price = entry(currency);
    return (
      valid(price.first) &&
      valid(price.cap) &&
      Number(price.first) <= Number(price.cap)
    );
  });
  const invalid = !rampOk || !pricesOk;

  const save = async () => {
    if (invalid) return;
    setBusy("save");
    try {
      await setAiPricing({
        workspaceId,
        rampReplies: Number(draft.ramp),
        byCurrency: known.map((currency) => ({
          currency,
          first: Number(entry(currency).first),
          cap: Number(entry(currency).cap),
        })),
      });
      toast.add({
        title: workspaceName
          ? `AI prices saved for ${workspaceName}`
          : "Default AI prices saved",
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not save the AI prices",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const resetToDefault = async () => {
    if (!workspaceId) return;
    setBusy("clear");
    try {
      await clearAiPricing({ workspaceId });
      toast.add({
        title: `${workspaceName ?? "This account"} is back on the default AI prices`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not reset the AI prices",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const preview = (currency: string) => {
    const price = entry(currency);
    if (!rampOk || !valid(price.first) || !valid(price.cap)) return null;
    const ramp = Number(draft.ramp);
    const card = {
      firstMicros: toMicros(Number(price.first)),
      capMicros: toMicros(Number(price.cap)),
      rampReplies: ramp,
    };
    const middle = Math.max(1, Math.round(ramp / 2));
    const money = (micros: number) => formatMoney(micros, currency);
    return [
      `#1 ${money(aiReplyMicros(card, 1))}`,
      ...(middle > 1 && middle < ramp
        ? [`#${middle} ${money(aiReplyMicros(card, middle))}`]
        : []),
      `#${ramp}+ ${money(card.capMicros)}`,
    ].join(" · ");
  };

  const box = (currency: string, key: "first" | "cap", label: string) => (
    <div className="relative">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={entry(currency)[key]}
        aria-label={label}
        aria-invalid={!valid(entry(currency)[key]) || undefined}
        className="pr-11 text-right tabular-nums"
        onChange={(event) => setPrice(currency, key, event.target.value)}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
        {currency}
      </span>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(draftOf(current ?? fallback, known));
        setOpen(next);
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {workspaceName ? `AI prices for ${workspaceName}` : "Default AI prices"}
            {shown ? ` · ${shown}` : ""}
          </DialogTitle>
          <DialogDescription>
            Charged on every agent reply, on any channel. The first reply in a
            conversation costs the first price, and each one after costs a little
            more until the full price. On WhatsApp the message charge is added on
            top. Applies to replies from now on.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="ai-ramp" className="min-w-0">
              Full price from reply
            </Label>
            <Input
              id="ai-ramp"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={draft.ramp}
              aria-invalid={!rampOk || undefined}
              className="w-28 text-right tabular-nums"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, ramp: event.target.value }))
              }
            />
          </div>

          {columns.map((currency) => (
            <div key={currency} className="flex flex-col gap-2 border-t pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">First reply</span>
                  {box(currency, "first", `First reply price in ${currency}`)}
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Full price</span>
                  {box(currency, "cap", `Full price in ${currency}`)}
                </div>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {preview(currency) ?? "—"}
              </p>
            </div>
          ))}
        </div>

        {invalid ? (
          <p className="text-xs text-destructive">
            {rampOk
              ? "Every price needs a number, zero or more, and the first reply cannot cost more than the full price."
              : "The full price must start at a whole reply between 1 and 10,000."}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          {custom ? (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void resetToDefault()}
            >
              {busy === "clear" ? <Spinner /> : null} Use default prices
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy !== null || invalid}
              onClick={() => void save()}
            >
              {busy === "save" ? <Spinner /> : null} Save prices
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
