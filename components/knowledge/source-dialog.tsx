"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { SelectField } from "@/components/select-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CursorTextIcon,
  FloppyDiskIcon,
  PencilSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export const STATUS_VARIANT = {
  pending: "secondary",
  processing: "secondary",
  ready: "default",
  failed: "destructive",
} as const;

/**
 * Where a chunk sits in the raw text it was cut from. Chunking collapses runs
 * of spaces and joins paragraphs, so the chunk is not a literal substring: its
 * opening and closing words are matched with any whitespace between them.
 */
function locate(raw: string, passage: string): [number, number] | null {
  const pattern = (part: string) =>
    part
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
  const head = passage.trim().slice(0, 60);
  const tail = passage.trim().slice(-60);
  const start = new RegExp(pattern(head.replace(/\s+\S*$/, "") || head)).exec(raw);
  if (!start) return null;
  const end = new RegExp(pattern(tail.replace(/^\S*\s+/, "") || tail)).exec(raw.slice(start.index));
  return end
    ? [start.index, start.index + end.index + end[0].length]
    : [start.index, start.index + start[0].length];
}

/** Ranges sorted and merged, so overlapping passages paint as one mark. */
function merge(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * A textarea with ranges of its text painted behind it. A textarea cannot
 * style part of its value, so an identical copy of the text sits underneath in
 * transparent ink, carrying the marks, and follows the textarea's scroll.
 */
function HighlightedTextarea({
  value,
  ranges,
  onChange,
  textareaRef,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  ranges: [number, number][];
  onChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of merge(ranges)) {
    parts.push(value.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-destructive/30 text-transparent">
        {value.slice(start, end)}
      </mark>
    );
    at = end;
  }
  parts.push(value.slice(at));

  return (
    <div className="relative">
      <div
        ref={backdrop}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent px-2.5 py-2 font-mono text-base wrap-break-word whitespace-pre-wrap text-transparent md:text-sm dark:bg-input/30"
      >
        {parts}
        {"\n"}
      </div>
      <Textarea
        {...props}
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop;
        }}
        className="relative font-mono dark:bg-transparent"
      />
    </div>
  );
}

/**
 * View a source's full content and the chunks the agents actually retrieve,
 * and edit it in place.
 *
 * The list query only carries a short preview, so the body is fetched with
 * knowledge.get when the dialog opens.
 */
export function SourceDialog({
  sourceId,
  agents,
  className,
  label = "View & edit",
  needsUpdate = false,
  onSaved,
}: {
  sourceId: Id<"knowledgeSources">;
  agents: { _id: Id<"agents">; name: string }[] | undefined;
  className?: string;
  label?: string;
  /** Answers built from this source were marked wrong. */
  needsUpdate?: boolean;
  onSaved?: (result: { reindexing: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Skip the read entirely until the dialog is opened.
  const detail = useQuery(api.knowledge.get, open ? { sourceId } : "skip");
  const updateSource = useMutation(api.knowledge.updateSource);
  const setScope = useMutation(api.knowledge.setScope);
  const resolveForSource = useMutation(api.knowledgeGaps.resolveForSource);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope_] = useState("all");
  // Which source the fields were last filled from, so a fetch fills them once
  // rather than overwriting what is being typed on every re-render.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (detail?.source && loadedFor !== detail.source._id) {
    setLoadedFor(detail.source._id);
    setTitle(detail.source.title);
    setText(detail.source.rawText ?? "");
    setUrl(detail.source.url ?? "");
    setScope_(detail.source.agentId ?? "all");
  }

  const source = detail?.source;
  const editableText = source?.kind === "text" || source?.kind === "faq";
  const flagged = detail?.flaggedPassages ?? [];
  const marks = flagged
    .map((passage) => locate(text, passage.text))
    .filter((range): range is [number, number] => range !== null);

  const selectPassage = (passage: string) => {
    const range = locate(text, passage);
    const field = textRef.current;
    if (!range || !field) {
      toast.add({ title: "That passage is no longer in the text", type: "info" });
      return;
    }
    field.focus();
    field.setSelectionRange(range[0], range[1]);
    const line = text.slice(0, range[0]).split("\n").length - 1;
    field.scrollTop = Math.max(0, line * 20 - field.clientHeight / 3);
  };

  const save = async () => {
    if (!source) return;
    setSaving(true);
    try {
      const result = await updateSource({
        sourceId,
        title,
        ...(editableText ? { rawText: text } : {}),
        ...(source.kind === "url" ? { url } : {}),
      });
      if ((source.agentId ?? "all") !== scope) {
        await setScope({
          sourceId,
          agentId: scope === "all" ? undefined : (scope as Id<"agents">),
        });
      }
      const fixed =
        result.reindexing && flagged.length > 0
          ? (await resolveForSource({ sourceId })).fixed
          : 0;
      toast.add({
        title: "Saved",
        description: [
          result.reindexing ? "The text changed, so the source is being re-embedded." : null,
          fixed ? `${fixed} wrong ${fixed === 1 ? "answer" : "answers"} marked as fixed.` : null,
        ]
          .filter(Boolean)
          .join(" ") || undefined,
        type: "success",
      });
      setOpen(false);
      onSaved?.({ reindexing: result.reindexing });
    } catch (error) {
      toast.add({
        title: "Could not save",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Re-read from the server next time rather than showing a stale draft.
        if (!next) setLoadedFor(null);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            className={cn(needsUpdate && "border-destructive/50 text-destructive", className)}
          >
            <PencilSimpleIcon /> {label}
          </Button>
        }
      />
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col overflow-y-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>View and edit source</DialogTitle>
          <DialogDescription>
            {editableText
              ? "Editing the text re-embeds the source. Retrieval falls back to the other sources until it finishes."
              : "The body comes from the file or URL, so only the title and scope are editable here."}
          </DialogDescription>
        </DialogHeader>

        {detail === undefined ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : !source ? (
          <Alert variant="destructive">
            <WarningIcon />
            <AlertTitle>Source not found</AlertTitle>
            <AlertDescription>It may have been deleted.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[source.status]}>
                {source.status}
              </Badge>
              <Badge variant="outline">{source.kind}</Badge>
              <Badge variant="secondary">
                {detail.chunks.length} embedded{" "}
                {detail.chunks.length === 1 ? "chunk" : "chunks"}
              </Badge>
              <Badge variant="secondary">
                {source.charCount.toLocaleString()} characters
              </Badge>
            </div>

            {source.status === "failed" && source.failureReason ? (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>Processing failed</AlertTitle>
                <AlertDescription className="font-mono text-xs">
                  {source.failureReason}
                </AlertDescription>
              </Alert>
            ) : null}

            {flagged.length > 0 ? (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>
                  {flagged.length === 1
                    ? "This passage gave a wrong answer"
                    : `These ${flagged.length} passages gave wrong answers`}
                </AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <span>
                    {editableText
                      ? "Correct them in the content below. Saving re-embeds the source and marks the wrong answers as fixed."
                      : "Update the original, then reprocess the source."}
                  </span>
                  {flagged.map((passage) => (
                    <div
                      key={passage.text}
                      className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-foreground"
                    >
                      <p className="mb-1 font-mono text-muted-foreground">
                        Chunk #{passage.order + 1}
                      </p>
                      <p className="line-clamp-4 whitespace-pre-wrap">{passage.text}</p>
                      {passage.wrongReplies[0] ? (
                        <p className="mt-1.5 line-clamp-2 text-destructive">
                          Agent said: {passage.wrongReplies[0]}
                        </p>
                      ) : null}
                      {editableText ? (
                        <Button
                          size="xs"
                          variant="outline"
                          className="mt-1.5"
                          onClick={() => selectPassage(passage.text)}
                        >
                          <CursorTextIcon /> Select in text
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="source-title">Title</Label>
                <Input
                  id="source-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Available to</Label>
                <SelectField
                  value={scope}
                  onValueChange={setScope_}
                  options={[
                    { value: "all", label: "Every agent" },
                    ...(agents ?? []).map((agent) => ({
                      value: agent._id as string,
                      label: `Only ${agent.name}`,
                    })),
                  ]}
                />
              </div>
            </div>

            {source.kind === "url" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="source-url">URL</Label>
                <Input
                  id="source-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            ) : null}

            {source.kind === "file" ? (
              <p className="text-xs text-muted-foreground">
                File: <span className="font-mono">{source.filename}</span>
                {source.size
                  ? ` · ${Math.round(source.size / 1024).toLocaleString()} KB`
                  : ""}
              </p>
            ) : null}

            {editableText ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="source-text">Content</Label>
                <HighlightedTextarea
                  textareaRef={textRef}
                  id="source-text"
                  rows={14}
                  value={text}
                  ranges={marks}
                  onChange={setText}
                />
                {marks.length > 0 ? (
                  <p className="text-xs text-destructive">
                    Highlighted: the text the wrong {flagged.length === 1 ? "answer" : "answers"} came from.
                  </p>
                ) : null}
              </div>
            ) : null}

            <Accordion defaultValue={flagged.length > 0 ? ["chunks"] : []}>
              <AccordionItem value="chunks">
                <AccordionTrigger className="text-sm">
                  What the agents retrieve — {detail.chunks.length}{" "}
                  {detail.chunks.length === 1 ? "chunk" : "chunks"}
                </AccordionTrigger>
                <AccordionContent>
                  {detail.chunks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nothing embedded yet.
                      {source.status === "pending" || source.status === "processing"
                        ? " Processing is still running."
                        : ""}
                    </p>
                  ) : (
                    <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                      {detail.chunks.map((chunk) => (
                        <div
                          key={chunk._id}
                          className={cn(
                            "rounded-md border p-2 text-xs",
                            chunk.flagged && "border-destructive/50 bg-destructive/5"
                          )}
                        >
                          <p className="mb-1 font-mono text-muted-foreground">
                            #{chunk.order + 1} · {chunk.text.length} chars
                            {chunk.flagged ? (
                              <span className="ml-2 font-sans font-medium text-destructive">
                                gave a wrong answer
                              </span>
                            ) : null}
                          </p>
                          <p className="whitespace-pre-wrap">{chunk.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !source}>
            {saving ? <Spinner /> : <FloppyDiskIcon />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
