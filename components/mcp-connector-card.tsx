"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { McpToolGroup } from "@/mcp/server.mjs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  PaperPlaneTiltIcon,
  PlugsConnectedIcon,
  ProhibitIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

const CAN = [
  "Read agents, the catalogue, knowledge, channels and custom tools",
  "Read conversations, contacts, orders, records and leads",
  "Read notification, marketing and usage reports",
  "Reply to a customer in an existing conversation",
];

const CANNOT = [
  "Create, edit or delete agents, products, knowledge or channels",
  "Change settings, alerts, lead stages or marketing",
  "Send broadcasts or templates, or start new conversations",
  "Reach any other workspace",
];

async function copy(text: string, title = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title, type: "success" });
  } catch {
    toast.add({
      title: "Copy failed",
      description: "Select the text and copy it manually.",
      type: "error",
    });
  }
}

function Steps({ items, note }: { items: string[]; note?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={item} className="flex gap-3 text-sm">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
              {index + 1}
            </span>
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ol>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button size="sm" variant="ghost" onClick={() => void copy(code)}>
          <CopyIcon /> Copy
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}

function when(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "truncate font-mono text-sm" : "truncate text-sm"}>
        {value}
      </span>
    </div>
  );
}

function Permissions() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <EyeIcon className="size-4 text-primary" /> It can
        </p>
        <ul className="flex flex-col gap-1.5">
          {CAN.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-muted-foreground">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              {line}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ProhibitIcon className="size-4 text-destructive" /> It cannot
        </p>
        <ul className="flex flex-col gap-1.5">
          {CANNOT.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-muted-foreground">
              <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ToolList() {
  const [groups, setGroups] = useState<McpToolGroup[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/mcp/catalogue")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<McpToolGroup[]>;
      })
      .then((data) => live && setGroups(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const total = groups?.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="group/tools -ml-2 text-muted-foreground"
          />
        }
      >
        <CaretRightIcon className="transition-transform group-data-panel-open/tools:rotate-90" />
        Every tool it gets
        {total ? <Badge variant="secondary">{total}</Badge> : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-3">
          {failed ? (
            <p className="text-sm text-muted-foreground">
              Could not load the tool list.
            </p>
          ) : !groups ? (
            <Spinner />
          ) : (
            <div className="flex flex-col divide-y rounded-lg border">
              {groups.map((group) => (
                <div
                  key={group.title}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-4"
                >
                  <p className="shrink-0 text-xs font-medium sm:w-28 sm:pt-0.5">
                    {group.title}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {group.tools.map((tool) => (
                      <Badge
                        key={tool.name}
                        variant={tool.readOnly ? "secondary" : "default"}
                        className="font-mono text-[11px]"
                        title={tool.description}
                      >
                        {tool.readOnly ? null : <PaperPlaneTiltIcon />}
                        {tool.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The workspace's MCP connector.
 *
 * One URL, which is itself the credential: a connector form — claude.ai's,
 * ChatGPT's — has a URL field and nowhere to put a header, so the token lives
 * in the path. It is shown once, only its hash is stored, and rotating stops
 * the old URL working immediately.
 */
export function McpConnectorCard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: Id<"workspaces">;
  workspaceName: string;
}) {
  const connector = useQuery(api.authDb.mcpConnector, { workspaceId });
  const issue = useAction(api.auth.issueMcpToken);
  const revoke = useAction(api.auth.revokeMcpToken);

  const [busy, setBusy] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    try {
      const result = await issue({ workspaceId });
      const origin =
        typeof window === "undefined" ? "" : window.location.origin;
      setFreshUrl(`${origin}/api/mcp/${result.token}`);
      toast.add({
        title: connector ? "Connector rotated" : "Connector created",
        description: connector
          ? "The previous URL stopped working immediately."
          : "Copy the URL now — it is not shown again.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not create the connector",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <PlugsConnectedIcon className="size-4" />
          Connect an AI assistant
          <Badge variant="outline">
            <EyeIcon /> Read-only
          </Badge>
          <Badge variant="outline">
            <PaperPlaneTiltIcon /> Can reply
          </Badge>
        </CardTitle>
        <CardDescription>
          Let Claude, ChatGPT or another assistant look into {workspaceName}{" "}
          and answer customers in their conversations. It reads everything here
          but cannot create, change or delete anything.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <Permissions />

        {freshUrl ? (
          <Alert>
            <WarningIcon />
            <AlertTitle>Copy this now — it is not shown again</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                This URL is the credential. Anyone holding it can read this
                workspace and message its customers, so paste it into your
                assistant and nowhere else.
              </span>
              <div className="flex w-full gap-2">
                <Input
                  readOnly
                  value={freshUrl}
                  className="font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  size="icon-lg"
                  variant="outline"
                  aria-label="Copy the connector URL"
                  onClick={() => void copy(freshUrl, "URL copied")}
                >
                  <CopyIcon />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3">
          <Label>Connector</Label>
          {connector === undefined ? (
            <Spinner />
          ) : connector === null ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">No connector yet</p>
                <p className="text-sm text-muted-foreground">
                  Create one to get a private URL for your assistant.
                </p>
              </div>
              <Button onClick={() => void generate()} disabled={busy}>
                {busy ? <Spinner /> : <PlugsConnectedIcon />} Create the
                connector
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-primary" />
                  <span className="text-sm font-medium">Active</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void generate()}
                    disabled={busy}
                  >
                    {busy ? <Spinner /> : <ArrowsClockwiseIcon />} Rotate
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button size="sm" variant="ghost">
                          <TrashIcon /> Revoke
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke the connector?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The URL stops working at once and any assistant using
                          it loses access to {workspaceName}. Nothing else
                          changes — create a new connector whenever you want
                          one.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel
                          render={<Button variant="ghost">Cancel</Button>}
                        />
                        <AlertDialogAction
                          render={
                            <Button
                              variant="destructive"
                              onClick={async () => {
                                await revoke({ workspaceId });
                                setFreshUrl(null);
                                toast.add({
                                  title: "Connector revoked",
                                  type: "success",
                                });
                              }}
                            >
                              Revoke
                            </Button>
                          }
                        />
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Fact label="Token" value={`${connector.prefix}…`} mono />
                <Fact label="Created" value={when(connector.issuedAt)} />
                <Fact label="Last used" value={when(connector.lastUsedAt)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Lost the URL? It cannot be read back — only its hash is stored.
                Rotate to get a new one.
              </p>
            </div>
          )}
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <Label>Where are you adding it?</Label>
          <Tabs defaultValue="claude">
            <TabsList className="w-full">
              <TabsTrigger value="claude">Claude.ai</TabsTrigger>
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="code">Claude Code</TabsTrigger>
              <TabsTrigger value="other">Other</TabsTrigger>
            </TabsList>

            <TabsContent value="claude" className="pt-4">
              <Steps
                items={[
                  "Customize → Connectors → “+” → Add custom connector.",
                  "Paste the URL. Leave the OAuth fields under Advanced empty — the token in the URL is the credential.",
                  "Add it, enable it in a new chat and ask “show my latest conversations”.",
                ]}
                note="On Team and Enterprise an Owner adds it under Organization settings → Connectors first, and members then enable it."
              />
            </TabsContent>

            <TabsContent value="chatgpt" className="pt-4">
              <Steps
                items={[
                  "Settings → Connectors → Create.",
                  "Name it, keep Connection on “Server URL”, and paste the URL.",
                  "Leave Authentication on “No Auth”, tick the risk acknowledgement, then Create.",
                ]}
                note="This endpoint speaks Streamable HTTP, the current MCP transport, and also opens an event stream on GET."
              />
            </TabsContent>

            <TabsContent value="code" className="flex flex-col gap-2 pt-4">
              <Snippet
                label="Run this once"
                code={`claude mcp add --transport http magic-agent ${
                  freshUrl ?? "<your connector URL>"
                }`}
              />
              <p className="text-xs text-muted-foreground">
                Add <span className="font-mono">--scope user</span> to reach it
                from every project rather than this one.
              </p>
            </TabsContent>

            <TabsContent value="other" className="pt-4">
              <Steps
                items={[
                  "Add it as a remote MCP server over Streamable HTTP.",
                  "No headers and no OAuth: the token in the path is the whole credential.",
                  "POST carries the calls; GET opens the event stream.",
                ]}
              />
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">
            The assistant reaches this URL from its own servers, so it has to be
            a public address — no connector will reach{" "}
            <span className="font-mono">localhost</span>.
          </p>
        </div>

        <Separator />

        <ToolList />
      </CardContent>
    </Card>
  );
}
