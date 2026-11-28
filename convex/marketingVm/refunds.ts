import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../functions";
import { refund } from "../lib/charge";
import { signature } from "../marketingSync";

const FAILED_PAGE = 500;
const CHARGE_PAGE = 2_000;
const BEFORE_MS = 60_000;
const AFTER_MS = 2 * 60 * 60 * 1000;

type FailedSend = {
  id: string;
  workspaceId: string;
  to: string;
  wamid: string | null;
  templateName: string | null;
  createdAt: number;
};

type Candidate = {
  id: Id<"billingEvents">;
  to: string;
  wamid: string | null;
  templateName: string | null;
  createdAt: number;
  currency: string;
  amountMicros: number;
};

const digits = (value: string) => value.replace(/\D/g, "");

async function failedSends(): Promise<FailedSend[]> {
  const url = process.env.MARKETING_SERVICE_URL;
  const secret = process.env.MARKETING_SERVICE_SECRET;
  if (!url || !secret) throw new Error("The marketing service is not configured.");
  const rows: FailedSend[] = [];
  let after: string | null = null;
  do {
    const body = JSON.stringify({ after, limit: FAILED_PAGE });
    const res = await fetch(`${url}/internal/billing/failed-sends`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": await signature(secret, body) },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Marketing service answered HTTP ${res.status}`);
    const page = (await res.json()) as { rows: FailedSend[]; next: string | null };
    rows.push(...page.rows);
    after = page.next;
  } while (after);
  return rows;
}

export const campaignCharges = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    from: v.number(),
    to: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("billingEvents")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId).gte("createdAt", args.from).lte("createdAt", args.to)
      )
      .paginate({ numItems: CHARGE_PAGE, cursor: args.cursor });
    const candidates: Candidate[] = page.page
      .filter((row) => row.source === "campaign" && row.status !== "refunded" && row.status !== undefined)
      .map((row) => ({
        id: row._id,
        to: digits(row.to),
        wamid: row.wamid ?? null,
        templateName: row.templateName ?? null,
        createdAt: row.createdAt,
        currency: row.currency,
        amountMicros: row.amountMicros,
      }));
    return { candidates, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const refundCharges = internalMutation({
  args: { ids: v.array(v.id("billingEvents")) },
  handler: async (ctx, args) => {
    let refunded = 0;
    for (const id of args.ids) {
      const event = await ctx.db.get("billingEvents", id);
      if (!event || event.status === "refunded" || event.status === undefined) continue;
      await refund(ctx, event);
      refunded++;
    }
    return refunded;
  },
});

/**
 * Refund the charges of marketing-service sends that WhatsApp accepted and
 * then failed, whose failure never reached the charge because it was made
 * after the receipt came in. Run with `dryRun: true` first.
 */
export const refundFailedSends = internalAction({
  args: { dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const failed = await failedSends();
    const byWorkspace = new Map<string, FailedSend[]>();
    for (const row of failed) {
      const list = byWorkspace.get(row.workspaceId) ?? [];
      list.push(row);
      byWorkspace.set(row.workspaceId, list);
    }

    const report: Array<{
      workspaceId: string;
      failed: number;
      matched: number;
      refunded: number;
      byCurrency: Record<string, number>;
    }> = [];
    for (const [workspaceId, rows] of byWorkspace) {
      rows.sort((a, b) => a.createdAt - b.createdAt);
      const from = rows[0]!.createdAt - BEFORE_MS;
      const to = rows.at(-1)!.createdAt + AFTER_MS;
      const candidates: Candidate[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: { candidates: Candidate[]; cursor: string; isDone: boolean } = await ctx.runQuery(
          internal.marketingVm.refunds.campaignCharges,
          { workspaceId: workspaceId as Id<"workspaces">, from, to, cursor }
        );
        candidates.push(...page.candidates);
        if (page.isDone) break;
        cursor = page.cursor;
      }
      candidates.sort((a, b) => a.createdAt - b.createdAt);
      const byWamid = new Map(candidates.filter((c) => c.wamid).map((c) => [c.wamid!, c]));
      const byTo = new Map<string, Candidate[]>();
      for (const candidate of candidates) {
        if (candidate.wamid?.startsWith("wamid.")) continue;
        const list = byTo.get(candidate.to) ?? [];
        list.push(candidate);
        byTo.set(candidate.to, list);
      }

      const used = new Set<string>();
      const matched: Candidate[] = [];
      for (const row of rows) {
        const direct = row.wamid ? byWamid.get(row.wamid) : undefined;
        const match =
          direct && !used.has(direct.id)
            ? direct
            : (byTo.get(digits(row.to)) ?? []).find(
                (c) =>
                  !used.has(c.id) &&
                  c.createdAt >= row.createdAt - BEFORE_MS &&
                  c.createdAt <= row.createdAt + AFTER_MS &&
                  (!row.templateName || !c.templateName || row.templateName === c.templateName)
              );
        if (!match) continue;
        used.add(match.id);
        matched.push(match);
      }

      const byCurrency: Record<string, number> = {};
      for (const charge of matched) {
        byCurrency[charge.currency] = (byCurrency[charge.currency] ?? 0) + charge.amountMicros / 1_000_000;
      }
      let refunded = 0;
      if (!args.dryRun) {
        for (let i = 0; i < matched.length; i += 200) {
          refunded += await ctx.runMutation(internal.marketingVm.refunds.refundCharges, {
            ids: matched.slice(i, i + 200).map((charge) => charge.id),
          });
        }
      }
      report.push({ workspaceId, failed: rows.length, matched: matched.length, refunded, byCurrency });
    }
    return report;
  },
});
