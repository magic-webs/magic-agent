"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePaginatedQuery, useQuery } from "convex/react";
import { format } from "date-fns";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/components/use-session";
import { TableSkeleton } from "@/components/skeletons";
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
import { BellRingingIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react";
import {
  ChannelIcons,
  StatusBadge,
  audienceText,
  categoryLabel,
  type Broadcast,
} from "@/components/platform-notifications/shared";

function when(row: Broadcast): string {
  const time =
    row.status === "scheduled" ? row.scheduledAt : row.finishedAt ?? row.startedAt ?? row.updatedAt;
  if (!time) return "—";
  const text = format(new Date(time), "d MMM yyyy, h:mm a");
  return row.status === "scheduled" ? `for ${text}` : text;
}

function sentText(row: Broadcast): string {
  if (row.status === "draft" || row.status === "scheduled") return "—";
  const sent = row.push.sent + row.email.sent + row.sms.sent;
  const failed = row.push.failed + row.email.failed + row.sms.failed;
  return failed ? `${sent} sent · ${failed} failed` : `${sent} sent`;
}

export default function AdminNotificationsPage() {
  const router = useRouter();
  const modifies = useSession().canModify("notifications");
  const settings = useQuery(api.platformNotifications.settings, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.platformNotifications.list,
    {},
    { initialNumItems: 25 }
  );
  const planName = (id: string) => settings?.plans.find((plan) => plan._id === id)?.name ?? "plan";
  const missing = settings
    ? [settings.configured.email ? null : "email (ZEPTOMAIL_TOKEN)", settings.configured.sms ? null : "SMS (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID)"].filter(Boolean)
    : [];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tell your customers about updates, new features, offers and service notices by app
            push, email and SMS.
          </p>
        </div>
        {modifies ? (
          <Button nativeButton={false} render={<Link href="/admin/notifications/new" />}>
            <PlusIcon /> New notification
          </Button>
        ) : null}
      </header>

      {missing.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            Not configured on the deployment: {missing.join(" and ")}. Those channels stay off
            until the environment variables are set.
          </span>
        </div>
      ) : null}

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRingingIcon className="size-4" /> Sent and scheduled
          </CardTitle>
          <CardDescription>Open one to edit a draft or see how a send went.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {status === "LoadingFirstPage" ? (
            <TableSkeleton columns={5} rows={4} />
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing sent yet. Write your first notification to reach every workspace at once.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Notification</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Audience</TableHead>
                    <TableHead className="hidden lg:table-cell">Delivered</TableHead>
                    <TableHead className="hidden sm:table-cell">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((row) => (
                    <TableRow
                      key={row._id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/admin/notifications/${row._id}`)}
                    >
                      <TableCell className="max-w-80">
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate font-medium">{row.title}</span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            {categoryLabel(row.category)}
                            <ChannelIcons channels={row.channels} />
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">
                        {audienceText(row.audience, planName)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {sentText(row)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {when(row)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {status === "CanLoadMore" || status === "LoadingMore" ? (
            <Button
              variant="outline"
              className="self-center"
              disabled={status === "LoadingMore"}
              onClick={() => loadMore(25)}
            >
              {status === "LoadingMore" ? <Spinner /> : null} Load more
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
