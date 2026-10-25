"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { TableSkeleton } from "@/components/skeletons";
import { SelectField } from "@/components/select-field";
import { useHourBucket } from "@/components/use-now";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BubbleChatIcon,
  Cancel01Icon,
  FloppyDiskIcon,
  PencilEdit02Icon,
  RoboticIcon,
  Search01Icon,
  SignpostIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { formatDistanceToNow } from "date-fns";
import { friendlyError } from "@/lib/errors";
import {
  CHANNEL_LABEL,
  ChannelGlyph,
  type ChannelKind,
} from "@/components/channel-mark";

/** A contacts row: the document plus the conversation it belongs to. */
type ContactRow = {
  _id: Id<"contacts">;
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  remark?: string;
  externalId: string;
  channelType: ChannelKind;
  lastSeenAt: number;
  conversationId: Id<"conversations"> | null;
  messageCount: number;
  handledBy: string | null;
  conversationStatus: "open" | "escalated" | "closed" | null;
  /** Where the follow-up desk filed the latest conversation. */
  leadStage: { name: string; outcome: "open" | "won" | "lost" } | null;
  /** One entry per record book this person has something filed in. */
  records: Array<{
    bookId: string;
    stage: string | null;
    reference: string;
    count: number;
  }>;
};

// A web visitor's id is a random string, which is no use as a label.
function displayName(contact: ContactRow): string {
  if (contact.name?.trim()) return contact.name;
  if (contact.phone?.trim()) return contact.phone;
  if (contact.channelType === "web") {
    return `Web visitor ${contact.externalId.slice(-4)}`;
  }
  if (contact.channelType === "instagram" || contact.channelType === "telegram") {
    return `${CHANNEL_LABEL[contact.channelType]} user ${contact.externalId.slice(-4)}`;
  }
  return contact.externalId;
}

function Blank() {
  return <span className="text-muted-foreground">—</span>;
}

/**
 * The lead stage, as a badge that says which way it went.
 *
 * Only the two terminal outcomes get a colour. An open stage is the normal
 * case and there are as many of them as the workspace cares to define, so
 * tinting each one would need the leads page's whole palette out here to say
 * nothing the name does not already.
 */
function StageBadge({ stage }: { stage: NonNullable<ContactRow["leadStage"]> }) {
  return (
    <Badge
      variant={
        stage.outcome === "won"
          ? "default"
          : stage.outcome === "lost"
            ? "destructive"
            : "secondary"
      }
      className="max-w-full truncate"
      title={`Lead stage · ${stage.name}`}
    >
      {stage.name}
    </Badge>
  );
}

/**
 * What this person has in one record book: the stage their latest record is
 * at, and how many of them there are.
 *
 * A book with no stages — plenty are a thing that happened rather than a thing
 * in progress — reads "Filed", because "there is one" is still the answer to
 * the question the column asks. The reference is not shown: it is the string a
 * customer quotes back, not a status, and it belongs on the record itself. It
 * stays searchable from the box above.
 */
function RecordCell({
  row,
}: {
  row: ContactRow["records"][number] | undefined;
}) {
  if (!row) return <Blank />;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Badge variant="outline" className="max-w-full truncate">
        {row.stage ?? "Filed"}
      </Badge>
      {row.count > 1 ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          ×{row.count}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------

type Draft = {
  name: string;
  phone: string;
  email: string;
  company: string;
  remark: string;
};

function ContactDialog({
  contact,
  trigger,
}: {
  contact: ContactRow;
  trigger: React.ReactElement;
}) {
  const updateContact = useMutation(api.contacts.update);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    name: contact.name ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    company: contact.company ?? "",
    remark: contact.remark ?? "",
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      await updateContact({ contactId: contact._id, ...draft });
      toast.add({ title: "Contact saved", type: "success" });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{displayName(contact)}</DialogTitle>
          <DialogDescription>
            Agents pick up the name, phone, email and company when they talk to
            this person. The remark is for your team only and is never shown to
            the customer — it is also where the follow-up desk records why it
            messaged them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-name">Name</Label>
              <Input
                id="ct-name"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-phone">Phone</Label>
              <Input
                id="ct-phone"
                value={draft.phone}
                onChange={(event) => set("phone", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-email">Email</Label>
              <Input
                id="ct-email"
                type="email"
                value={draft.email}
                onChange={(event) => set("email", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-company">Company</Label>
              <Input
                id="ct-company"
                value={draft.company}
                onChange={(event) => set("company", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-remark">Remark</Label>
            <Textarea
              id="ct-remark"
              rows={3}
              placeholder="Notes about this contact"
              value={draft.remark}
              onChange={(event) => set("remark", event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

// Filter options. "all" is the no-filter sentinel, as on Orders and
// Conversations.
const CHANNELS = [
  { value: "all", label: "All channels" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "rcs", label: "RCS" },
  { value: "telegram", label: "Telegram" },
  { value: "web", label: "Website" },
];

const KINDS: readonly string[] = ["whatsapp", "instagram", "rcs", "telegram", "web"];

// The conversation's status, not the contact's — a contact has no state of its
// own. "none" picks out the people who have never sent a message, which is a
// real thing to want and which none of the three statuses can express.
const STATUSES = [
  { value: "all", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "escalated", label: "Escalated" },
  { value: "closed", label: "Resolved" },
  { value: "none", label: "Never messaged" },
];

const WINDOWS = [
  { value: "all", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50;

// The lead stage filter's fixed entries. The stages themselves are appended at
// render, since a workspace renames and adds to them.
const ANY_STAGE = { value: "all", label: "Any stage" };
const NO_STAGE = { value: "none", label: "Not filed yet" };

export default function ContactsPage() {
  const workspace = useWorkspace();
  const base = `/w/${workspace.slug}`;
  // A column per book, named by the workspace. The same names-only query the
  // sidebar reads, so this costs nothing extra on a page that already has it.
  const books = useQuery(api.records.listBookLinks, {
    workspaceId: workspace._id,
  });
  const stages = useQuery(api.leads.listStages, { workspaceId: workspace._id });

  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [stage, setStage] = useState("all");
  const [seen, setSeen] = useState("all");
  // The last-seen window needs the clock, and a render must not read it
  // directly. Hour granularity is ample for a 24-hour bucket and keeps the
  // value stable within a render pass.
  const now = useHourBucket();

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const contacts = usePaginatedQuery(
    api.contacts.page,
    {
      workspaceId: workspace._id,
      search: search || undefined,
      channel: KINDS.includes(channel) ? (channel as ChannelKind) : undefined,
      status:
        status === "open" || status === "escalated" || status === "closed" || status === "none"
          ? status
          : undefined,
      stage: stage !== "all" ? stage : undefined,
      seenSince: seen !== "all" ? now - Number(seen) * DAY_MS : undefined,
    },
    { initialNumItems: PAGE_SIZE }
  );

  const rows = contacts.results as ContactRow[];
  const more = contacts.status === "CanLoadMore" || contacts.status === "LoadingMore";
  const loadMore = () => contacts.loadMore(PAGE_SIZE);

  const filtered =
    Boolean(searchDraft.trim()) ||
    channel !== "all" ||
    status !== "all" ||
    stage !== "all" ||
    seen !== "all";

  const clear = () => {
    setSearchDraft("");
    setSearch("");
    setChannel("all");
    setStatus("all");
    setStage("all");
    setSeen("all");
  };

  // Drawn even where no contact has a record in them yet: an empty column says
  // the book exists and nobody is in it, which is the thing worth knowing.
  const columns = books ?? [];

  const stageOptions = useMemo(
    () => [
      ANY_STAGE,
      ...(stages ?? []).map((row) => ({ value: row.name, label: row.name })),
      NO_STAGE,
    ],
    [stages]
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Contacts
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          People who have talked to your agents, who owns them, and what your
          team needs to remember.
        </p>
      </header>

      {/* No visible field labels, unlike the one- and two-filter pages: four of
          them would run the row wider than the table. Each select's resting
          option names its own dimension instead — "All channels", "Anyone",
          "Any status", "Any time" — with an aria-label for anyone who cannot
          see that. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs min-w-56">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchDraft}
            placeholder="Search name, number, owner or remark…"
            className="pl-7"
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </div>

        <SelectField
          aria-label="Filter by channel"
          value={channel}
          onValueChange={setChannel}
          options={CHANNELS}
        />

        <SelectField
          aria-label="Filter by conversation status"
          value={status}
          onValueChange={setStatus}
          options={STATUSES}
        />

        <SelectField
          aria-label="Filter by lead stage"
          value={stage}
          onValueChange={setStage}
          options={stageOptions}
        />

        <SelectField
          aria-label="Filter by when the contact was last seen"
          value={seen}
          onValueChange={setSeen}
          options={WINDOWS}
        />

        {filtered ? (
          <Button variant="ghost" onClick={clear}>
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /> Clear
          </Button>
        ) : null}

        {/* Which of the two shapes this takes is the cue that a filter is on,
            once the row itself has scrolled out of sight. */}
        <span className="ml-auto text-sm tabular-nums text-muted-foreground">
          {more
            ? `${rows.length} loaded so far`
            : filtered
              ? `${rows.length} match${rows.length === 1 ? "" : "es"}`
              : `${rows.length} contact${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {contacts.status === "LoadingFirstPage" ? (
        <TableSkeleton rows={8} columns={7 + columns.length} />
      ) : rows.length === 0 && more ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>No matches yet</EmptyTitle>
            <EmptyDescription>Only part of your contacts has been checked so far.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              disabled={contacts.status === "LoadingMore"}
              onClick={loadMore}
            >
              {contacts.status === "LoadingMore" ? <Spinner /> : null} Keep looking
            </Button>
          </EmptyContent>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={UserMultipleIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>
              {filtered ? "No contacts match" : "No contacts yet"}
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Nothing here matches every filter at once. Widen one, or clear them all."
                : "Contacts appear here once someone talks to your agent on WhatsApp or the website widget."}
            </EmptyDescription>
          </EmptyHeader>
          {filtered ? (
            <EmptyContent>
              <Button variant="outline" onClick={clear}>
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /> Clear filters
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Name</TableHead>
                <TableHead className="min-w-40">Phone / Email</TableHead>
                <TableHead className="hidden lg:table-cell min-w-28">Handled by</TableHead>
                <TableHead className="min-w-28">Lead stage</TableHead>
                {columns.map((book) => (
                  <TableHead key={book._id} className="hidden lg:table-cell min-w-32">
                    {book.pluralName}
                  </TableHead>
                ))}
                <TableHead className="hidden xl:table-cell min-w-52">Remark</TableHead>
                <TableHead className="hidden md:table-cell min-w-24 text-right">
                  Last seen
                </TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((contact) => (
                <TableRow key={contact._id}>
                  <TableCell className="max-w-56 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="text-muted-foreground"
                        title={
                          contact.channelType === "web"
                            ? "Website widget"
                            : CHANNEL_LABEL[contact.channelType]
                        }
                      >
                        <ChannelGlyph type={contact.channelType} />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {displayName(contact)}
                        </span>
                        {contact.company ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {contact.company}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col text-sm">
                      {contact.phone ? <span>{contact.phone}</span> : null}
                      {contact.email ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {contact.email}
                        </span>
                      ) : null}
                      {!contact.phone && !contact.email ? <Blank /> : null}
                    </div>
                  </TableCell>

                  <TableCell className="hidden lg:table-cell text-sm">
                    {/* Not stored — this is whichever agent the conversation's
                        last handoff left in charge. */}
                    {contact.handledBy ? (
                      <span className="flex items-center gap-1.5">
                        <HugeiconsIcon icon={RoboticIcon} strokeWidth={2} className="size-3.5 text-muted-foreground" />
                        {contact.handledBy}
                      </span>
                    ) : (
                      <Blank />
                    )}
                  </TableCell>

                  <TableCell className="max-w-40 min-w-0">
                    {contact.leadStage ? (
                      <StageBadge stage={contact.leadStage} />
                    ) : contact.conversationId ? (
                      <span
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                        title="The desk reads a conversation an hour after it goes quiet."
                      >
                        <HugeiconsIcon icon={SignpostIcon} strokeWidth={2} className="size-3.5" /> Not reviewed
                      </span>
                    ) : (
                      <Blank />
                    )}
                  </TableCell>

                  {columns.map((book) => (
                    <TableCell
                      key={book._id}
                      className="hidden lg:table-cell max-w-40 min-w-0"
                    >
                      <RecordCell
                        row={contact.records.find(
                          (row) => row.bookId === book._id
                        )}
                      />
                    </TableCell>
                  ))}

                  <TableCell className="hidden xl:table-cell max-w-64 min-w-0">
                    {contact.remark ? (
                      <span
                        className="line-clamp-2 text-sm text-muted-foreground"
                        title={contact.remark}
                      >
                        {contact.remark}
                      </span>
                    ) : (
                      <Blank />
                    )}
                  </TableCell>

                  <TableCell className="hidden md:table-cell text-right text-xs whitespace-nowrap text-muted-foreground">
                    {formatDistanceToNow(contact.lastSeenAt, {
                      addSuffix: true,
                    })}
                  </TableCell>

                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {contact.conversationId ? (
                        <Button
                          size="icon-lg"
                          variant="ghost"
                          aria-label={`Open the conversation with ${displayName(contact)}`}
                          title={`Open conversation · ${contact.messageCount} messages`}
                          nativeButton={false}
                          render={
                            <Link
                              href={`${base}/conversations?c=${contact.conversationId}`}
                            />
                          }
                        >
                          <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
                        </Button>
                      ) : (
                        <Button
                          size="icon-lg"
                          variant="ghost"
                          aria-label="No conversation yet"
                          title="This contact has not sent a message yet"
                          disabled
                        >
                          <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} />
                        </Button>
                      )}
                      <ContactDialog
                        contact={contact}
                        trigger={
                          <Button
                            size="icon-lg"
                            variant="ghost"
                            aria-label={`Edit ${displayName(contact)}`}
                          >
                            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {more ? (
            <div className="flex justify-center border-t p-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={contacts.status === "LoadingMore"}
                onClick={loadMore}
              >
                {contacts.status === "LoadingMore" ? <Spinner /> : null} Show more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
