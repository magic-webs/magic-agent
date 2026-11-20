"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  Attachment01Icon,
  Cancel01Icon,
  Delete02Icon,
  File01Icon,
  PlusSignIcon,
  Shield01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { WhatsAppText } from "@/components/whatsapp-text";
import { GenieMark } from "@/components/genie-mark";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Thread = NonNullable<FunctionReturnType<typeof api.genie.thread>>;
type Item = Thread["items"][number];
type Attachment = { key: string; name: string; mime: string };
type Turn = { kind: "user"; item: Item } | { kind: "genie"; items: Item[] };

const SUGGESTIONS = [
  "Set up my business",
  "Explain how my agents work",
  "What can't my agents answer?",
  "How did this week go?",
  "Add a product",
  "Test my front desk",
];

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

export default function GeniePage() {
  const workspace = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("chat") as Id<"genieThreads"> | null;
  const [threadId, setThreadId] = useState<Id<"genieThreads"> | null>(requested);

  const threads = useQuery(api.genie.threads, { workspaceId: workspace._id });
  const thread = useQuery(api.genie.thread, threadId ? { threadId } : "skip");

  const open = (id: Id<"genieThreads"> | null) => {
    setThreadId(id);
    router.replace(id ? `${pathname}?chat=${id}` : pathname);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 lg:flex">
        <div className="p-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => open(null)}>
            <HugeiconsIcon icon={PlusSignIcon} />
            New chat
          </Button>
        </div>
        <p className="px-4 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Recent
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {threads?.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Your chats with Genie will be kept here.
            </p>
          ) : null}
          {threads?.map((row) => (
            <button
              key={row._id}
              onClick={() => open(row._id)}
              className={cn(
                "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted",
                row._id === threadId && "bg-muted"
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm">{row.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {row.status === "waiting"
                    ? "Waiting for approval"
                    : row.status === "working"
                      ? "Working…"
                      : formatDistanceToNow(row.updatedAt, { addSuffix: true })}
                </span>
              </span>
              {row.status === "waiting" ? (
                <span className="size-2 shrink-0 rounded-full bg-amber-500" />
              ) : row.status === "working" ? (
                <Spinner className="size-3 shrink-0" />
              ) : null}
            </button>
          ))}
        </div>
      </aside>

      <Conversation
        key={threadId ?? "new"}
        threadId={threadId}
        thread={threadId ? thread : null}
        onCreated={open}
        onNew={() => open(null)}
      />
    </div>
  );
}

function Conversation({
  threadId,
  thread,
  onCreated,
  onNew,
}: {
  threadId: Id<"genieThreads"> | null;
  thread: Thread | null | undefined;
  onCreated: (id: Id<"genieThreads">) => void;
  onNew: () => void;
}) {
  const workspace = useWorkspace();
  const send = useMutation(api.genie.send);
  const decide = useMutation(api.genie.decide);
  const stop = useMutation(api.genie.stop);
  const setAutoApprove = useMutation(api.genie.setAutoApprove);
  const remove = useMutation(api.genie.remove);

  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draftAuto, setDraftAuto] = useState(false);
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="m-auto flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-10 sm:px-6">
          <GenieMark size={56} className="drop-shadow-[0_8px_20px_rgb(22_163_74/0.35)]" />
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
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                disabled={working}
                onClick={() => void submit(suggestion, [])}
                className="rounded-full border bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <GenieMark size={22} />
          <h1 className="truncate text-sm font-medium">{thread?.title ?? "Genie"}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" className="lg:hidden" onClick={onNew}>
            <HugeiconsIcon icon={PlusSignIcon} />
            New
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
              <GenieMark size={28} className="animate-pulse" />
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
