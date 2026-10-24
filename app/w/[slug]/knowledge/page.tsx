"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { CardGridSkeleton } from "@/components/skeletons";
import {
  BooksIcon,
  PlusIcon,
  TrashIcon,
  ArrowsClockwiseIcon,
  FileTextIcon,
  LinkIcon,
  QuestionIcon,
  UploadIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";
import { putFile } from "@/lib/upload";
import { KnowledgeGaps } from "@/components/knowledge/knowledge-gaps";
import { SourceDialog, STATUS_VARIANT } from "@/components/knowledge/source-dialog";

const KIND_ICONS = {
  text: FileTextIcon,
  faq: QuestionIcon,
  url: LinkIcon,
  file: UploadIcon,
} as const;


function AddSourceDialog() {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const addSource = useMutation(api.knowledge.addSource);
  const generateUploadUrl = useMutation(api.knowledge.generateUploadUrl);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string>("all");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const agentId = scope === "all" ? undefined : (scope as Id<"agents">);

  const reset = () => {
    setTitle("");
    setText("");
    setUrl("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitText = async (kind: "text" | "faq") => {
    if (!text.trim()) {
      toast.add({ title: "Paste some content first", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await addSource({
        workspaceId: workspace._id,
        agentId,
        title: title || (kind === "faq" ? "FAQ" : "Pasted notes"),
        kind,
        rawText: text,
        tags: [],
      });
      toast.add({
        title: "Source queued for embedding",
        description: "It becomes searchable as soon as processing finishes.",
        type: "success",
      });
      reset();
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not add the source",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const submitUrl = async () => {
    if (!url.trim()) {
      toast.add({ title: "Enter a URL", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await addSource({
        workspaceId: workspace._id,
        agentId,
        title: title || url,
        kind: "url",
        url,
        tags: [],
      });
      toast.add({ title: "Fetching and embedding the page", type: "success" });
      reset();
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not add the URL",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.add({ title: "Choose a file first", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const fileKey = await putFile(
        await generateUploadUrl({ workspaceId: workspace._id }),
        file
      );

      await addSource({
        workspaceId: workspace._id,
        agentId,
        title: title || file.name,
        kind: "file",
        fileKey,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        tags: [],
      });

      toast.add({ title: `${file.name} uploaded`, type: "success" });
      reset();
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Upload failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><PlusIcon /> Add source</Button>} />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a knowledge source</DialogTitle>
          <DialogDescription>
            Content is split into passages and indexed so agents can retrieve
            from it on every message.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="src-title">Title</Label>
            <Input
              id="src-title"
              value={title}
              placeholder="Title"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="src-scope">Available to</Label>
            <SelectField
              id="src-scope"
              className="w-full"
              value={scope}
              onValueChange={setScope}
              options={[
                { value: "all", label: "Every agent in this workspace" },
                ...(agents ?? []).map((agent) => ({
                  value: agent._id as string,
                  label: `Only ${agent.botName} (${agent.name})`,
                })),
              ]}
            />
          </div>
        </div>

        <Tabs defaultValue="text">
          <TabsList className="w-full">
            <TabsTrigger value="text">
              <FileTextIcon /> Paste text
            </TabsTrigger>
            <TabsTrigger value="faq">
              <QuestionIcon /> FAQ
            </TabsTrigger>
            <TabsTrigger value="url">
              <LinkIcon /> URL
            </TabsTrigger>
            <TabsTrigger value="file">
              <UploadIcon /> File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="flex flex-col gap-3 pt-3">
            <Textarea
              rows={9}
              value={text}
              placeholder="Paste policies, product guidance, pricing rules the team follows, tone examples…"
              onChange={(event) => setText(event.target.value)}
            />
            <Button onClick={() => submitText("text")} disabled={busy}>
              {busy ? <Spinner /> : <PlusIcon />} Add and embed
            </Button>
          </TabsContent>

          <TabsContent value="faq" className="flex flex-col gap-3 pt-3">
            <Textarea
              rows={9}
              value={text}
              placeholder={
                "Q: Question\nA: Answer\n\nQ: Question\nA: Answer"
              }
              onChange={(event) => setText(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Separate each Q/A pair with a blank line so they chunk cleanly.
            </p>
            <Button onClick={() => submitText("faq")} disabled={busy}>
              {busy ? <Spinner /> : <PlusIcon />} Add and embed
            </Button>
          </TabsContent>

          <TabsContent value="url" className="flex flex-col gap-3 pt-3">
            <Input
              value={url}
              placeholder="Page address"
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The page is fetched once and its text extracted. Re-run
              &ldquo;Reprocess&rdquo; later to pick up changes.
            </p>
            <Button onClick={submitUrl} disabled={busy}>
              {busy ? <Spinner /> : <LinkIcon />} Fetch and embed
            </Button>
          </TabsContent>

          <TabsContent value="file" className="flex flex-col gap-3 pt-3">
            <Input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown,.csv,.json,.html"
              className="h-auto py-1.5"
            />
            <p className="text-xs text-muted-foreground">
              PDF, plain text, Markdown, CSV, JSON and HTML. Scanned
              image-only PDFs have no extractable text — paste the content
              instead.
            </p>
            <Button onClick={submitFile} disabled={busy}>
              {busy ? <Spinner /> : <UploadIcon />} Upload and embed
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgePage() {
  const workspace = useWorkspace();
  const sources = useQuery(api.knowledge.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const openGaps = useQuery(api.knowledgeGaps.openCount, {
    workspaceId: workspace._id,
  });
  const reprocess = useMutation(api.knowledge.reprocess);
  const removeSource = useMutation(api.knowledge.remove);

  const totalChunks = (sources ?? []).reduce(
    (sum, source) => sum + source.chunkCount,
    0
  );
  const failed = (sources ?? []).filter((s) => s.status === "failed");

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Knowledge base
          </h1>
          {/* Not "0 chunks across 0 sources" while the query is in flight —
              that is a wrong number, not a loading state. */}
          {sources === undefined ? (
            <Skeleton className="mt-1.5 h-3.5 w-44" />
          ) : (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {totalChunks} chunks across {sources.length} sources.
            </p>
          )}
        </div>
        <AddSourceDialog />
      </header>

      <Separator />

      <Tabs defaultValue="sources" className="gap-4">
        <TabsList>
          <TabsTrigger value="sources">
            <BooksIcon /> Sources
          </TabsTrigger>
          <TabsTrigger value="gaps">
            <QuestionIcon /> Knowledge gaps
            {openGaps ? (
              <Badge variant="destructive" className="ml-1">
                {openGaps >= 100 ? "99+" : openGaps}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gaps">
          <KnowledgeGaps />
        </TabsContent>

        <TabsContent value="sources" className="flex flex-col gap-5">
          {failed.length > 0 ? (
            <Alert variant="destructive">
              <WarningIcon />
              <AlertTitle>
                {failed.length} source{failed.length === 1 ? "" : "s"} failed to
                process
              </AlertTitle>
              <AlertDescription>
                {failed[0].failureReason ?? "See the source below for details."}
              </AlertDescription>
            </Alert>
          ) : null}

          {sources === undefined ? (
            <CardGridSkeleton count={6} />
          ) : sources.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BooksIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing indexed yet</EmptyTitle>
                <EmptyDescription>
                  Add what your team answers from — policies, product guidance,
                  tone examples.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <AddSourceDialog />
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sources.map((source) => {
                const Icon = KIND_ICONS[source.kind];
                // What the source actually is, rather than a slice of its text: the
                // title already says the subject, and the body is one click away.
                const origin =
                  source.url ??
                  source.filename ??
                  `${source.charCount.toLocaleString()} characters`;
                return (
                  <Card key={source._id} className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="flex min-w-0 items-start gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Icon className="size-4" />
                        </span>
                        <span className="line-clamp-2 min-w-0 flex-1">
                          {source.title}
                        </span>
                        <Badge
                          variant={STATUS_VARIANT[source.status]}
                          className="shrink-0"
                        >
                          {source.status}
                        </Badge>
                      </CardTitle>
                    </CardHeader>

                    <CardContent className="flex min-w-0 flex-1 flex-col gap-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">{source.kind}</Badge>
                        {source.chunkCount > 0 ? (
                          <Badge variant="secondary">
                            {source.chunkCount} chunks
                          </Badge>
                        ) : null}
                        <Badge variant="secondary">
                          {source.agentName ? `Only ${source.agentName}` : "Every agent"}
                        </Badge>
                      </div>

                      {source.status === "failed" ? (
                        <p className="line-clamp-2 text-sm text-destructive">
                          {source.failureReason}
                        </p>
                      ) : (
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {origin}
                        </p>
                      )}

                      <div className="mt-auto flex gap-1 pt-1">
                        <SourceDialog
                          sourceId={source._id}
                          agents={agents}
                          className="flex-1"
                        />
                        <Button
                          size="icon-lg"
                          variant="outline"
                          aria-label="Reprocess"
                          onClick={async () => {
                            await reprocess({ sourceId: source._id });
                            toast.add({ title: "Reprocessing", type: "info" });
                          }}
                        >
                          <ArrowsClockwiseIcon />
                        </Button>
                        <Button
                          size="icon-lg"
                          variant="outline"
                          aria-label="Delete source"
                          onClick={async () => {
                            await removeSource({ sourceId: source._id });
                            toast.add({ title: "Source deleted", type: "success" });
                          }}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
