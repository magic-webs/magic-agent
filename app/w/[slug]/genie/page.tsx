"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  Attachment01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  Delete02Icon,
  File01Icon,
  Link01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  RefreshIcon,
  PlusSignIcon,
  Search01Icon,
  Shield01Icon,
  SidebarLeft01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { WhatsAppText } from "@/components/whatsapp-text";
import { GenieMark } from "@/components/genie-mark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Thread = NonNullable<FunctionReturnType<typeof api.genie.thread>>;
type Item = Thread["items"][number];
type Attachment = { key: string; name: string; mime: string };
type Turn = { kind: "user"; item: Item } | { kind: "genie"; items: Item[] };

const SUGGESTIONS = [
  "Set up my business",
  "Explain my agents",
  "What can't my agents answer?",
  "How did this week go?",
  "Add a product",
  "Test my front desk",
  "Rewrite an agent's prompt",
  "Summarise today's chats",
  "Set up an order alert",
  "Fix wrong answers",
  "Draft a festival greeting",
  "Show unpaid orders",
  "Create a record book",
  "Tidy my lead stages",
  "Add our refund policy",
  "What's waiting on me?",
];
const SHOWN = 4;

function errorText(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "That did not go through. Try again.";
}

/** Genie writes Markdown; the WhatsApp renderer already handles lists and code. */
function toChatText(markdown: string) {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

function details(json: string | null) {
  if (!json) return [];
  try {
    const value = JSON.parse(json) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as const);
    }
  } catch {
    /* shown raw below */
  }
  return [["input", json] as const];
}

function toTurns(items: Item[]): Turn[] {
  const turns: Turn[] = [];
  for (const item of items) {
    if (item.kind === "user") {
      turns.push({ kind: "user", item });
      continue;
    }
    const last = turns.at(-1);
    if (last?.kind === "genie") last.items.push(item);
    else turns.push({ kind: "genie", items: [item] });
  }
  return turns;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const COLLAPSED_KEY = "genie.chatsCollapsed";
const collapseListeners = new Set<() => void>();
let collapsedInMemory: boolean | null = null;

function readCollapsed() {
  if (collapsedInMemory !== null) return collapsedInMemory;
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  collapsedInMemory = value;
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* kept for this visit only */
  }
  for (const listener of collapseListeners) listener();
}

function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  return () => {
    collapseListeners.delete(listener);
  };
}
const DAY = 24 * 60 * 60 * 1000;

type ThreadRow = FunctionReturnType<typeof api.genie.threads>[number];

function shortTime(at: number, now: number) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function groupThreads(rows: ThreadRow[], now: number) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const buckets: { label: string; after: number; rows: ThreadRow[] }[] = [
    { label: "Today", after: start, rows: [] },
    { label: "Yesterday", after: start - DAY, rows: [] },
    { label: "Previous 7 days", after: start - 7 * DAY, rows: [] },
    { label: "Previous 30 days", after: start - 30 * DAY, rows: [] },
    { label: "Older", after: -Infinity, rows: [] },
  ];
  for (const row of rows) {
    buckets.find((bucket) => row.updatedAt >= bucket.after)!.rows.push(row);
  }
  return buckets.filter((bucket) => bucket.rows.length > 0);
}

export default function GeniePage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("chat") as Id<"genieThreads"> | null;
  const [threadId, setThreadId] = useState<Id<"genieThreads"> | null>(requested);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [drawer, setDrawer] = useState(false);

  const threads = useQuery(api.genie.threads, { workspaceId: workspace._id });
  const thread = useQuery(api.genie.thread, threadId ? { threadId } : "skip");

  const collapse = writeCollapsed;

  const open = (id: Id<"genieThreads"> | null) => {
    setThreadId(id);
    setDrawer(false);
    router.replace(id ? `${pathname}?chat=${id}` : pathname);
  };

  const showChats = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) collapse(false);
    else setDrawer(true);
  };

  const list = (
    <ChatList threads={threads} activeId={threadId} onOpen={open} onCollapse={() => collapse(true)} />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {collapsed ? null : (
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/30 lg:flex">{list}</aside>
      )}

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 p-0">
          <SheetTitle className="sr-only">Chats with Genie</SheetTitle>
          {list}
        </SheetContent>
      </Sheet>

      <Conversation
        key={threadId ?? "new"}
        threadId={threadId}
        thread={threadId ? thread : null}
        chatsHidden={collapsed}
        onShowChats={showChats}
        onCreated={open}
        onNew={() => open(null)}
      />
    </div>
  );
}

function ChatList({
  threads,
  activeId,
  onOpen,
  onCollapse,
}: {
  threads: ThreadRow[] | undefined;
  activeId: Id<"genieThreads"> | null;
  onOpen: (id: Id<"genieThreads"> | null) => void;
  onCollapse: () => void;
}) {
  const remove = useMutation(api.genie.remove);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<ThreadRow | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const term = search.trim().toLowerCase();
  const rows = (threads ?? []).filter((row) => !term || row.title.toLowerCase().includes(term));
  const pinned = rows.filter((row) => row.pinned);
  const groups = [
    ...(pinned.length ? [{ label: "Pinned", rows: pinned }] : []),
    ...groupThreads(
      rows.filter((row) => !row.pinned),
      now
    ),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex items-center gap-2">
          <GenieMark size={20} />
          <span className="text-sm font-semibold">Chats</span>
        </div>
        <div className="flex items-center">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="New chat"
            title="New chat"
            onClick={() => onOpen(null)}
          >
            <HugeiconsIcon icon={PlusSignIcon} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Hide chats"
            title="Hide chats"
            className="hidden text-muted-foreground lg:inline-flex"
            onClick={onCollapse}
          >
            <HugeiconsIcon icon={SidebarLeft01Icon} />
          </Button>
        </div>
      </div>

      {threads && threads.length > 4 ? (
        <div className="px-3 pt-3">
          <label className="flex h-8 items-center gap-2 rounded-lg border bg-background px-2.5 text-sm focus-within:border-foreground/20">
            <HugeiconsIcon icon={Search01Icon} className="size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search chats"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-4">
        {threads === undefined ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-4" />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <HugeiconsIcon icon={BubbleChatIcon} className="size-6 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              Your chats with Genie are kept here, private to your login.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No chats match.</p>
        ) : null}

        {groups.map((group) => (
          <section key={group.label} className="mt-2 first:mt-0">
            <p className="px-2.5 pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.rows.map((row) => (
                <ChatRow
                  key={row._id}
                  row={row}
                  active={row._id === activeId}
                  now={now}
                  onOpen={() => onOpen(row._id)}
                  onDelete={() => setDeleting(row)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.title}&rdquo; and everything in it is removed. Changes
              Genie already made to your workspace stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!deleting) return;
                const id = deleting._id;
                setDeleting(null);
                await remove({ threadId: id });
                if (id === activeId) onOpen(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChatRow({
  row,
  active,
  now,
  onOpen,
  onDelete,
}: {
  row: ThreadRow;
  active: boolean;
  now: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const rename = useMutation(api.genie.rename);
  const setPinned = useMutation(api.genie.setPinned);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    setEditing(false);
    const next = name.trim();
    if (next && next !== row.title) await rename({ threadId: row._id, title: next });
    else setName(row.title);
  };

  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("chat", row._id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to undo */
    }
  };

  if (editing) {
    return (
      <li className="rounded-lg bg-background px-1.5 py-1.5 ring-1 ring-ring/40">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") {
              setName(row.title);
              setEditing(false);
            }
          }}
          maxLength={80}
          aria-label="Chat name"
          className="w-full bg-transparent px-1 text-[13px] outline-none"
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group relative flex items-center rounded-lg transition-colors",
        active ? "bg-background shadow-xs ring-1 ring-border" : "hover:bg-muted",
        menuOpen && !active && "bg-muted"
      )}
    >
      <button
        onClick={onOpen}
        onDoubleClick={() => setEditing(true)}
        className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-9 pl-3 text-left"
      >
        {row.status === "waiting" ? (
          <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Waiting for your approval" />
        ) : row.status === "working" ? (
          <Spinner className="size-3 shrink-0" />
        ) : null}
        <span className={cn("min-w-0 flex-1 truncate text-[13px]", active && "font-medium")}>
          {copied ? "Link copied" : row.title}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px] text-muted-foreground tabular-nums transition-opacity group-hover:opacity-0",
            menuOpen && "opacity-0"
          )}
        >
          {shortTime(row.updatedAt, now)}
        </span>
      </button>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              aria-label={`Options for ${row.title}`}
              className={cn(
                "absolute right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-foreground/5 hover:text-foreground",
                menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              )}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
            </button>
          }
        />
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onClick={() => void setPinned({ threadId: row._id, pinned: !row.pinned })}>
            <HugeiconsIcon icon={row.pinned ? PinOffIcon : PinIcon} />
            {row.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <HugeiconsIcon icon={PencilEdit02Icon} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void copyLink()}>
            <HugeiconsIcon icon={Link01Icon} />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <HugeiconsIcon icon={Delete02Icon} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function Conversation({
  threadId,
  thread,
  chatsHidden,
  onShowChats,
  onCreated,
  onNew,
}: {
  threadId: Id<"genieThreads"> | null;
  thread: Thread | null | undefined;
  chatsHidden: boolean;
  onShowChats: () => void;
  onCreated: (id: Id<"genieThreads">) => void;
  onNew: () => void;
}) {
  const workspace = useWorkspace();
  const send = useMutation(api.genie.send);
  const decide = useMutation(api.genie.decide);
  const stop = useMutation(api.genie.stop);
  const setAutoApprove = useMutation(api.genie.setAutoApprove);
  const remove = useMutation(api.genie.remove);

  const chatsButton = (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Show chats"
      title="Show chats"
      className={cn("text-muted-foreground", !chatsHidden && "lg:hidden")}
      onClick={onShowChats}
    >
      <HugeiconsIcon icon={SidebarLeft01Icon} />
    </Button>
  );

  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draftAuto, setDraftAuto] = useState(false);
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState(0);
  const shown = SUGGESTIONS.slice(page * SHOWN, page * SHOWN + SHOWN);
  const bottom = useRef<HTMLDivElement>(null);

  const items = thread?.items ?? [];
  const turns = toTurns(items);
  const working = thread?.status === "working" || sending;
  const pending = items.filter((item) => item.state === "pending");
  const autoApprove = thread ? thread.autoApprove : draftAuto;
  const empty = !threadId || thread === null;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, thread?.status]);

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const submit = async (text: string, attachments: Attachment[]) => {
    if (working) return false;
    setError(null);
    setSending(true);
    try {
      const id = await send({
        workspaceId: workspace._id,
        ...(threadId ? { threadId } : { autoApprove: draftAuto }),
        text,
        attachments,
      });
      if (!threadId) onCreated(id);
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    } finally {
      setSending(false);
    }
  };

  const toggleAuto = () => {
    if (thread) void act(() => setAutoApprove({ threadId: thread._id, autoApprove: !thread.autoApprove }));
    else setDraftAuto((value) => !value);
  };

  const composer = (
    <Composer
      key={threadId ?? "new"}
      busy={working}
      autoApprove={autoApprove}
      onToggleAuto={toggleAuto}
      onSubmit={submit}
      placeholder={
        pending.length
          ? "Approve the change above, or tell Genie what to do instead…"
          : "Ask Genie to build an agent, add products, set up an alert…"
      }
    />
  );

  if (empty) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="absolute top-2 left-2">{chatsButton}</div>
        <div className="m-auto flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-10 sm:px-6">
          <div className="space-y-2 text-center">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              How can Genie help, {workspace.ownerName ?? workspace.name}?
            </h1>
            <p className="text-sm text-muted-foreground">
              Build agents, add products, answer knowledge gaps, set up alerts or
              check how things are going.
            </p>
          </div>
          <div className="w-full">{composer}</div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {shown.map((suggestion) => (
              <button
                key={suggestion}
                disabled={working}
                onClick={() => void submit(suggestion, [])}
                className="animate-in rounded-full border bg-background px-4 py-2 text-sm text-muted-foreground transition-colors fade-in-0 hover:border-foreground/20 hover:text-foreground disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
            <button
              aria-label="Show other suggestions"
              title="Show other suggestions"
              onClick={() => {
                setTurn((value) => value + 1);
                setPage((value) => (value + 1) % Math.ceil(SUGGESTIONS.length / SHOWN));
              }}
              className="flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className="size-4 transition-transform duration-500"
                style={{ transform: `rotate(${turn * 180}deg)` }}
              />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {chatsButton}
          <GenieMark size={22} />
          <h1 className="truncate text-sm font-medium">{thread?.title ?? "Genie"}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className={cn(!chatsHidden && "lg:hidden")}
            onClick={onNew}
          >
            <HugeiconsIcon icon={PlusSignIcon} />
            New chat
          </Button>
          {thread ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete this chat"
              className="text-muted-foreground"
              onClick={() =>
                void act(async () => {
                  await remove({ threadId: thread._id });
                  onNew();
                })
              }
            >
              <HugeiconsIcon icon={Delete02Icon} />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
          {thread === undefined ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : null}

          {turns.map((turn) =>
            turn.kind === "user" ? (
              <UserTurn key={turn.item._id} item={turn.item} />
            ) : (
              <GenieTurn
                key={turn.items[0]._id}
                items={turn.items}
                onDecide={(itemId, approve) =>
                  void act(() => decide({ threadId: thread!._id, itemId, approve }))
                }
              />
            )
          )}

          {working ? (
            <div className="flex items-center gap-3">
              <GenieMark size={28} />
              <span className="text-sm text-muted-foreground">Genie is working…</span>
              {thread ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void act(() => stop({ threadId: thread._id }))}
                >
                  <HugeiconsIcon icon={StopIcon} />
                  Stop
                </Button>
              ) : null}
            </div>
          ) : null}

          {thread?.status === "failed" && thread.error ? (
            <div className="ml-10 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" />
              {thread.error}
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {pending.length > 1 ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <span>{plural(pending.length, "change is", "changes are")} waiting for you.</span>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void act(() => decide({ threadId: thread!._id, approve: false }))}
                >
                  Decline all
                </Button>
                <Button
                  size="xs"
                  onClick={() => void act(() => decide({ threadId: thread!._id, approve: true }))}
                >
                  Approve all
                </Button>
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {composer}
        </div>
      </div>
    </div>
  );
}

function Composer({
  busy,
  autoApprove,
  onToggleAuto,
  onSubmit,
  placeholder,
}: {
  busy: boolean;
  autoApprove: boolean;
  onToggleAuto: () => void;
  onSubmit: (text: string, attachments: Attachment[]) => Promise<boolean>;
  placeholder: string;
}) {
  const workspace = useWorkspace();
  const uploadUrl = useMutation(api.knowledge.generateUploadUrl);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const ready = (draft.trim() || files.length > 0) && !busy && !uploading;

  const go = async () => {
    if (!ready) return;
    if (await onSubmit(draft, files)) {
      setDraft("");
      setFiles([]);
    }
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(list).slice(0, 5 - files.length)) {
        const target = await uploadUrl({ workspaceId: workspace._id });
        const mime = file.type || "application/octet-stream";
        const response = await fetch(target.url, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: file,
        });
        if (!response.ok) throw new Error(String(response.status));
        added.push({ key: target.key, name: file.name, mime });
      }
      setFiles((current) => [...current, ...added]);
    } catch {
      setUploadError("That file could not be uploaded.");
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:border-foreground/20 focus-within:shadow-md">
      {files.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {files.map((file) => (
            <span
              key={file.key}
              className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs"
            >
              <HugeiconsIcon icon={File01Icon} className="size-3.5 text-muted-foreground" />
              <span className="max-w-44 truncate">{file.name}</span>
              <button
                aria-label={`Remove ${file.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setFiles((list) => list.filter((f) => f.key !== file.key))}
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void go();
          }
        }}
        placeholder={placeholder}
        rows={2}
        className="block max-h-52 min-h-16 w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] outline-none [field-sizing:content] placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1 px-2 pt-1 pb-2">
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          accept="image/*,.pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx"
          onChange={(event) => void attach(event.target.files)}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Attach files"
          className="text-muted-foreground"
          disabled={uploading || files.length >= 5}
          onClick={() => picker.current?.click()}
        >
          {uploading ? <Spinner className="size-4" /> : <HugeiconsIcon icon={Attachment01Icon} />}
        </Button>
        <button
          onClick={onToggleAuto}
          title={
            autoApprove
              ? "Genie makes changes straight away. Deleting still asks."
              : "Genie asks before it changes anything."
          }
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
            autoApprove
              ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <HugeiconsIcon icon={Shield01Icon} className="size-3.5" />
          {autoApprove ? "Auto-apply" : "Approval required"}
        </button>
        {uploadError ? <span className="ml-1 text-xs text-destructive">{uploadError}</span> : null}
        <Button
          size="icon-sm"
          aria-label="Send"
          className="ml-auto rounded-full"
          disabled={!ready}
          onClick={() => void go()}
        >
          <HugeiconsIcon icon={ArrowUp02Icon} />
        </Button>
      </div>
    </div>
  );
}

function UserTurn({ item }: { item: Item }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {item.attachments.length ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {item.attachments.map((file) => (
            <span
              key={file.key}
              className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              <HugeiconsIcon icon={File01Icon} className="size-3.5" />
              {file.name}
            </span>
          ))}
        </div>
      ) : null}
      {item.text ? (
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[15px] whitespace-pre-wrap">
          {item.text}
        </div>
      ) : null}
    </div>
  );
}

function GenieTurn({
  items,
  onDecide,
}: {
  items: Item[];
  onDecide: (itemId: Id<"genieItems">, approve: boolean) => void;
}) {
  const steps = items.filter((item) => item.kind === "action" && item.state !== "pending");
  const replies = items.filter((item) => item.kind === "reply");
  const pending = items.filter((item) => item.state === "pending");

  return (
    <div className="flex gap-3">
      <GenieMark size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-3">
        {steps.length ? <Steps steps={steps} /> : null}
        {replies.map((reply) => (
          <div key={reply._id} className="text-[15px] leading-relaxed">
            <WhatsAppText text={toChatText(reply.text)} />
          </div>
        ))}
        {pending.map((item) => (
          <ApprovalCard
            key={item._id}
            item={item}
            onDecide={(approve) => onDecide(item._id as Id<"genieItems">, approve)}
          />
        ))}
      </div>
    </div>
  );
}

function Steps({ steps }: { steps: Item[] }) {
  const [open, setOpen] = useState(false);
  const lookups = steps.filter((step) => step.readOnly).length;
  const changes = steps.filter((step) => !step.readOnly && step.state === "done").length;
  const failed = steps.filter((step) => step.state === "failed").length;
  const running = steps.some((step) => step.state === "approved");

  const summary = [
    lookups ? `looked at ${plural(lookups, "thing", "things")}` : null,
    changes ? `made ${plural(changes, "change", "changes")}` : null,
    failed ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="text-sm">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        {running ? <Spinner className="size-3.5" /> : null}
        <span className="first-letter:uppercase">{summary || "Worked on it"}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <ol className="mt-2 space-y-0.5 border-l pl-3">
          {steps.map((step) => (
            <Step key={step._id} step={step} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Step({ step }: { step: Item }) {
  const [open, setOpen] = useState(false);
  const dot =
    step.state === "failed"
      ? "bg-destructive"
      : step.state === "declined"
        ? "bg-muted-foreground/40"
        : step.state === "approved"
          ? "bg-amber-500 animate-pulse"
          : step.readOnly
            ? "bg-muted-foreground/50"
            : "bg-primary";
  const note =
    step.state === "failed"
      ? "failed"
      : step.state === "declined"
        ? "declined"
        : step.state === "approved"
          ? "running"
          : null;

  return (
    <li>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-muted"
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        <span className={cn("truncate", step.state === "declined" && "text-muted-foreground line-through")}>
          {step.text}
        </span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </button>
      {open && (step.input || step.output) ? (
        <div className="my-1 ml-5 space-y-1.5 rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
          {step.input ? <div>{step.input}</div> : null}
          {step.output ? <div className="text-muted-foreground">{step.output}</div> : null}
        </div>
      ) : null}
    </li>
  );
}

function ApprovalCard({ item, onDecide }: { item: Item; onDecide: (approve: boolean) => void }) {
  const rows = details(item.input);
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <span className="size-2 rounded-full bg-amber-500" />
        <span className="text-xs font-medium text-muted-foreground">Needs your approval</span>
      </div>
      <div className="space-y-3 px-4 py-3">
        <p className="font-medium">{item.text}</p>
        {rows.length ? (
          <dl className="grid gap-1.5 text-[13px]">
            {rows.slice(0, 12).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="truncate text-muted-foreground">{key}</dt>
                <dd className="line-clamp-4 break-words whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-2.5">
        <Button size="sm" variant="ghost" onClick={() => onDecide(false)}>
          Decline
        </Button>
        <Button size="sm" onClick={() => onDecide(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}
