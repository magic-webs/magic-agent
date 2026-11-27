"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCachedQuery } from "@/lib/use-cached-query";
import { usePaginatedQuery } from "convex-helpers/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { WhatsAppText } from "@/components/whatsapp-text";
import { LOG_VARIANT, type NotificationLog, type Rule } from "@/components/notifications/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/skeletons";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Download01Icon,
  Mail01Icon,
  Search01Icon,
  SentIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";

const PAGE_SIZE = 50;
const DAY_MS = 86_400_000;
const SOURCES = ["alert", "test", "manual"] as const;
const STATUSES = ["sent", "failed", "skipped"] as const;

type Source = (typeof SOURCES)[number];
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
};

const ago = (instant: number) => formatDistanceToNow(instant, { addSuffix: true });

const sourceLabel = (log: NotificationLog) =>
  log.ruleName ?? (log.kind === "manual" ? "Sent by hand" : log.kind === "test" ? "Test" : "Deleted alert");

function sinceFor(period: string) {
  if (period === "all") return undefined;
  if (period === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  return Date.now() - Number(period) * DAY_MS;
}

function csvCell(value: string | undefined) {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows: NotificationLog[]) {
  const header = ["When", "To", "Channel", "Alert", "Template or subject", "Status", "Message", "Reason"];
  const lines = rows.map((row) =>
    [
      new Date(row.createdAt).toISOString(),
      row.to,
      row.channel,
      sourceLabel(row),
      row.templateName ?? row.subject,
      row.status,
      row.preview,
      row.error,
    ]
      .map(csvCell)
      .join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `notification-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ActivityTab({
  rules,
  alert,
  onAlertChange,
  onOpenLog,
}: {
  rules: Rule[];
  alert: string;
  onAlertChange: (value: string) => void;
  onOpenLog: (log: NotificationLog) => void;
}) {
  const workspace = useWorkspace();
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState("all");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const since = useMemo(() => sinceFor(period), [period]);

  const filters = {
    workspaceId: workspace._id,
    ruleId: rules.some((rule) => rule._id === alert) ? (alert as Id<"notificationRules">) : undefined,
    source: SOURCES.includes(alert as Source) ? (alert as Source) : undefined,
    channel: channel === "whatsapp" || channel === "email" ? (channel as "whatsapp" | "email") : undefined,
    since,
    search: search || undefined,
  };

  const summary = useCachedQuery(api.notifications.logSummary, filters);
  const logs = usePaginatedQuery(
    api.notifications.listLogsPage,
    { ...filters, status: STATUSES.includes(status as Status) ? (status as Status) : undefined },
    { initialNumItems: PAGE_SIZE }
  );
  const rows = logs.results as NotificationLog[];

  const sentinel = useRef<HTMLDivElement>(null);
  const { status: pageStatus, loadMore } = logs;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || pageStatus !== "CanLoadMore") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore(PAGE_SIZE);
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [pageStatus, loadMore]);

  const filtered =
    alert !== "all" || channel !== "all" || status !== "all" || period !== "all" || !!search;

  const clear = () => {
    onAlertChange("all");
    setChannel("all");
    setStatus("all");
    setPeriod("all");
    setSearchDraft("");
    setSearch("");
  };

  const total = summary ? summary.sent + summary.failed + summary.skipped : undefined;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Every alert, test and message sent by hand — and why, when one could not go.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search number, email, template or message"
            className="pl-8"
            aria-label="Search activity"
          />
        </div>
        <SelectField
          aria-label="Alert"
          value={alert}
          onValueChange={onAlertChange}
          className="w-44"
          options={[
            { value: "all", label: "All alerts" },
            ...rules.map((rule) => ({ value: rule._id, label: rule.name })),
            { value: "alert", label: "Any alert" },
            { value: "test", label: "Tests" },
            { value: "manual", label: "Sent by hand" },
          ]}
        />
        <SelectField
          aria-label="Channel"
          value={channel}
          onValueChange={setChannel}
          className="w-36"
          options={[
            { value: "all", label: "All channels" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "email", label: "Email" },
          ]}
        />
        <SelectField
          aria-label="Status"
          value={status}
          onValueChange={setStatus}
          className="w-32"
          options={[
            { value: "all", label: "Any status" },
            ...STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
          ]}
        />
        <SelectField
          aria-label="Period"
          value={period}
          onValueChange={setPeriod}
          className="w-36"
          options={[
            { value: "all", label: "All time" },
            { value: "today", label: "Today" },
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
          ]}
        />
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /> Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStatus("all")}
            className={cn(
              "rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted",
              status === "all" && "bg-muted font-medium"
            )}
          >
            All {total === undefined ? "" : `${total.toLocaleString()}${summary?.capped ? "+" : ""}`}
          </button>
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(status === value ? "all" : value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-muted",
                status === value && "bg-muted font-medium"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  value === "sent"
                    ? "bg-primary"
                    : value === "failed"
                      ? "bg-destructive"
                      : "bg-muted-foreground"
                )}
              />
              {STATUS_LABEL[value]}{" "}
              {summary ? `${summary[value].toLocaleString()}${summary.capped ? "+" : ""}` : ""}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(rows)}
        >
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} /> Export CSV
        </Button>
      </div>

      {logs.status === "LoadingFirstPage" ? (
        <TableSkeleton rows={6} columns={5} />
      ) : rows.length === 0 && logs.status === "Exhausted" ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={SentIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>{filtered ? "Nothing matches" : "Nothing sent yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered ? "No send matches these filters." : "Sends show up here as alerts fire."}
            </EmptyDescription>
          </EmptyHeader>
          {filtered ? (
            <Button variant="outline" size="sm" onClick={clear}>
              Clear filters
            </Button>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>To</TableHead>
                <TableHead className="hidden md:table-cell">Alert</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={item._id} className="cursor-pointer" onClick={() => onOpenLog(item)}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <HugeiconsIcon
                        icon={item.channel === "whatsapp" ? WhatsappIcon : Mail01Icon}
                        strokeWidth={2}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate">{item.to || "Nobody"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {sourceLabel(item)}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <span className="block truncate">{item.templateName ?? item.subject ?? "—"}</span>
                    <span
                      className={cn(
                        "block truncate text-xs",
                        item.error ? "text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {item.error ? (
                        item.error
                      ) : item.preview && item.channel === "whatsapp" ? (
                        <WhatsAppText text={item.preview.replace(/\s*\n\s*/g, " ")} />
                      ) : (
                        item.preview
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant={LOG_VARIANT[item.status]}>{item.status}</Badge>
                      {item.kind ? <Badge variant="outline">{item.kind}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell
                    className="hidden text-xs whitespace-nowrap text-muted-foreground sm:table-cell"
                    title={new Date(item.createdAt).toLocaleString()}
                  >
                    {ago(item.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div ref={sentinel} />
          {logs.status === "CanLoadMore" || logs.status === "LoadingMore" ? (
            <div className="flex justify-center border-t border-border p-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={logs.status === "LoadingMore"}
                onClick={() => loadMore(PAGE_SIZE)}
              >
                {logs.status === "LoadingMore" ? <Spinner /> : null} Load more
              </Button>
            </div>
          ) : rows.length > PAGE_SIZE ? (
            <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
              That is everything.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
