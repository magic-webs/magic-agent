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
  CheckmarkCircle02Icon,
  Delete02Icon,
  File01Icon,
  PlusSignIcon,
  SparklesIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { WhatsAppText } from "@/components/whatsapp-text";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Thread = NonNullable<FunctionReturnType<typeof api.genie.thread>>;
type Item = Thread["items"][number];
type Attachment = { key: string; name: string; mime: string };

const SUGGESTIONS = [
  "Set up my business",
  "Explain how my agents work",
  "What are customers asking that we can't answer?",
  "How did this week go?",
  "Add a product",
  "Run a test chat with my front desk",
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
      <aside className="hidden w-64 shrink-0 flex-col border-r lg:flex">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-sm font-medium">Chats</span>
          <Button size="sm" variant="outline" onClick={() => open(null)}>
            <HugeiconsIcon icon={PlusSignIcon} />
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {threads?.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              Your chats with Genie will be kept here.
            </p>
          ) : null}
          {threads?.map((row) => (
            <button
              key={row._id}
              onClick={() => open(row._id)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted",
                row._id === threadId && "bg-muted"
              )}
            >
              <span className="line-clamp-1 text-sm">{row.title}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {row.status === "waiting" ? (
                  <span className="size-1.5 rounded-full bg-amber-500" />
                ) : row.status === "working" ? (
                  <Spinner className="size-3" />
                ) : null}
                {formatDistanceToNow(row.updatedAt, { addSuffix: true })}
              </span>
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
  const uploadUrl = useMutation(api.knowledge.generateUploadUrl);

  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const items = thread?.items ?? [];
  const working = thread?.status === "working" || sending;
  const pending = items.filter((item) => item.state === "pending");

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, thread?.status]);

  const submit = async (text: string) => {
    if ((!text.trim() && files.length === 0) || working || uploading) return;
    setError(null);
    setSending(true);
    try {
      const id = await send({
        workspaceId: workspace._id,
        ...(threadId ? { threadId } : {}),
        text,
        attachments: files,
      });
      setDraft("");
      setFiles([]);
      if (!threadId) onCreated(id);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSending(false);
    }
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    setError(null);
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
      setError("That file could not be uploaded.");
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={SparklesIcon} className="size-5 text-primary" />
          <h1 className="truncate font-heading text-lg font-semibold tracking-tight">
            {thread?.title ?? "Genie"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {thread ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                size="sm"
                checked={thread.autoApprove}
                onCheckedChange={(autoApprove) =>
                  void act(() => setAutoApprove({ threadId: thread._id, autoApprove }))
                }
              />
              <span className="hidden sm:inline">Apply changes without asking</span>
              <span className="sm:hidden">Auto</span>
            </label>
          ) : null}
          {thread ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete this chat"
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
          <Button size="sm" variant="outline" className="lg:hidden" onClick={onNew}>
            <HugeiconsIcon icon={PlusSignIcon} />
            New
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6 sm:px-6">
          {threadId && thread === undefined ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : null}

          {!threadId || thread === null ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                <HugeiconsIcon icon={SparklesIcon} className="size-7 text-primary" />
              </div>
              <h2 className="font-heading text-2xl font-semibold tracking-tight">
                How can Genie help, {workspace.ownerName ?? workspace.name}?
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Ask Genie to build an agent, add products, answer knowledge gaps,
                set up alerts or check how things are going. Every change is
                shown to you before it runs.
              </p>
              <div className="mt-2 flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => void submit(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {items.map((item) => (
            <Entry
              key={item._id}
              item={item}
              onDecide={(approve) =>
                void act(() =>
                  decide({ threadId: thread!._id, itemId: item._id as Id<"genieItems">, approve })
                )
              }
            />
          ))}

          {working ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Genie is working…
              {thread ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void act(() => stop({ threadId: thread._id }))}
                >
                  <HugeiconsIcon icon={StopIcon} />
                  Stop
                </Button>
              ) : null}
            </div>
          ) : null}

          {thread?.status === "failed" && thread.error ? (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" />
              {thread.error}
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 border-t bg-background px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {pending.length > 1 ? (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm">
              <span>{pending.length} changes are waiting for you.</span>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
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
          {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
          {files.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((file) => (
                <span
                  key={file.key}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                >
                  <HugeiconsIcon icon={File01Icon} className="size-3.5" />
                  <span className="max-w-40 truncate">{file.name}</span>
                  <button
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((list) => list.filter((f) => f.key !== file.key))}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-xs">
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              accept="image/*,.pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx"
              onChange={(event) => void attach(event.target.files)}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Attach a file"
              disabled={uploading || files.length >= 5}
              onClick={() => picker.current?.click()}
            >
              {uploading ? <Spinner className="size-4" /> : <HugeiconsIcon icon={Attachment01Icon} />}
            </Button>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(draft);
                }
              }}
              placeholder={
                pending.length
                  ? "Approve the change above, or tell Genie what to do instead…"
                  : "Ask Genie to build an agent, add products, set up an alert…"
              }
              rows={1}
              className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <Button
              size="icon"
              aria-label="Send"
              disabled={working || uploading || (!draft.trim() && files.length === 0)}
              onClick={() => void submit(draft)}
            >
              <HugeiconsIcon icon={ArrowUp02Icon} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Entry({ item, onDecide }: { item: Item; onDecide: (approve: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);

  if (item.kind === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {item.attachments.length ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {item.attachments.map((file) => (
              <span
                key={file.key}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
              >
                <HugeiconsIcon icon={File01Icon} className="size-3.5" />
                {file.name}
              </span>
            ))}
          </div>
        ) : null}
        {item.text ? (
          <div className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
            {item.text}
          </div>
        ) : null}
      </div>
    );
  }

  if (item.kind === "reply") {
    return (
      <div className="max-w-full text-sm leading-relaxed">
        <WhatsAppText text={toChatText(item.text)} />
      </div>
    );
  }

  const rows = details(item.input);

  if (item.state === "pending") {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
            Needs approval
          </Badge>
          <span className="text-sm font-medium">{item.text}</span>
        </div>
        {rows.length ? (
          <dl className="mt-2 grid gap-1 text-xs">
            {rows.slice(0, 12).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[8rem_1fr] gap-2">
                <dt className="truncate text-muted-foreground">{key}</dt>
                <dd className="line-clamp-4 break-words whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => onDecide(true)}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} />
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide(false)}>
            Decline
          </Button>
        </div>
      </div>
    );
  }

  const tone =
    item.state === "failed"
      ? "text-destructive"
      : item.state === "declined"
        ? "text-muted-foreground line-through"
        : "text-muted-foreground";
  const label =
    item.state === "failed"
      ? "Failed"
      : item.state === "declined"
        ? "Declined"
        : item.state === "approved"
          ? "Running"
          : item.readOnly
            ? "Looked up"
            : "Done";

  return (
    <div className="text-xs">
      <button
        onClick={() => setExpanded((open) => !open)}
        className={cn("flex items-center gap-1.5 hover:text-foreground", tone)}
      >
        {item.state === "approved" ? (
          <Spinner className="size-3" />
        ) : (
          <HugeiconsIcon
            icon={item.state === "failed" ? Alert02Icon : CheckmarkCircle02Icon}
            className="size-3.5"
          />
        )}
        <span>
          {label} · {item.text}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn("size-3 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div className="mt-1.5 ml-5 space-y-1.5 rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
          {item.input ? <div>{item.input}</div> : null}
          {item.output ? <div className="text-muted-foreground">{item.output}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
