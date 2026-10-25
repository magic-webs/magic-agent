"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { format, formatDistanceStrict, formatDistanceToNowStrict } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatMoney } from "@/convex/lib/billing";
import {
  ACTIVE_STATUSES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  SUPPORT_TYPES,
  ticketRef,
  type SupportPriority,
  type SupportStatus,
  type SupportType,
} from "@/convex/lib/support";
import { AttachmentBar, useSupportFiles } from "@/components/support/attachments";
import { PriorityBadge, StatusBadge } from "@/components/support/labels";
import { SlaLabel } from "@/components/support/sla";
import { Thread } from "@/components/support/thread";
import { useClock } from "@/components/support/use-clock";
import { SelectField } from "@/components/select-field";
import { ListSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  EyeIcon,
  Key01Icon,
  LinkSquare02Icon,
  LockKeyIcon,
  SentIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  );
}

export default function AdminTicketPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = id as Id<"supportTickets">;
  const router = useRouter();
  const now = useClock(15_000);
  const ticket = useQuery(api.support.staffGet, { ticketId });
  const staff = useQuery(api.support.staffList, {});
  const replies = useQuery(api.supportAdmin.replies, {});
  const viewers = useQuery(api.support.viewers, { ticketId, now: Math.floor(now / 15_000) * 15_000 });

  const staffReply = useMutation(api.support.staffReply);
  const update = useMutation(api.support.update);
  const markRead = useMutation(api.support.staffMarkRead);
  const heartbeat = useMutation(api.support.heartbeat);
  const merge = useMutation(api.support.merge);
  const requestAccess = useMutation(api.supportAccess.request);
  const recordVisit = useMutation(api.supportAccess.recordVisit);
  const reveal = useAction(api.supportAccess.vaultReveal);
  const uploadUrl = useMutation(api.support.staffUploadUrl);
  const files = useSupportFiles(() => uploadUrl({ ticketId }));

  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [after, setAfter] = useState<"keep" | SupportStatus>("keep");
  const [sending, setSending] = useState(false);
  const [tags, setTags] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [revealed, setRevealed] = useState<Record<string, { username: string | null; secret: string }>>({});

  const typing = body.trim().length > 0;
  const typingRef = useRef(typing);
  useEffect(() => {
    const beat = () => void heartbeat({ ticketId, typing: typingRef.current }).catch(() => undefined);
    beat();
    const timer = setInterval(beat, 15_000);
    return () => clearInterval(timer);
  }, [ticketId, heartbeat]);
  useEffect(() => {
    typingRef.current = typing;
    void heartbeat({ ticketId, typing }).catch(() => undefined);
  }, [typing, ticketId, heartbeat]);

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
              <Link href="/admin/support" className="underline">Back to the inbox</Link>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const modifies = ticket.canModify;
  const staffOptions = (staff ?? []).map((member) => ({ value: member._id, label: member.name }));
  const workspaceHref = ticket.workspace ? `/w/${ticket.workspace.slug}` : null;
  const accessOpen = Boolean(ticket.accessUntil);

  const fill = (text: string) =>
    text
      .replaceAll("{{client_name}}", ticket.requesterName.split(" ")[0] ?? ticket.requesterName)
      .replaceAll("{{ticket}}", ticketRef(ticket.number))
      .replaceAll("{{workspace}}", ticket.workspace?.name ?? "your workspace");

  const send = async () => {
    if (files.busy) return;
    setSending(true);
    const ok = await attempt(() =>
      staffReply({
        ticketId,
        body,
        attachments: files.files,
        internal: mode === "note",
        status: mode === "reply" && after !== "keep" ? after : undefined,
      })
    );
    setSending(false);
    if (ok) {
      setBody("");
      setAfter("keep");
      files.clear();
    }
  };

  const openWorkspace = async (why?: string) => {
    if (!workspaceHref || !ticket.workspace) return;
    await recordVisit({ workspaceId: ticket.workspaceId, reason: why }).catch(() => undefined);
    window.open(`${workspaceHref}${ticket.link && ticket.link !== "/" ? ticket.link : ""}`, "_blank");
  };

  const change = (changes: {
    status?: SupportStatus;
    priority?: SupportPriority;
    type?: SupportType;
    assigneeId?: Id<"admins"> | null;
    tags?: string[];
  }) => void attempt(() => update({ ticketId, ...changes }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col xl:overflow-y-auto">
        <header className="flex flex-wrap items-start gap-3 border-b px-4 py-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            nativeButton={false}
            render={<Link href="/admin/support" aria-label="Back to the inbox" />}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {ticketRef(ticket.number)} · {ticket.workspace?.name ?? "Deleted workspace"} · {ticket.requesterName}
            </p>
            <h1 className="font-heading text-xl font-semibold tracking-tight break-words">{ticket.subject}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={ticket.status} staff />
              <PriorityBadge priority={ticket.priority} />
              {ticket.slaBreached ? <Badge variant="destructive">SLA missed</Badge> : null}
              {accessOpen ? <Badge className="border-0 bg-primary/10 text-primary">Access open</Badge> : null}
              {ticket.urgentReason ? (
                <span className="text-xs text-destructive">Urgent: {ticket.urgentReason}</span>
              ) : null}
            </div>
          </div>
          {viewers && viewers.length > 0 ? (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <HugeiconsIcon icon={EyeIcon} strokeWidth={2} className="size-3.5" />
              {viewers.map((viewer) => `${viewer.name}${viewer.typing ? " is typing" : ""}`).join(", ")}
              {viewers.every((viewer) => !viewer.typing) ? " viewing" : ""}
            </div>
          ) : null}
        </header>

        <div className="flex-1 px-4 py-5 sm:px-6">
          <Thread messages={ticket.messages} events={ticket.events} staffView />
        </div>

        {modifies ? (
          <div
            className={cn(
              "sticky bottom-0 border-t px-4 py-3 backdrop-blur sm:px-6",
              mode === "note" ? "bg-amber-500/10" : "bg-background/95"
            )}
            {...files.surface}
          >
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Tabs value={mode} onValueChange={(next) => setMode(next as "reply" | "note")}>
                  <TabsList>
                    <TabsTrigger value="reply">Reply to client</TabsTrigger>
                    <TabsTrigger value="note">Internal note</TabsTrigger>
                  </TabsList>
                </Tabs>
                {replies && replies.length > 0 ? (
                  <SelectField
                    size="sm"
                    className="w-48"
                    value=""
                    placeholder="Canned reply…"
                    onValueChange={(value) => {
                      const reply = replies.find((row) => row._id === value);
                      if (reply) setBody((current) => (current ? `${current}\n\n` : "") + fill(reply.body));
                    }}
                    options={replies.map((reply) => ({ value: reply._id, label: reply.title }))}
                  />
                ) : null}
              </div>
              <Textarea
                rows={4}
                placeholder={mode === "note" ? "Only the support team sees this" : `Reply to ${ticket.requesterName}…`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
                }}
              />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <AttachmentBar files={files} compact />
                <div className="flex items-center gap-2">
                  {mode === "reply" ? (
                    <SelectField
                      size="sm"
                      className="w-48"
                      value={after}
                      onValueChange={(value) => setAfter(value as "keep" | SupportStatus)}
                      options={[
                        { value: "keep", label: "Keep status" },
                        { value: "waiting_client", label: "Then wait on client" },
                        { value: "resolved", label: "Then resolve" },
                      ]}
                    />
                  ) : null}
                  <Button
                    onClick={() => void send()}
                    disabled={sending || files.busy || (!body.trim() && files.files.length === 0)}
                  >
                    {sending ? <Spinner /> : <HugeiconsIcon icon={SentIcon} strokeWidth={2} />}
                    {mode === "note" ? "Add note" : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="flex w-full shrink-0 flex-col gap-4 border-t p-4 sm:p-6 xl:w-96 xl:overflow-y-auto xl:border-t-0 xl:border-l">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Ticket</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                size="sm"
                className="w-full"
                value={ticket.status}
                disabled={!modifies}
                onValueChange={(value) => change({ status: value as SupportStatus })}
                options={SUPPORT_STATUSES.map((status) => ({
                  ...status,
                  label: status.value === "waiting_client" ? "Waiting on client" : status.label,
                }))}
                aria-label="Status"
              />
              <SelectField
                size="sm"
                className="w-full"
                value={ticket.priority}
                disabled={!modifies}
                onValueChange={(value) => change({ priority: value as SupportPriority })}
                options={SUPPORT_PRIORITIES}
                aria-label="Priority"
              />
              <SelectField
                size="sm"
                className="w-full"
                value={ticket.type}
                disabled={!modifies}
                onValueChange={(value) => change({ type: value as SupportType })}
                options={SUPPORT_TYPES}
                aria-label="Type"
              />
              <SelectField
                size="sm"
                className="w-full"
                value={ticket.assigneeId ?? "none"}
                disabled={!modifies}
                onValueChange={(value) =>
                  change({ assigneeId: value === "none" ? null : (value as Id<"admins">) })
                }
                options={[{ value: "none", label: "Unassigned" }, ...staffOptions]}
                aria-label="Assignee"
              />
            </div>
            {modifies && !ticket.isAssignee ? (
              <Button size="sm" variant="outline" onClick={() => change({ assigneeId: ticket.me })}>
                <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} /> Assign to me
              </Button>
            ) : null}
            <Input
              placeholder="Tags, comma separated"
              disabled={!modifies}
              value={tags ?? ticket.tags.join(", ")}
              onChange={(event) => setTags(event.target.value)}
              onBlur={() => {
                if (tags === null) return;
                change({ tags: tags.split(",") });
                setTags(null);
              }}
            />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <Row label="Opened">{format(ticket.createdAt, "d MMM yyyy, HH:mm")}</Row>
              <Row label="SLA">
                <SlaLabel ticket={ticket} now={now} />
              </Row>
              {ticket.firstResponseAt ? (
                <Row label="First reply">
                  {formatDistanceStrict(ticket.firstResponseAt, ticket.createdAt)} after opening
                </Row>
              ) : null}
              <Row label="Requester">{ticket.requesterName}</Row>
              {ticket.requesterEmail ? (
                <Row label="Email">
                  <a href={`mailto:${ticket.requesterEmail}`} className="text-primary hover:underline">
                    {ticket.requesterEmail}
                  </a>
                </Row>
              ) : null}
              {ticket.rating ? (
                <Row label="Rating">
                  {ticket.rating}/5{ticket.ratingComment ? ` — ${ticket.ratingComment}` : ""}
                </Row>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-4" /> Workspace access
            </CardTitle>
            <CardDescription>
              {accessOpen
                ? `Granted by ${ticket.accessGrantedBy ?? "the client"} — ${formatDistanceToNowStrict(ticket.accessUntil!)} left. It follows the assignee.`
                : ticket.accessRequestedAt
                  ? "Requested — waiting for the client to approve."
                  : ticket.canOpen
                    ? "Your role already reaches this workspace. Opening it is logged on the ticket."
                    : "You need the client to grant access before you can open it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {ticket.canOpen && workspaceHref ? (
              <Button
                size="sm"
                onClick={() => {
                  if (accessOpen) void openWorkspace();
                  else setOverride(true);
                }}
              >
                <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} /> Open workspace
              </Button>
            ) : null}
            {!accessOpen && !ticket.accessRequestedAt && modifies && ACTIVE_STATUSES.includes(ticket.status) ? (
              <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
                Request access
              </Button>
            ) : null}
          </CardContent>
        </Card>

        {ticket.vault.length > 0 ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HugeiconsIcon icon={LockKeyIcon} strokeWidth={2} className="size-4" /> Shared credentials
              </CardTitle>
              <CardDescription>Every reveal is logged and shown to the client.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {ticket.vault.map((entry) => {
                const shown = revealed[entry._id];
                return (
                  <div key={entry._id} className="rounded-lg border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{entry.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {entry.username ?? "No username"} · by {entry.createdBy}
                        </p>
                      </div>
                      {ticket.canReveal && !shown ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              const value = await reveal({ ticketId, entryId: entry._id });
                              setRevealed((current) => ({ ...current, [entry._id]: value }));
                              setTimeout(
                                () =>
                                  setRevealed((current) => {
                                    const next = { ...current };
                                    delete next[entry._id];
                                    return next;
                                  }),
                                60_000
                              );
                            } catch (error) {
                              toast.add({ title: "Could not reveal", description: friendlyError(error), type: "error" });
                            }
                          }}
                        >
                          Reveal
                        </Button>
                      ) : null}
                    </div>
                    {shown ? (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{shown.secret}</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void navigator.clipboard.writeText(shown.secret)}
                        >
                          Copy
                        </Button>
                      </div>
                    ) : null}
                    {entry.note ? <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p> : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {ticket.workspace ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>{ticket.workspace.name}</CardTitle>
              <CardDescription>
                {[ticket.workspace.plan ?? "No plan", ticket.workspace.mode, ticket.workspace.stage]
                  .filter(Boolean)
                  .join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                {ticket.workspace.walletMicros !== null && ticket.workspace.walletCurrency ? (
                  <Row label="Wallet">
                    {formatMoney(ticket.workspace.walletMicros, ticket.workspace.walletCurrency)}
                  </Row>
                ) : null}
                {ticket.workspace.trialEndsAt && ticket.workspace.mode === "trial" ? (
                  <Row label="Trial ends">{format(ticket.workspace.trialEndsAt, "d MMM yyyy")}</Row>
                ) : null}
              </dl>
              {ticket.workspace.channels.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {ticket.workspace.channels.map((channel) => (
                    <li key={channel._id} className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          channel.status === "active"
                            ? "bg-emerald-500"
                            : channel.status === "error"
                              ? "bg-destructive"
                              : "bg-muted-foreground"
                        )}
                      />
                      <span className="truncate">{channel.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{channel.type}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No channels connected.</p>
              )}
              {ticket.workspace.channels
                .filter((channel) => channel.lastError)
                .map((channel) => (
                  <p key={channel._id} className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    {channel.name}: {channel.lastError}
                  </p>
                ))}
            </CardContent>
          </Card>
        ) : null}

        {ticket.diagnostics || ticket.link ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Diagnostics</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                {ticket.link ? <Row label="About">{ticket.linkLabel ?? ticket.link}</Row> : null}
                {ticket.diagnostics?.page ? <Row label="Page">{ticket.diagnostics.page}</Row> : null}
                {ticket.diagnostics?.platform ? (
                  <Row label="Platform">
                    {ticket.diagnostics.platform}
                    {ticket.diagnostics.appVersion ? ` ${ticket.diagnostics.appVersion}` : ""}
                  </Row>
                ) : null}
                {ticket.diagnostics?.screen ? <Row label="Screen">{ticket.diagnostics.screen}</Row> : null}
                {ticket.diagnostics?.userAgent ? (
                  <>
                    <dt className="text-muted-foreground">Browser</dt>
                    <dd className="break-words">{ticket.diagnostics.userAgent}</dd>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        ) : null}

        {ticket.related.length > 0 || modifies ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Other tickets from this workspace</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {ticket.related.map((other) => (
                <Link key={other._id} href={`/admin/support/${other._id}`} className="flex items-center gap-2 hover:underline">
                  <span className="text-xs text-muted-foreground tabular-nums">{ticketRef(other.number)}</span>
                  <span className="min-w-0 flex-1 truncate">{other.subject}</span>
                  <StatusBadge status={other.status} staff />
                </Link>
              ))}
              {modifies && ACTIVE_STATUSES.includes(ticket.status) ? (
                <div className="mt-1 flex gap-2">
                  <Input
                    placeholder="Merge into #"
                    inputMode="numeric"
                    value={mergeInto}
                    onChange={(event) => setMergeInto(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!/^#?\d+$/.test(mergeInto.trim())}
                    onClick={async () => {
                      try {
                        const result = await merge({ ticketId, intoNumber: Number(mergeInto.replace("#", "")) });
                        toast.add({ title: "Merged", type: "success" });
                        router.push(`/admin/support/${result.ticketId}`);
                      } catch (error) {
                        toast.add({ title: "Could not merge", description: friendlyError(error), type: "error" });
                      }
                    }}
                  >
                    Merge
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </aside>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask for access</DialogTitle>
            <DialogDescription>
              The client gets a push and an email and picks how long to allow. Say what you will look at.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="I need to check your WhatsApp channel settings and the agent's routing."
            value={askNote}
            onChange={(event) => setAskNote(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              disabled={!askNote.trim()}
              onClick={async () => {
                if (await attempt(() => requestAccess({ ticketId, note: askNote }), "Request sent")) {
                  setAsking(false);
                  setAskNote("");
                }
              }}
            >
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={override} onOpenChange={setOverride}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open without the client&apos;s grant?</DialogTitle>
            <DialogDescription>
              Your role reaches this workspace, but the client has not granted access on this ticket.
              The visit and your reason are logged and shown to them.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride(false)}>
              Cancel
            </Button>
            <Button
              disabled={!reason.trim()}
              onClick={() => {
                void openWorkspace(reason.trim());
                setOverride(false);
                setReason("");
              }}
            >
              Open and log it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
