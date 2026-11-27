"use client";

import { useMemo, useState } from "react";
import { useCachedQuery } from "@/lib/use-cached-query";
import type { FunctionReturnType } from "convex/server";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { api } from "@/convex/_generated/api";
import { formatMoney } from "@/convex/lib/billing";
import { useHourBucket } from "@/components/use-now";
import { SelectField } from "@/components/select-field";
import { RankedBars, StatTile } from "@/components/dashboard-charts";
import { StatTilesSkeleton, TableSkeleton } from "@/components/skeletons";
import { downloadCsv, toCsv } from "@/lib/csv";
import { friendlyError } from "@/lib/errors";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Download01Icon,
  FileExportIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

type Overview = FunctionReturnType<typeof api.accounting.overview>;
type Payment = Overview["payments"][number];

const PAGE = 50;

const PERIODS = [
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "fy", label: "This financial year" },
  { value: "last-fy", label: "Last financial year" },
  { value: "12m", label: "Last 12 months" },
  { value: "custom", label: "Custom range" },
];

const PURPOSE: Record<Payment["purpose"], string> = {
  subscription: "Plan",
  wallet_topup: "Wallet top-up",
  auto_recharge: "Auto-recharge",
};

const STATUS: Record<Payment["status"], { label: string; tone: string }> = {
  created: { label: "Not completed", tone: "bg-muted text-muted-foreground" },
  pending: {
    label: "Processing",
    tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
  },
  paid: {
    label: "Paid",
    tone: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20 ring-inset dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
  },
  failed: { label: "Failed", tone: "bg-destructive/10 text-destructive" },
};

const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" });

const toInput = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function rangeOf(period: string, now: number, custom: { from: string; to: string }) {
  const today = new Date(now);
  const y = today.getFullYear();
  const m = today.getMonth();
  const fyStart = m >= 3 ? y : y - 1;
  const end = new Date(y, m, today.getDate() + 1).getTime();
  switch (period) {
    case "last-month":
      return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
    case "fy":
      return { from: new Date(fyStart, 3, 1).getTime(), to: end };
    case "last-fy":
      return { from: new Date(fyStart - 1, 3, 1).getTime(), to: new Date(fyStart, 3, 1).getTime() };
    case "12m":
      return { from: new Date(y - 1, m + 1, 1).getTime(), to: end };
    case "custom": {
      const from = custom.from ? new Date(`${custom.from}T00:00:00`).getTime() : new Date(y, m, 1).getTime();
      const to = custom.to ? new Date(`${custom.to}T00:00:00`).getTime() + 86_400_000 : end;
      return { from, to: Math.max(from, to) };
    }
    default:
      return { from: new Date(y, m, 1).getTime(), to: end };
  }
}

export default function AdminAccountingPage() {
  const now = useHourBucket();
  const [period, setPeriod] = useState("month");
  const [custom, setCustom] = useState({ from: toInput(now - 30 * 86_400_000), to: toInput(now) });
  const range = rangeOf(period, now, custom);
  const data = useCachedQuery(api.accounting.overview, range);

  const [tab, setTab] = useState<string | null>(null);
  const currencies = useMemo(() => {
    const seen = new Set((data?.payments ?? []).map((row) => row.currency));
    for (const row of data?.year ?? []) seen.add(row.currency);
    return [...seen].sort((a, b) => Number(b === "INR") - Number(a === "INR") || a.localeCompare(b));
  }, [data]);
  const currency = tab && currencies.includes(tab) ? tab : (currencies[0] ?? "INR");
  const money = (micros: number) => formatMoney(micros, currency, currency === "INR" ? "en-IN" : undefined);

  const payments = (data?.payments ?? []).filter((row) => row.currency === currency);
  const paid = payments.filter((row) => row.status === "paid");
  const sum = (list: Payment[], key: "subtotalMicros" | "gstMicros" | "totalMicros") =>
    list.reduce((total, row) => total + row[key], 0);
  const collected = sum(paid, "totalMicros");
  const net = sum(paid, "subtotalMicros");
  const gst = sum(paid, "gstMicros");
  const failed = payments.filter((row) => row.status === "failed");
  const pending = payments.filter((row) => row.status === "pending" || row.status === "created");
  const before = data?.previous.find((row) => row.currency === currency) ?? null;

  const months = useMemo(() => {
    const today = new Date(now);
    const buckets = Array.from({ length: 12 }, (_, index) => {
      const start = new Date(today.getFullYear(), today.getMonth() - 11 + index, 1);
      return { key: `${start.getFullYear()}-${start.getMonth()}`, month: MONTH.format(start), net: 0, gst: 0 };
    });
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    for (const row of data?.year ?? []) {
      if (row.currency !== currency) continue;
      const date = new Date(row.at);
      const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
      if (!bucket) continue;
      bucket.net += row.subtotalMicros / 1_000_000;
      bucket.gst += row.gstMicros / 1_000_000;
    }
    return buckets;
  }, [data, currency, now]);

  const byType = (Object.keys(PURPOSE) as Payment["purpose"][])
    .map((purpose) => ({
      type: PURPOSE[purpose],
      amount: sum(paid.filter((row) => row.purpose === purpose), "subtotalMicros"),
    }))
    .filter((row) => row.amount > 0);

  const topWorkspaces = [
    ...paid
      .reduce((map, row) => map.set(row.workspace, (map.get(row.workspace) ?? 0) + row.subtotalMicros), new Map<string, number>())
      .entries(),
  ]
    .map(([workspace, amount]) => ({ workspace, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const config = {
    net: { label: "Net revenue", color: "var(--viz-series)" },
    gst: { label: "GST", color: "var(--viz-series-alt)" },
  } satisfies ChartConfig;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 *:shrink-0 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Accounting</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every plan and wallet payment across workspaces: what was collected, the GST on it, and the
            invoices behind it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tracking-wide text-muted-foreground uppercase">Period</span>
          <SelectField value={period} onValueChange={setPeriod} options={PERIODS} />
          {period === "custom" ? (
            <>
              <Input
                type="date"
                aria-label="From"
                className="w-auto"
                value={custom.from}
                onChange={(event) => setCustom((value) => ({ ...value, from: event.target.value }))}
              />
              <Input
                type="date"
                aria-label="To"
                className="w-auto"
                value={custom.to}
                onChange={(event) => setCustom((value) => ({ ...value, to: event.target.value }))}
              />
            </>
          ) : null}
        </div>
      </header>

      {data === undefined ? (
        <>
          <StatTilesSkeleton count={6} className="lg:grid-cols-3 xl:grid-cols-6" />
          <TableSkeleton rows={8} columns={7} />
        </>
      ) : (
        <>
          {data.truncated ? (
            <Alert variant="destructive">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>Showing a partial window</AlertTitle>
              <AlertDescription>The read cap was reached, so these totals are a floor. Narrow the period.</AlertDescription>
            </Alert>
          ) : null}

          {currencies.length > 1 ? (
            <Tabs value={currency} onValueChange={(value) => setTab(String(value))}>
              <TabsList>
                {currencies.map((code) => (
                  <TabsTrigger key={code} value={code}>
                    {code}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Collected" value={collected} previous={before?.totalMicros ?? 0} format={money} />
            <StatTile label="Net revenue" value={net} previous={before?.subtotalMicros ?? 0} format={money} />
            <StatTile label="GST collected" value={gst} previous={before?.gstMicros ?? 0} format={money} />
            <StatTile label="Invoices" value={paid.length} previous={before?.count ?? 0} />
            <StatTile
              label="Average invoice"
              value={paid.length ? collected / paid.length : null}
              previous={before?.count ? before.totalMicros / before.count : null}
              format={money}
            />
            <StatTile label="Failed payments" value={failed.length} previous={null} lowerIsBetter />
          </div>

          {failed.length > 0 || pending.length > 0 ? (
            <p className="-mt-2 text-sm text-muted-foreground">
              {failed.length > 0 ? `${money(sum(failed, "totalMicros"))} failed across ${failed.length} ${failed.length === 1 ? "payment" : "payments"}. ` : ""}
              {pending.length > 0 ? `${money(sum(pending, "totalMicros"))} not completed or still processing.` : ""}
            </p>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Monthly revenue</CardTitle>
              <CardDescription>Net revenue and GST on paid invoices, last 12 months.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={config} className="h-64 w-full">
                <BarChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    width={64}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    tickFormatter={(value) => money(Number(value) * 1_000_000)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <span className="flex w-full justify-between gap-4">
                            <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
                            <span className="tabular-nums">{money(Number(value) * 1_000_000)}</span>
                          </span>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="net" stackId="a" fill="var(--color-net)" maxBarSize={36} isAnimationActive={false} />
                  <Bar
                    dataKey="gst"
                    stackId="a"
                    fill="var(--color-gst)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By type</CardTitle>
                <CardDescription>Net revenue in the period.</CardDescription>
              </CardHeader>
              <CardContent>
                <RankedBars
                  data={byType}
                  categoryKey="type"
                  valueKey="amount"
                  valueLabel="Net revenue"
                  emptyLabel="No paid invoices in this period."
                  formatValue={money}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top workspaces</CardTitle>
                <CardDescription>By net revenue in the period.</CardDescription>
              </CardHeader>
              <CardContent>
                <RankedBars
                  data={topWorkspaces}
                  categoryKey="workspace"
                  valueKey="amount"
                  valueLabel="Net revenue"
                  emptyLabel="No paid invoices in this period."
                  formatValue={money}
                />
              </CardContent>
            </Card>
          </div>

          <Ledger key={`${currency}:${range.from}:${range.to}`} payments={payments} money={money} range={range} />
        </>
      )}
    </div>
  );
}

function Ledger({
  payments,
  money,
  range,
}: {
  payments: Payment[];
  money: (micros: number) => string;
  range: { from: number; to: number };
}) {
  const [status, setStatus] = useState("all");
  const [purpose, setPurpose] = useState("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [downloading, setDownloading] = useState<string | null>(null);

  const needle = search.trim().toLowerCase();
  const rows = payments.filter(
    (row) =>
      (status === "all" || row.status === status) &&
      (purpose === "all" || row.purpose === purpose) &&
      (!needle ||
        row.workspace.toLowerCase().includes(needle) ||
        row.invoiceNumber?.toLowerCase().includes(needle) ||
        row.razorpayPaymentId?.toLowerCase().includes(needle) ||
        row.billedTo?.gstin.toLowerCase().includes(needle))
  );

  const exportCsv = () => {
    const csv = toCsv([
      [
        "Invoice no.",
        "Date",
        "Workspace",
        "Billed to",
        "GSTIN",
        "State",
        "Description",
        "Type",
        "Status",
        "Currency",
        "Amount",
        "GST",
        "Total",
        "Method",
        "Razorpay payment ID",
      ],
      ...[...rows].reverse().map((row) => [
        row.invoiceNumber ?? "",
        toInput(row.at),
        row.workspace,
        row.billedTo?.name ?? "",
        row.billedTo?.gstin ?? "",
        row.billedTo?.state ?? "",
        row.description,
        PURPOSE[row.purpose],
        STATUS[row.status].label,
        row.currency,
        (row.subtotalMicros / 1_000_000).toFixed(2),
        (row.gstMicros / 1_000_000).toFixed(2),
        (row.totalMicros / 1_000_000).toFixed(2),
        row.method ?? "",
        row.razorpayPaymentId ?? "",
      ]),
    ]);
    downloadCsv(`payments ${toInput(range.from)} to ${toInput(range.to - 1)}.csv`, csv);
  };

  const download = async (row: Payment) => {
    if (!row.invoiceNumber || !row.billedTo) return;
    setDownloading(row._id);
    try {
      const { invoicePdf } = await import("@/components/billing/invoice-pdf");
      const blob = await invoicePdf({
        theme: row.theme,
        billedTo: row.billedTo,
        payment: {
          invoiceNumber: row.invoiceNumber,
          purpose: PURPOSE[row.purpose],
          description: row.description,
          currency: row.currency,
          subtotalMicros: row.subtotalMicros,
          gstMicros: row.gstMicros,
          totalMicros: row.totalMicros,
          paidAt: row.at,
          periodStart: row.periodStart ?? undefined,
          periodEnd: row.periodEnd ?? undefined,
          method: row.method ?? undefined,
          razorpayPaymentId: row.razorpayPaymentId ?? undefined,
        },
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Invoice ${row.invoiceNumber.replaceAll("/", "-")}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.add({ title: "Could not download the invoice", description: friendlyError(error), type: "error" });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>
            {DAY.format(range.from)} – {DAY.format(range.to - 1)} · {rows.length.toLocaleString()}{" "}
            {rows.length === 1 ? "payment" : "payments"}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={exportCsv}>
          <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} /> Export CSV
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Workspace, invoice no., GSTIN or payment ID"
              className="pl-8"
            />
          </div>
          <SelectField
            value={status}
            onValueChange={setStatus}
            aria-label="Status"
            options={[
              { value: "all", label: "All statuses" },
              ...(Object.keys(STATUS) as Payment["status"][]).map((key) => ({ value: key, label: STATUS[key].label })),
            ]}
          />
          <SelectField
            value={purpose}
            onValueChange={setPurpose}
            aria-label="Type"
            options={[
              { value: "all", label: "All types" },
              ...(Object.keys(PURPOSE) as Payment["purpose"][]).map((key) => ({ value: key, label: PURPOSE[key] })),
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No payments match.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="min-w-44">Workspace</TableHead>
                    <TableHead className="min-w-44">Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Download</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, shown).map((row) => (
                    <TableRow key={row._id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {row.invoiceNumber ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {DAY.format(row.at)}
                      </TableCell>
                      <TableCell className="max-w-56">
                        <span className="block truncate text-sm font-medium">{row.workspace}</span>
                        {row.billedTo?.gstin ? (
                          <span className="block font-mono text-xs text-muted-foreground">{row.billedTo.gstin}</span>
                        ) : row.billedTo?.state ? (
                          <span className="block text-xs text-muted-foreground">{row.billedTo.state}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-64">
                        <span className="block truncate text-sm">{row.description}</span>
                        <span className="block text-xs text-muted-foreground">
                          {PURPOSE[row.purpose]}
                          {row.periodStart && row.periodEnd
                            ? ` · ${DAY.format(row.periodStart)} – ${DAY.format(row.periodEnd)}`
                            : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{money(row.subtotalMicros)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                        {money(row.gstMicros)}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                        {money(row.totalMicros)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground capitalize">
                        {row.method ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="secondary"
                          className={STATUS[row.status].tone}
                          title={row.status === "failed" ? (row.error ?? undefined) : (row.razorpayPaymentId ?? undefined)}
                        >
                          {STATUS[row.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.status === "paid" && row.invoiceNumber && row.billedTo ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Download invoice"
                            title="Download invoice"
                            disabled={downloading !== null}
                            onClick={() => download(row)}
                          >
                            {downloading === row._id ? <Spinner /> : <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rows.length > shown ? (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={() => setShown((count) => count + PAGE)}>
                  Show more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
