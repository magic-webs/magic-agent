"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ACCESS_HOURS, ACTIVE_STATUSES, ticketRef } from "@/convex/lib/support";
import { useWorkspace } from "@/components/workspace-provider";
import { useClock } from "@/components/support/use-clock";
import { AttachmentBar, useSupportFiles } from "@/components/support/attachments";
import { PriorityBadge, StatusBadge, typeLabel } from "@/components/support/labels";
import { Thread } from "@/components/support/thread";
import { SelectField } from "@/components/select-field";
import { ListSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Delete02Icon,
  LinkSquare02Icon,
  LockKeyIcon,
  SentIcon,
  StarIcon,
} from "@hugeicons/core-free-icons";

function hoursOption(hours: number) {
  return { value: String(hours), label: hours === 168 ? "7 days" : `${hours} hours` };
}

async function attempt(work: () => Promise<unknown>, success?: string) {
  try {
    await work();
    if (success) toast.add({ title: success, type: "success" });
    return true;
  } catch (error) {
    toast.add({ title: "That did not work", description: friendlyError(error), type: "error" });
    return false;
  }
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = id as Id<"supportTickets">;
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  const ticket = useQuery(api.support.get, { ticketId });
  const now = useClock(30_000);

  const reply = useMutation(api.support.reply);
  const markRead = useMutation(api.support.markRead);
  const resolve = useMutation(api.support.resolve);
  const reopen = useMutation(api.support.reopen);
  const rate = useMutation(api.support.rate);
  const grant = useMutation(api.supportAccess.grant);
  const revoke = useMutation(api.supportAccess.revoke);
  const decline = useMutation(api.supportAccess.decline);
  const vaultAdd = useAction(api.supportAccess.vaultAdd);
  const vaultDelete = useMutation(api.supportAccess.vaultDelete);
  const uploadUrl = useMutation(api.support.generateUploadUrl);
  const files = useSupportFiles(() => uploadUrl({ workspaceId: workspace._id }));

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [hours, setHours] = useState("48");
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [secret, setSecret] = useState({ label: "", username: "", password: "", note: "" });
  const [sharing, setSharing] = useState(false);

  const unread = ticket?.unread;
  useEffect(() => {
    if (unread) void markRead({ ticketId }).catch(() => undefined);
  }, [unread, ticketId, markRead]);

  if (ticket === undefined) {
    return (
      <div className="p-6">
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (ticket === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>Ticket not found</EmptyTitle>
            <EmptyDescription>
              It may belong to someone else on your team. <Link href={`${base}/support`} className="underline">Back to tickets</Link>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const active = ACTIVE_STATUSES.includes(ticket.status);
  const canReopen = ticket.status === "resolved" && (ticket.reopenUntil ?? 0) > now;
  const canReply = active || canReopen;

  const send = async () => {
    if (files.busy) return;
    setSending(true);
    const ok = await attempt(() => reply({ ticketId, body, attachments: files.files }));
    setSending(false);
    if (ok) {
      setBody("");
      files.clear();
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto">
        <header className="flex flex-wrap items-start gap-3 border-b px-4 py-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            nativeButton={false}
            render={<Link href={`${base}/support`} aria-label="Back to tickets" />}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground tabular-nums">{ticketRef(ticket.number)}</p>
            <h1 className="font-heading text-xl font-semibold tracking-tight break-words">{ticket.subject}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <span className="text-xs text-muted-foreground">{typeLabel(ticket.type)}</span>
            </div>
          </div>
          {active ? (
            <Button variant="outline" onClick={() => void attempt(() => resolve({ ticketId }), "Marked resolved")}>
              Mark resolved
            </Button>
          ) : canReopen ? (
            <Button variant="outline" onClick={() => void attempt(() => reopen({ ticketId }), "Reopened")}>
              Reopen
            </Button>
          ) : null}
        </header>

        {ticket.accessRequestedAt && !ticket.accessUntil ? (
          <div className="mx-4 mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:mx-6">
            <div>
              <p className="text-sm font-semibold">Support is asking to open your workspace</p>
              {ticket.accessRequestNote ? (
                <p className="mt-1 text-sm whitespace-pre-wrap">{ticket.accessRequestNote}</p>
              ) : null}
            </div>
            {ticket.canGrant ? (
              <div className="flex flex-wrap items-center gap-2">
                <SelectField
                  value={hours}
                  onValueChange={setHours}
                  options={ACCESS_HOURS.map(hoursOption)}
                  className="w-32"
                  aria-label="Access time"
                />
                <Button onClick={() => void attempt(() => grant({ ticketId, hours: Number(hours) }), "Access granted")}>
                  Allow access
                </Button>
                <Button variant="outline" onClick={() => void attempt(() => decline({ ticketId }), "Request declined")}>
                  Decline
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Ask the workspace owner to approve it.</p>
            )}
          </div>
        ) : null}

        <div className="flex-1 px-4 py-5 sm:px-6">
          <Thread messages={ticket.messages} events={ticket.events} />
        </div>

        <div className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-6" {...files.surface}>
          {canReply ? (
            <div className="flex flex-col gap-2">
              {ticket.status === "resolved" ? (
                <p className="text-xs text-muted-foreground">Replying reopens this ticket.</p>
              ) : null}
              <Textarea
                rows={3}
                placeholder="Write a reply… paste or drop screenshots here"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
                }}
              />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <AttachmentBar files={files} compact />
                <Button
                  onClick={() => void send()}
                  disabled={sending || files.busy || (!body.trim() && files.files.length === 0)}
                >
                  {sending ? <Spinner /> : <HugeiconsIcon icon={SentIcon} strokeWidth={2} />} Send
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This ticket is {ticket.status}. <Link href={`${base}/support/new`} className="text-primary underline">Open a new ticket</Link> and mention {ticketRef(ticket.number)} if it comes back.
            </p>
          )}
        </div>
      </section>

      <aside className="flex w-full shrink-0 flex-col gap-4 border-t p-4 sm:p-6 lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Opened</dt>
              <dd title={format(ticket.createdAt, "PPpp")}>{format(ticket.createdAt, "d MMM, HH:mm")}</dd>
              <dt className="text-muted-foreground">By</dt>
              <dd className="truncate">{ticket.requesterName}</dd>
              <dt className="text-muted-foreground">Handled by</dt>
              <dd className="truncate">{ticket.assigneeName ?? "Not assigned yet"}</dd>
              {ticket.link ? (
                <>
                  <dt className="text-muted-foreground">About</dt>
                  <dd>
                    <Link href={`${base}${ticket.link === "/" ? "" : ticket.link}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3.5" />
                      {ticket.linkLabel ?? "Page"}
                    </Link>
                  </dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Workspace access</CardTitle>
            <CardDescription>
              {ticket.accessUntil
                ? `Open until ${format(ticket.accessUntil, "d MMM, HH:mm")} — ${formatDistanceToNowStrict(ticket.accessUntil)} left.`
                : "Support cannot open your workspace for this ticket."}
            </CardDescription>
          </CardHeader>
          {ticket.canGrant && active ? (
            <CardContent className="flex flex-wrap gap-2">
              {ticket.accessUntil ? (
                <Button variant="destructive" size="sm" onClick={() => void attempt(() => revoke({ ticketId }), "Access ended")}>
                  End access now
                </Button>
              ) : (
                <>
                  <SelectField
                    value={hours}
                    onValueChange={setHours}
                    options={ACCESS_HOURS.map(hoursOption)}
                    size="sm"
                    className="w-28"
                    aria-label="Access time"
                  />
                  <Button size="sm" onClick={() => void attempt(() => grant({ ticketId, hours: Number(hours) }), "Access granted")}>
                    Grant access
                  </Button>
                </>
              )}
            </CardContent>
          ) : null}
        </Card>

        {ticket.accessUntil && ticket.canGrant ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HugeiconsIcon icon={LockKeyIcon} strokeWidth={2} className="size-4" /> Shared credentials
              </CardTitle>
              <CardDescription>
                For another account we need — Meta Business, your website. Encrypted, visible only
                to the person handling this ticket, and deleted when access ends.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {ticket.vault.map((entry) => (
                <div key={entry._id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{entry.label}</p>
                    {entry.username ? <p className="truncate text-xs text-muted-foreground">{entry.username}</p> : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    onClick={() => void attempt(() => vaultDelete({ entryId: entry._id }), "Deleted")}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </div>
              ))}
              <form
                className="flex flex-col gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setSharing(true);
                  const ok = await attempt(
                    () =>
                      vaultAdd({
                        ticketId,
                        label: secret.label,
                        username: secret.username || undefined,
                        secret: secret.password,
                        note: secret.note || undefined,
                      }),
                    "Shared securely"
                  );
                  setSharing(false);
                  if (ok) setSecret({ label: "", username: "", password: "", note: "" });
                }}
              >
                <Label className="text-xs">Account</Label>
                <Input required placeholder="Meta Business Manager" value={secret.label} onChange={(event) => setSecret({ ...secret, label: event.target.value })} />
                <Input placeholder="Username or email" autoComplete="off" value={secret.username} onChange={(event) => setSecret({ ...secret, username: event.target.value })} />
                <Input required type="password" placeholder="Password" autoComplete="new-password" value={secret.password} onChange={(event) => setSecret({ ...secret, password: event.target.value })} />
                <Input placeholder="Note (2FA, which page…)" value={secret.note} onChange={(event) => setSecret({ ...secret, note: event.target.value })} />
                <Button type="submit" size="sm" variant="outline" disabled={sharing}>
                  {sharing ? <Spinner /> : null} Share securely
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {(ticket.status === "resolved" || ticket.status === "closed") ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>How did we do?</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {ticket.rating ? (
                <p className="text-sm">
                  You rated this {ticket.rating}/5{ticket.ratingComment ? ` — “${ticket.ratingComment}”` : ""}. Thank you.
                </p>
              ) : (
                <>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-label={`${value} stars`}
                        onClick={() => setStars(value)}
                        className={cn("rounded p-0.5", value <= stars ? "text-amber-500" : "text-muted-foreground/40")}
                      >
                        <HugeiconsIcon icon={StarIcon} strokeWidth={2} className={cn("size-6", value <= stars && "fill-current")} />
                      </button>
                    ))}
                  </div>
                  <Textarea rows={2} placeholder="Anything we could do better?" value={comment} onChange={(event) => setComment(event.target.value)} />
                  <Button
                    size="sm"
                    disabled={!stars}
                    onClick={() => void attempt(() => rate({ ticketId, rating: stars, comment: comment || undefined }), "Thanks for the feedback")}
                  >
                    Send rating
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
