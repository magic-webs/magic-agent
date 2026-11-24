// The platform's own books: every plan and wallet payment across workspaces,
// for the admin Accounting page.

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { covers, requireScope } from "./lib/auth";
import { accountFor, billingContact } from "./lib/account";

const READ_CAP = 5000;
const SLACK = 7 * 24 * 60 * 60 * 1000;
const YEAR = 366 * 24 * 60 * 60 * 1000;

const dateOf = (row: Doc<"billingPayments">) => row.paidAt ?? row.createdAt;

export const overview = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const principal = await requireScope(ctx, "accounting");
    const span = Math.max(0, args.to - args.from);
    const previousFrom = args.from - span;
    const start = Math.min(previousFrom, args.to - YEAR) - SLACK;

    const read = await ctx.db
      .query("billingPayments")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", start).lt("createdAt", args.to + SLACK))
      .order("desc")
      .take(READ_CAP + 1);
    const truncated = read.length > READ_CAP;
    const rows = read
      .slice(0, READ_CAP)
      .filter((row) => covers(principal, row.workspaceId) && dateOf(row) < args.to);

    const inPeriod = rows.filter((row) => dateOf(row) >= args.from);
    const previous = rows.filter(
      (row) => row.status === "paid" && dateOf(row) >= previousFrom && dateOf(row) < args.from
    );
    const year = rows.filter((row) => row.status === "paid" && dateOf(row) >= args.to - YEAR);

    const parties = new Map<Id<"workspaces">, Awaited<ReturnType<typeof partyOf>>>();
    for (const row of inPeriod) {
      if (!parties.has(row.workspaceId)) parties.set(row.workspaceId, await partyOf(ctx, row.workspaceId));
    }

    const totals = (list: Doc<"billingPayments">[]) => {
      const byCurrency = new Map<string, { count: number; subtotalMicros: number; gstMicros: number; totalMicros: number }>();
      for (const row of list) {
        const entry = byCurrency.get(row.currency) ?? { count: 0, subtotalMicros: 0, gstMicros: 0, totalMicros: 0 };
        entry.count++;
        entry.subtotalMicros += row.subtotalMicros;
        entry.gstMicros += row.gstMicros;
        entry.totalMicros += row.totalMicros;
        byCurrency.set(row.currency, entry);
      }
      return [...byCurrency].map(([currency, entry]) => ({ currency, ...entry }));
    };

    return {
      truncated,
      previous: totals(previous),
      year: year.map((row) => ({
        at: dateOf(row),
        currency: row.currency,
        subtotalMicros: row.subtotalMicros,
        gstMicros: row.gstMicros,
      })),
      payments: inPeriod.map((row) => {
        const party = parties.get(row.workspaceId) ?? null;
        return {
          _id: row._id,
          workspaceId: row.workspaceId,
          workspace: party?.workspace ?? "Deleted workspace",
          slug: party?.slug ?? null,
          theme: party?.theme ?? null,
          billedTo: party?.billedTo ?? null,
          purpose: row.purpose,
          status: row.status,
          description: row.description,
          currency: row.currency,
          subtotalMicros: row.subtotalMicros,
          gstMicros: row.gstMicros,
          totalMicros: row.totalMicros,
          invoiceNumber: row.invoiceNumber ?? null,
          razorpayPaymentId: row.razorpayPaymentId ?? null,
          method: row.method ?? null,
          error: row.error ?? null,
          periodStart: row.periodStart ?? null,
          periodEnd: row.periodEnd ?? null,
          at: dateOf(row),
        };
      }),
    };
  },
});

async function partyOf(
  ctx: Parameters<typeof accountFor>[0],
  workspaceId: Id<"workspaces">
) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return null;
  const account = await accountFor(ctx, workspaceId);
  const contact = billingContact(account, workspace);
  return {
    workspace: workspace.name,
    slug: workspace.slug,
    theme: workspace.theme ?? null,
    billedTo: {
      name: contact.name,
      gstin: account?.gstin ?? "",
      email: contact.email,
      phone: contact.phone,
      address: account?.billingAddress ?? workspace.address ?? "",
      state: account?.billingState ?? "",
    },
  };
}
