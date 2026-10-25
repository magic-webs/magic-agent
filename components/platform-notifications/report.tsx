"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import { errorText, relative } from "@/components/admin-account-fields";
import { useSession } from "@/components/use-session";
import { TableSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Copy01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import {
  CHANNELS,
  PushPreview,
  StatusBadge,
  audienceText,
  categoryLabel,
  type Broadcast,
} from "./shared";

type DeliveryStatus = "failed" | "skipped" | "sent" | "pending";

function Deliveries({ broadcast }: { broadcast: Broadcast }) {
  const [status, setStatus] = useState<DeliveryStatus>(
    broadcast.push.failed + broadcast.email.failed + broadcast.sms.failed > 0 ? "failed" : "sent"
  );
  const { results, status: loading, loadMore } = usePaginatedQuery(
    api.platformNotifications.deliveries,
    { id: broadcast._id, status },
    { initialNumItems: 25 }
  );
  const channelLabel = (value: string) => CHANNELS.find((channel) => channel.value === value)?.label ?? value;

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>Deliveries</CardTitle>
        <CardDescription>One row per address, or per workspace for app push.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs value={status} onValueChange={(value) => setStatus(value as DeliveryStatus)}>
          <TabsList>
            <TabsTrigger value="failed">Failed</TabsTrigger>
            <TabsTrigger value="skipped">Skipped</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
          </TabsList>
        </Tabs>
        {loading === "LoadingFirstPage" ? (
          <TableSkeleton columns={4} rows={4} />
        ) : results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="hidden md:table-cell">Detail</TableHead>
                  <TableHead className="hidden lg:table-cell">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="max-w-56 truncate font-medium">{row.recipient}</TableCell>
                    <TableCell className="max-w-48 truncate">{row.workspace}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{channelLabel(row.channel)}</Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-80 truncate text-muted-foreground md:table-cell">
                      {row.detail ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {relative(row.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {loading === "CanLoadMore" || loading === "LoadingMore" ? (
          <Button
            variant="outline"
            className="self-center"
            disabled={loading === "LoadingMore"}
            onClick={() => loadMore(50)}
          >
            {loading === "LoadingMore" ? <Spinner /> : null} Load more
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function Report({ broadcast }: { broadcast: Broadcast }) {
  const router = useRouter();
  const modifies = useSession().canModify("notifications");
  const settings = useQuery(api.platformNotifications.settings, {});
  const cancel = useMutation(api.platformNotifications.cancel);
  const duplicate = useMutation(api.platformNotifications.duplicate);
  const [busy, setBusy] = useState<string | null>(null);
  const planName = (id: string) => settings?.plans.find((plan) => plan._id === id)?.name ?? "plan";

  const act = async (label: string, task: () => Promise<void>, failTitle: string) => {
    setBusy(label);
    try {
      await task();
    } catch (error) {
      toast.add({ title: failTitle, description: errorText(error), type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const channels = CHANNELS.filter((channel) => broadcast.channels[channel.value]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{broadcast.title}</h1>
            <StatusBadge status={broadcast.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {categoryLabel(broadcast.category)} · {audienceText(broadcast.audience, planName)} · by{" "}
            {broadcast.createdByName}
            {broadcast.startedAt ? ` · started ${format(new Date(broadcast.startedAt), "d MMM yyyy, h:mm a")}` : ""}
          </p>
        </div>
        {modifies ? (
          <div className="flex gap-2">
            {broadcast.status === "sending" ? (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void act(
                    "stop",
                    async () => {
                      await cancel({ id: broadcast._id });
                      toast.add({ title: "Sending stopped", type: "success" });
                    },
                    "Could not stop sending"
                  )
                }
              >
                {busy === "stop" ? <Spinner /> : <HugeiconsIcon icon={StopIcon} strokeWidth={2} />} Stop
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void act(
                  "duplicate",
                  async () => {
                    const id = await duplicate({ id: broadcast._id });
                    router.push(`/admin/notifications/${id}`);
                  },
                  "Could not duplicate"
                )
              }
            >
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} /> Duplicate
            </Button>
          </div>
        ) : null}
      </header>

      {broadcast.status === "failed" && broadcast.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
          <span>Sending stopped: {broadcast.error}</span>
        </div>
      ) : null}

      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Workspaces reached</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl tabular-nums">
              {broadcast.workspaces}
              {broadcast.status === "sending" ? <Spinner className="size-4" /> : null}
            </CardTitle>
          </CardHeader>
        </Card>
        {channels.map((channel) => {
          const stats = broadcast[channel.value];
          return (
            <Card key={channel.value} size="sm">
              <CardHeader>
                <CardDescription className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={channel.icon} strokeWidth={2} className="size-4" /> {channel.label}
                  {channel.value === "push" ? " devices" : ""}
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">{stats.sent} sent</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {stats.failed} failed · {stats.skipped} skipped
                {channel.value === "push" ? " (no devices)" : ""}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid shrink-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Deliveries broadcast={broadcast} />
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <PushPreview title={broadcast.title} body={broadcast.body} />
            {broadcast.link ? (
              <p className="truncate text-sm">
                <span className="text-muted-foreground">Link: </span>
                <a href={broadcast.link} target="_blank" rel="noreferrer" className="underline">
                  {broadcast.link}
                </a>
              </p>
            ) : null}
            {broadcast.channels.email ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Email subject: </span>
                {broadcast.emailSubject ?? broadcast.title}
              </p>
            ) : null}
            {broadcast.channels.sms ? (
              <p className="text-sm whitespace-pre-wrap">
                <span className="text-muted-foreground">SMS: </span>
                {broadcast.smsText ?? broadcast.body}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
