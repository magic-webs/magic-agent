"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  SUPPORT_TYPES,
  ticketRef,
  type SupportPriority,
  type SupportStatus,
  type SupportType,
} from "@/convex/lib/support";
import { useSession } from "@/components/use-session";
import { PriorityBadge, StatusBadge, typeLabel } from "@/components/support/labels";
import { SlaLabel } from "@/components/support/sla";
import { when } from "@/components/support/thread";
import { useClock } from "@/components/support/use-clock";
import { SelectField } from "@/components/select-field";
import { TableSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChartHistogramIcon,
  CustomerSupportIcon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";

type View = "unassigned" | "mine" | "waiting" | "breaching" | "open" | "done" | "all";

const VIEWS: { value: View; label: string }[] = [
  { value: "unassigned", label: "Unassigned" },
  { value: "mine", label: "Mine" },
  { value: "breaching", label: "At risk" },
  { value: "waiting", label: "Waiting on client" },
  { value: "open", label: "All open" },
  { value: "done", label: "Resolved" },
  { value: "all", label: "Everything" },
];

const ANY = "any";

export default function AdminSupportPage() {
  const session = useSession();
  const modifies = session.canModify("support");
  const now = useClock(60_000);
  const [view, setView] = useState<View>("open");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<string>(ANY);
  const [type, setType] = useState<string>(ANY);
  const [assignee, setAssignee] = useState<string>(ANY);
  const [selected, setSelected] = useState<Set<Id<"supportTickets">>>(new Set());

  const counts = useQuery(api.support.counts, {});
  const staff = useQuery(api.support.staffList, {});
  const tickets = useQuery(api.support.inbox, {
    view,
    now: Math.floor(now / 60_000) * 60_000,
    search: search.trim() || undefined,
    priority: priority === ANY ? undefined : (priority as SupportPriority),
    type: type === ANY ? undefined : (type as SupportType),
    assigneeId: assignee === ANY ? undefined : (assignee as Id<"admins">),
  });
  const bulkUpdate = useMutation(api.support.bulkUpdate);

  const visible = tickets ?? [];
  const chosen = visible.filter((ticket) => selected.has(ticket._id)).map((ticket) => ticket._id);

  const bulk = async (changes: {
    status?: SupportStatus;
    priority?: SupportPriority;
    assigneeId?: Id<"admins"> | null;
  }) => {
    try {
      await bulkUpdate({ ticketIds: chosen, ...changes });
      toast.add({ title: `${chosen.length} ticket(s) updated`, type: "success" });
      setSelected(new Set());
    } catch (error) {
      toast.add({ title: "Update failed", description: friendlyError(error), type: "error" });
    }
  };

  const staffOptions = (staff ?? []).map((member) => ({ value: member._id, label: member.name }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Support</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts
              ? `${counts.unassigned} unassigned · ${counts.mine} waiting on you`
              : "Tickets from every workspace."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/support/reports" />}>
            <HugeiconsIcon icon={ChartHistogramIcon} strokeWidth={2} /> Reports
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/support/settings" />}>
            <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} /> Settings
          </Button>
        </div>
      </header>

      <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
        <Tabs
          value={view}
          onValueChange={(next) => {
            setView(next as View);
            setSelected(new Set());
          }}
        >
          <TabsList className="max-w-full overflow-x-auto">
            {VIEWS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
                {item.value === "unassigned" && counts?.unassigned ? ` (${counts.unassigned})` : ""}
                {item.value === "mine" && counts?.mine ? ` (${counts.mine})` : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-8"
              placeholder="Search subject or #number"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <SelectField
            className="w-36"
            value={priority}
            onValueChange={setPriority}
            options={[{ value: ANY, label: "Any priority" }, ...SUPPORT_PRIORITIES]}
            aria-label="Priority"
          />
          <SelectField
            className="w-44"
            value={type}
            onValueChange={setType}
            options={[{ value: ANY, label: "Any type" }, ...SUPPORT_TYPES]}
            aria-label="Type"
          />
          <SelectField
            className="w-44"
            value={assignee}
            onValueChange={setAssignee}
            options={[{ value: ANY, label: "Anyone" }, ...staffOptions]}
            aria-label="Assignee"
          />
        </div>

        {modifies && chosen.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{chosen.length} selected</span>
            <SelectField
              size="sm"
              className="w-40"
              value=""
              placeholder="Assign to…"
              onValueChange={(value) =>
                void bulk({ assigneeId: value === "none" ? null : (value as Id<"admins">) })
              }
              options={[{ value: "none", label: "Unassigned" }, ...staffOptions]}
            />
            <SelectField
              size="sm"
              className="w-40"
              value=""
              placeholder="Set status…"
              onValueChange={(value) => void bulk({ status: value as SupportStatus })}
              options={SUPPORT_STATUSES.map((status) => ({
                ...status,
                label: status.value === "waiting_client" ? "Waiting on client" : status.label,
              }))}
            />
            <SelectField
              size="sm"
              className="w-36"
              value=""
              placeholder="Set priority…"
              onValueChange={(value) => void bulk({ priority: value as SupportPriority })}
              options={SUPPORT_PRIORITIES}
            />
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        ) : null}

        {tickets === undefined ? (
          <TableSkeleton rows={8} />
        ) : tickets.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={CustomerSupportIcon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>Nothing here</EmptyTitle>
              <EmptyDescription>No tickets match this view.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  {modifies ? (
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        className="size-4 accent-primary"
                        checked={chosen.length > 0 && chosen.length === visible.length}
                        onChange={(event) =>
                          setSelected(new Set(event.target.checked ? visible.map((ticket) => ticket._id) : []))
                        }
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Ticket</TableHead>
                  <TableHead className="hidden md:table-cell">Workspace</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Assignee</TableHead>
                  <TableHead className="hidden lg:table-cell">SLA</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket._id} data-state={selected.has(ticket._id) ? "selected" : undefined}>
                    {modifies ? (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${ticketRef(ticket.number)}`}
                          className="size-4 accent-primary"
                          checked={selected.has(ticket._id)}
                          onChange={(event) => {
                            const next = new Set(selected);
                            if (event.target.checked) next.add(ticket._id);
                            else next.delete(ticket._id);
                            setSelected(next);
                          }}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="max-w-md">
                      <Link href={`/admin/support/${ticket._id}`} className="block min-w-0">
                        <div className="flex items-center gap-2">
                          {ticket.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" /> : null}
                          <span className="text-xs text-muted-foreground tabular-nums">{ticketRef(ticket.number)}</span>
                          <span className={cn("truncate", ticket.unread ? "font-semibold" : "font-medium")}>
                            {ticket.subject}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {typeLabel(ticket.type)} · {ticket.requesterName}
                          {ticket.accessUntil ? " · access open" : ""}
                          {ticket.tags.length ? ` · ${ticket.tags.join(", ")}` : ""}
                        </p>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden max-w-40 truncate md:table-cell">{ticket.workspaceName}</TableCell>
                    <TableCell>
                      <PriorityBadge priority={ticket.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ticket.status} staff />
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {ticket.assigneeName ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <SlaLabel ticket={ticket} now={now} />
                    </TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                      {when(ticket.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
