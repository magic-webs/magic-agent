import type { MutationCtx } from "../_generated/server";

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

/** The Indian financial year a payment falls in, April to March: "2026-27". */
export function financialYear(timestamp: number): string {
  const date = new Date(timestamp + IST_OFFSET);
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The next number in the year's series, e.g. MA/2026-27/0001. */
export async function nextInvoiceNumber(ctx: MutationCtx, paidAt: number): Promise<string> {
  const series = financialYear(paidAt);
  const counter = await ctx.db
    .query("invoiceCounters")
    .withIndex("by_series", (q) => q.eq("series", series))
    .unique();
  let serial = 1;
  if (counter) {
    serial = counter.next;
    await ctx.db.patch("invoiceCounters", counter._id, { next: serial + 1 });
  } else {
    await ctx.db.insert("invoiceCounters", { series, next: 2 });
  }
  return `MA/${series}/${String(serial).padStart(4, "0")}`;
}
