"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { copyText } from "@/components/notifications/shared";
import {
  guessTarget,
  savedTarget,
  targetOptions,
  type MappingRow,
} from "@/convex/lib/recordMapping";
import { SelectField } from "@/components/select-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  FloppyDiskIcon,
  RefreshIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import { friendlyError } from "@/lib/errors";

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

type SamplePath = { path: string; sample: string };

function InboundMapping({
  book,
  paths,
  mapping,
  sampleAt,
  capturing,
}: {
  book: Doc<"recordBooks">;
  paths: SamplePath[];
  mapping: MappingRow[];
  sampleAt: number | null;
  capturing: boolean;
}) {
  const save = useMutation(api.recordIntake.saveInboundMapping);
  const capture = useMutation(api.recordIntake.captureInboundSample);
  const options = useMemo(() => targetOptions(book), [book]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const savedFor = (path: string) => savedTarget(book, mapping, path);
  const targetFor = (path: string) =>
    edits[path] ?? savedFor(path) ?? guessTarget(book, path);
  const dirty =
    Object.keys(edits).length > 0 || paths.some(({ path }) => !savedFor(path));

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) toast.add({ title: done, type: "success" });
    } catch (error) {
      toast.add({ title: friendlyError(error, "Failed."), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const saveAll = () =>
    run(async () => {
      await save({
        bookId: book._id,
        mapping: [
          ...paths.map(({ path }) => ({ source: path, target: targetFor(path) })),
          ...mapping.filter((row) => !paths.some(({ path }) => path === row.source)),
        ],
      });
      setEdits({});
    }, "Mapping saved");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <HugeiconsIcon icon={Target02Icon} strokeWidth={2} className="size-4 text-muted-foreground" /> Field mapping
          </p>
          <p className="text-xs text-muted-foreground">
            {capturing
              ? "Waiting for the next call — it becomes the sample below."
              : sampleAt
                ? `From the sample taken ${formatDistanceToNow(sampleAt, { addSuffix: true })}. Pick where each value goes.`
                : "Send one call to the URL — its values show up here to map."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {capturing ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => capture({ bookId: book._id, capture: false }))}
            >
              Cancel
            </Button>
          ) : sampleAt ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => capture({ bookId: book._id, capture: true }))}
            >
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} /> Capture new sample
            </Button>
          ) : null}
          {paths.length ? (
            <Button size="sm" disabled={busy || !dirty} onClick={() => void saveAll()}>
              {busy ? <Spinner /> : <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} />} Save mapping
            </Button>
          ) : null}
        </div>
      </div>

      {paths.length ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead className="hidden sm:table-cell">Sample</TableHead>
                <TableHead>Goes to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paths.map(({ path, sample }) => (
                <TableRow key={path}>
                  <TableCell className="max-w-48 truncate font-mono text-xs">{path}</TableCell>
                  <TableCell className="hidden max-w-48 truncate text-xs text-muted-foreground sm:table-cell">
                    {sample || "—"}
                  </TableCell>
                  <TableCell>
                    <SelectField
                      size="sm"
                      aria-label={`Where ${path} goes`}
                      className="w-52"
                      value={targetFor(path)}
                      onValueChange={(next) => setEdits((prev) => ({ ...prev, [path]: next }))}
                      options={options}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {paths.length && dirty ? (
        <p className="text-xs text-muted-foreground">
          Not saved yet — until it is, calls are matched by key name only.
        </p>
      ) : null}
    </div>
  );
}

export function InboundWebhookCard({ book }: { book: Doc<"recordBooks"> }) {
  const settings = useQuery(api.recordIntake.inboundSettings, { bookId: book._id });
  const setEnabled = useMutation(api.recordIntake.setInboundEnabled);
  const rotate = useMutation(api.recordIntake.rotateInboundKey);
  const [busy, setBusy] = useState<"toggle" | "rotate" | null>(null);

  const run = async (kind: "toggle" | "rotate", work: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await work();
    } catch (error) {
      toast.add({ title: friendlyError(error, "Failed."), type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const example = JSON.stringify(
    Object.fromEntries([
      ["name", "Asha Rao"],
      ["phone", "+91 98765 43210"],
      ...book.fields.slice(0, 3).map((field) => [field.key, field.example ?? field.label]),
    ]),
    null,
    2
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Receive from elsewhere</CardTitle>
            <CardDescription>
              Another system — a website form, a booking tool, your CRM — POSTs
              JSON or a form to this URL, and each call files a{" "}
              {book.name.toLowerCase()} here.
            </CardDescription>
          </div>
          {settings ? (
            <div className="flex shrink-0 items-center gap-2">
              {busy === "toggle" ? <Spinner /> : null}
              <Switch
                checked={settings.enabled}
                aria-label="Take records from the URL"
                disabled={busy !== null}
                onCheckedChange={(checked) =>
                  void run("toggle", () => setEnabled({ bookId: book._id, enabled: checked }))
                }
              />
              <span className="text-sm">{settings.enabled ? "On" : "Off"}</span>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {settings === undefined ? (
          <Spinner />
        ) : !settings.url ? (
          <p className="text-sm text-muted-foreground">
            Switch it on to get this book&apos;s URL.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">
                {settings.url}
              </code>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Copy URL"
                onClick={() => void copyText(settings.url ?? "", "URL")}
              >
                <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run("rotate", () => rotate({ bookId: book._id }))}
              >
                {busy === "rotate" ? <Spinner /> : <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />} New URL
              </Button>
            </div>
            <InboundMapping
              book={book}
              paths={settings.samplePaths}
              mapping={settings.mapping}
              sampleAt={settings.sampleAt}
              capturing={settings.capturing}
            />
            <p className="text-xs text-muted-foreground">
              Keys without a mapping are matched to this book&apos;s fields by key or label;{" "}
              <code>name</code>, <code>phone</code>, <code>email</code> and{" "}
              <code>company</code> fill in the person, and a <code>stage</code>{" "}
              or <code>notes</code> key sets those. Anything else is kept as an
              extra detail.
              {settings.count ? ` ${settings.count} filed so far.` : ""}
              {settings.lastInboundAt
                ? ` Last call ${formatDistanceToNow(settings.lastInboundAt, { addSuffix: true })}.`
                : ""}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Example body</p>
                <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
                  {example}
                </pre>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">Sample</p>
                <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
                  {settings.lastInboundPayload
                    ? prettyJson(settings.lastInboundPayload)
                    : "Nothing yet."}
                </pre>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
