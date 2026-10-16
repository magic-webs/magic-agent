"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { friendlyError } from "@/lib/errors";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";

const STATUS_LABEL = {
  running: "Importing…",
  done: "Finished",
  failed: "Stopped",
  cancelled: "Cancelled",
} as const;

export function CrmImportDialog() {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const channels = useQuery(api.channels.inboxChannels, { workspaceId: workspace._id });
  const job = useQuery(api.crmImports.latest, { workspaceId: workspace._id });
  const start = useMutation(api.crmImports.start);
  const cancel = useMutation(api.crmImports.cancel);

  const whatsapp = (channels ?? []).filter((channel) => channel.type === "whatsapp");
  const [channelId, setChannelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const chosenChannel = channelId || whatsapp[0]?._id || "";
  const running = job?.status === "running";

  const submit = async () => {
    if (!chosenChannel || !baseUrl.trim() || !apiKey.trim() || busy) return;
    setBusy(true);
    try {
      await start({
        workspaceId: workspace._id,
        channelId: chosenChannel as Id<"channels">,
        baseUrl,
        apiKey,
      });
      setApiKey("");
      toast.add({
        title: "Import started",
        description: "Old chats appear in the inbox as they come in.",
        type: "success",
      });
    } catch (caught) {
      toast.add({
        title: "Could not start the import",
        description: friendlyError(caught),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!job) return;
    try {
      await cancel({ importId: job._id });
    } catch (caught) {
      toast.add({ title: "Could not cancel", description: friendlyError(caught), type: "error" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            {running ? <Spinner /> : <ClockCounterClockwiseIcon />} Import from CRM
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import old chats from the CRM</DialogTitle>
          <DialogDescription>
            Brings every contact&apos;s chat history from the 1Automations CRM into
            the inbox. Imported threads land resolved, and reopen when the customer
            writes again. Contacts who already have a thread here are skipped.
          </DialogDescription>
        </DialogHeader>

        {job ? (
          <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              {running ? <Spinner /> : null} {STATUS_LABEL[job.status]}
            </p>
            <p className="text-muted-foreground">
              {job.chats} chats · {job.messages} messages imported · {job.skipped} skipped
            </p>
            {job.error ? <p className="text-destructive">{job.error}</p> : null}
          </div>
        ) : null}

        {running ? null : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crm-channel">Into WhatsApp channel</Label>
              {whatsapp.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Connect a WhatsApp channel first.
                </p>
              ) : (
                <SelectField
                  id="crm-channel"
                  value={chosenChannel}
                  onValueChange={setChannelId}
                  options={whatsapp.map((channel) => ({
                    value: channel._id as string,
                    label: channel.phone ? `${channel.name} · ${channel.phone}` : channel.name,
                  }))}
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crm-url">CRM API URL</Label>
              <Input
                id="crm-url"
                value={baseUrl}
                placeholder={job?.baseUrl ?? "https://crm.example.com"}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="crm-key">API key</Label>
              <Input
                id="crm-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Close</Button>} />
          {running ? (
            <Button variant="destructive" onClick={() => void stop()}>
              Cancel import
            </Button>
          ) : (
            <Button
              disabled={!chosenChannel || !baseUrl.trim() || !apiKey.trim() || busy}
              onClick={() => void submit()}
            >
              {busy ? <Spinner /> : null} {job ? "Import again" : "Start import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
