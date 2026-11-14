"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Call02Icon, Copy01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/select-field";
import { VoicePicker } from "@/components/voice-channel";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";

type PhoneForm = {
  name: string;
  agentId: string;
  number: string;
  voiceId?: string;
  greeting?: string;
};

const CONVEX_SITE = (
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site") ||
  ""
).replace(/\/+$/, "");

export function PhoneChannelDialog({
  channelId,
  initial,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  channelId?: Id<"channels">;
  initial?: PhoneForm;
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, { workspaceId: workspace._id });
  const createChannel = useMutation(api.channels.create);
  const updateChannel = useMutation(api.channels.update);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<PhoneForm>(initial ?? { name: "Phone line", agentId: "", number: "" });
  const set = (patch: Partial<PhoneForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const sortedAgents = [...(agents ?? [])].sort((a, b) =>
    a.kind === "router" ? -1 : b.kind === "router" ? 1 : 0
  );
  const agentId = form.agentId || sortedAgents[0]?._id || "";

  const submit = async () => {
    if (!agentId) {
      toast.add({ title: "Pick the agent that answers here", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const phoneLine = {
        number: form.number,
        voiceId: form.voiceId,
        greeting: form.greeting?.trim() || undefined,
      };
      if (channelId) {
        await updateChannel({ channelId, name: form.name, agentId: agentId as Id<"agents">, phoneLine });
        toast.add({ title: "Phone line updated", type: "success" });
      } else {
        await createChannel({
          workspaceId: workspace._id,
          agentId: agentId as Id<"agents">,
          type: "phone",
          name: form.name,
          phoneLine,
        });
        toast.add({
          title: "Phone line created",
          description: "Paste its answer URL into a Plivo application.",
          type: "success",
        });
      }
      setOpen(false);
    } catch (error) {
      toast.add({ title: "Save failed", description: friendlyError(error), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{channelId ? "Edit phone line" : "Connect a phone line"}</DialogTitle>
          <DialogDescription>
            Your agent answers calls to a Plivo number and talks to the caller.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-number">Plivo number</Label>
              <Input
                id="p-number"
                inputMode="tel"
                placeholder="+91 80 3185 7999"
                value={form.number}
                onChange={(e) => set({ number: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-agent">Agent that answers</Label>
            <SelectField
              id="p-agent"
              className="w-full"
              value={agentId}
              placeholder="No agents yet"
              onValueChange={(next) => set({ agentId: next })}
              options={sortedAgents.map((agent) => ({
                value: agent._id,
                label:
                  agent.kind === "router"
                    ? `${agent.botName} (front desk)`
                    : `${agent.botName} (${agent.name})`,
              }))}
            />
          </div>
          <VoicePicker agentId={agentId} value={form.voiceId} onChange={(voiceId) => set({ voiceId })} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-greeting">Greeting</Label>
            <Textarea
              id="p-greeting"
              rows={2}
              maxLength={300}
              placeholder="Leave empty to use the agent's own greeting."
              value={form.greeting ?? ""}
              onChange={(e) => set({ greeting: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : <HugeiconsIcon icon={Call02Icon} strokeWidth={2} />}
            {channelId ? "Save changes" : "Connect line"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({ title: `${label} copied`, type: "success" });
  } catch {
    toast.add({ title: "Copy failed", description: "Select the text and copy it manually.", type: "error" });
  }
}

function UrlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex items-stretch gap-1 rounded-lg border border-border bg-muted/40 p-1 pl-3">
        <code className="min-w-0 flex-1 self-center break-all py-1.5 font-mono text-xs">{value}</code>
        <Button size="sm" variant="outline" className="self-center bg-background" onClick={() => void copy(value, label)}>
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} /> Copy
        </Button>
      </div>
    </div>
  );
}

export function PhoneSetup({ channelKey, number }: { channelKey: string; number?: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <UrlRow label="Answer URL" value={`${CONVEX_SITE}/plivo/answer/${channelKey}`} />
        <UrlRow label="Hangup URL" value={`${CONVEX_SITE}/plivo/hangup/${channelKey}`} />
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
          Connect it in Plivo
        </p>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>In Plivo, open Applications and create an XML application.</li>
          <li>Paste the Answer URL and the Hangup URL, both with the POST method.</li>
          <li>
            Open Phone Numbers, choose {number ?? "your number"}, set Application type to
            Application and pick this application.
          </li>
          <li>Call the number. The agent greets you and answers out loud.</li>
        </ol>
      </div>
    </div>
  );
}
