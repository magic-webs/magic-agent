"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { PaymentLinkDialog } from "@/components/payments/payment-link-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  formatMoney,
  isFinalStatus,
  type PaymentLinkStatus,
} from "@/convex/lib/payments";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreHorizontalIcon,
  PlusSignIcon,
  RupeeIcon,
} from "@hugeicons/core-free-icons";

type PaymentLinkRow = FunctionReturnType<typeof api.payments.listLinks>[number];

const FILTERS: Array<{ id: PaymentLinkStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "created", label: "Open" },
  { id: "paid", label: "Paid" },
  { id: "partially_paid", label: "Part paid" },
  { id: "expired", label: "Expired" },
  { id: "cancelled", label: "Cancelled" },
];

const STATUS_STYLE: Record<PaymentLinkStatus, { label: string; className: string }> = {
  created: { label: "Open", className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  partially_paid: {
    label: "Part paid",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  paid: { label: "Paid", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export default function PaymentsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const [filter, setFilter] = useState<PaymentLinkStatus | "all">("all");

  const connected = useQuery(api.payments.isConnected, {
    workspaceId: workspace._id,
  });
  const links = useQuery(
    api.payments.listLinks,
    connected
      ? {
          workspaceId: workspace._id,
          status: filter === "all" ? undefined : filter,
        }
      : "skip"
  );

  const paidTotal = (links ?? [])
    .filter((link) => link.status === "paid")
    .reduce((sum, link) => sum + link.amountPaidPaise, 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Payments
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every Razorpay payment link your agents and team have sent, and
            whether it has been paid.
          </p>
        </div>
        {connected ? (
          <PaymentLinkDialog
            trigger={
              <Button>
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> New payment link
              </Button>
            }
          />
        ) : null}
      </header>

      {connected === undefined ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading…
        </div>
      ) : !connected ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={RupeeIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>Razorpay isn&apos;t connected</EmptyTitle>
            <EmptyDescription>
              Connect your Razorpay account so agents can send payment links.
            </EmptyDescription>
          </EmptyHeader>
          <Button nativeButton={false} render={<Link href={`${base}/integrations`} />}>
            Open Integrations
          </Button>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium transition-colors",
                    filter === item.id
                      ? "border-primary/25 bg-primary/10 text-primary"
                      : "bg-background hover:bg-muted"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {paidTotal > 0 ? (
              <p className="text-sm text-muted-foreground">
                Paid in this list:{" "}
                <span className="font-medium text-foreground">
                  {formatMoney(paidTotal, links?.[0]?.currency ?? "INR")}
                </span>
              </p>
            ) : null}
          </div>

          {links === undefined ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading…
            </div>
          ) : links.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              No payment links{filter === "all" ? " yet" : " here"}.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>For</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {links.map((link) => (
                    <LinkRow key={link.id} link={link} base={base} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LinkRow({ link, base }: { link: PaymentLinkRow; base: string }) {
  const workspace = useWorkspace();
  const refresh = useAction(api.payments.refreshLink);
  const cancel = useAction(api.payments.cancelLink);
  const [busy, setBusy] = useState(false);
  const style = STATUS_STYLE[link.status];

  const run = async (
    label: string,
    call: (args: { workspaceId: Id<"workspaces">; linkId: Id<"paymentLinks"> }) => Promise<{
      status: PaymentLinkStatus;
    }>
  ) => {
    setBusy(true);
    try {
      const result = await call({ workspaceId: workspace._id, linkId: link.id });
      toast.add({ title: `${label}: ${STATUS_STYLE[result.status].label}`, type: "success" });
    } catch (error) {
      toast.add({ title: friendlyError(error, `Could not ${label.toLowerCase()}.`), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.add({ title: "Link copied", type: "success" });
    } catch (error) {
      toast.add({ title: friendlyError(error, "Could not copy."), type: "error" });
    }
  };

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {when(link.createdAt)}
      </TableCell>
      <TableCell className="min-w-40">
        <p className="font-medium">{link.customer.name ?? "—"}</p>
        <p className="text-xs text-muted-foreground">
          {link.customer.phone ?? link.customer.email ?? ""}
        </p>
      </TableCell>
      <TableCell className="min-w-56 max-w-md">
        <p className="line-clamp-2">{link.description}</p>
        {link.recordReference ? (
          <p className="font-mono text-xs text-muted-foreground">{link.recordReference}</p>
        ) : null}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {formatMoney(link.amountPaise, link.currency)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", style.className)}>
          {style.label}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">
          {link.paidAt
            ? `${when(link.paidAt)}${link.method ? ` · ${link.method}` : ""}`
            : link.expiresAt && !isFinalStatus(link.status)
              ? `Expires ${when(link.expiresAt)}`
              : ""}
        </p>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {link.source === "agent" ? (link.agentName ?? "Agent") : "Team"}
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon-sm" variant="ghost" aria-label="Actions" disabled={busy} />
            }
          >
            {busy ? <Spinner /> : <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void copy()}>Copy link</DropdownMenuItem>
            <DropdownMenuItem
              render={<a href={link.url} target="_blank" rel="noreferrer" />}
            >
              Open link
            </DropdownMenuItem>
            {link.conversationId ? (
              <DropdownMenuItem
                render={<Link href={`${base}/conversations?c=${link.conversationId}`} />}
              >
                Open conversation
              </DropdownMenuItem>
            ) : null}
            {!isFinalStatus(link.status) ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void run("Refreshed", refresh)}>
                  Refresh status
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void run("Cancelled", cancel)}
                >
                  Cancel link
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
