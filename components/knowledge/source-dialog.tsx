"use client";

import { useState } from "react";
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
  FloppyDiskIcon,
  PencilSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

export const STATUS_VARIANT = {
  pending: "secondary",
  processing: "secondary",
  ready: "default",
  failed: "destructive",
} as const;

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
  onSaved,
}: {
  sourceId: Id<"knowledgeSources">;
  agents: { _id: Id<"agents">; name: string }[] | undefined;
  className?: string;
  label?: string;
  onSaved?: (result: { reindexing: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Skip the read entirely until the dialog is opened.
  const detail = useQuery(api.knowledge.get, open ? { sourceId } : "skip");
  const updateSource = useMutation(api.knowledge.updateSource);
  const setScope = useMutation(api.knowledge.setScope);

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
      toast.add({
        title: "Saved",
        description: result.reindexing
          ? "The text changed, so the source is being re-embedded."
          : undefined,
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
          <Button variant="outline" className={className}>
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
                <Textarea
                  id="source-text"
                  rows={14}
                  className="font-mono"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </div>
            ) : null}

            <Accordion>
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
                          className="rounded-md border p-2 text-xs"
                        >
                          <p className="mb-1 font-mono text-muted-foreground">
                            #{chunk.order + 1} · {chunk.text.length} chars
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
