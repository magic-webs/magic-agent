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
  CopyIcon,
  EyeIcon,
  PaperPlaneTiltIcon,
  PlugsConnectedIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { friendlyError } from "@/lib/errors";

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

function Steps({ items }: { items: string[] }) {
  return (
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
          Lets an assistant read {workspaceName} and reply in its
          conversations. It cannot change anything.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {freshUrl ? (
          <Alert>
            <WarningIcon />
            <AlertTitle>Copy this now — it is not shown again</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>Anyone with this URL can read this workspace.</span>
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
              <p className="text-sm text-muted-foreground">No connector yet</p>
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
                  "Paste the URL, leave OAuth empty.",
                  "Enable it in a chat.",
                ]}
              />
            </TabsContent>

            <TabsContent value="chatgpt" className="pt-4">
              <Steps
                items={[
                  "Settings → Connectors → Create.",
                  "Paste the URL as the Server URL.",
                  "Authentication: No Auth, then Create.",
                ]}
              />
            </TabsContent>

            <TabsContent value="code" className="pt-4">
              <Snippet
                label="Run once"
                code={`claude mcp add --transport http magic-agent ${
                  freshUrl ?? "<your connector URL>"
                }`}
              />
            </TabsContent>

            <TabsContent value="other" className="pt-4">
              <Steps
                items={[
                  "Add it as a remote MCP server (Streamable HTTP).",
                  "No headers or OAuth needed.",
                ]}
              />
            </TabsContent>
          </Tabs>

        </div>

        <Separator />

        <ToolList />
      </CardContent>
    </Card>
  );
}
