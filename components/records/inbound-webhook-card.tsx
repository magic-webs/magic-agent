"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { copyText } from "@/components/notifications/shared";
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
import { ArrowsClockwiseIcon, CopyIcon } from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
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
                <CopyIcon />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run("rotate", () => rotate({ bookId: book._id }))}
              >
                {busy === "rotate" ? <Spinner /> : <ArrowsClockwiseIcon />} New URL
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Keys are matched to this book&apos;s fields by key or label;{" "}
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
                <p className="text-xs font-medium text-muted-foreground">Last call received</p>
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
