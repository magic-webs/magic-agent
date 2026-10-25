"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ACCESS_HOURS,
  SUPPORT_LIMITS,
  SUPPORT_PRIORITIES,
  SUPPORT_TYPES,
  type SupportPriority,
  type SupportType,
} from "@/convex/lib/support";
import { useWorkspace } from "@/components/workspace-provider";
import { useSession } from "@/components/use-session";
import { AttachmentBar, useSupportFiles } from "@/components/support/attachments";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";

function pageName(path: string): string {
  const parts = path.split("?")[0]!.split("/").filter(Boolean).slice(2);
  if (parts.length === 0) return "Dashboard";
  const name = parts[0]!.replace(/-/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export default function NewTicketPage() {
  const workspace = useWorkspace();
  const session = useSession();
  const router = useRouter();
  const from = useSearchParams().get("from");
  const base = `/w/${workspace.slug}`;
  const related = from?.startsWith(base) && !from.startsWith(`${base}/support`) ? from : null;

  const create = useMutation(api.support.create);
  const grant = useMutation(api.supportAccess.grant);
  const uploadUrl = useMutation(api.support.generateUploadUrl);
  const files = useSupportFiles(() => uploadUrl({ workspaceId: workspace._id }));

  const canGrant = session.me?.role === "workspace" || session.me?.role === "user";
  const [form, setForm] = useState({
    subject: "",
    description: "",
    type: "" as SupportType | "",
    priority: "normal" as SupportPriority,
    urgentReason: "",
    access: false,
    hours: "48",
    keepLink: true,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.type) {
      toast.add({ title: "Pick an issue type", type: "error" });
      return;
    }
    if (files.busy) {
      toast.add({ title: "Wait for the files to finish uploading", type: "error" });
      return;
    }
    setBusy(true);
    try {
      const { ticketId } = await create({
        workspaceId: workspace._id,
        subject: form.subject,
        description: form.description,
        type: form.type,
        priority: form.priority,
        urgentReason: form.priority === "urgent" ? form.urgentReason : undefined,
        link: related && form.keepLink ? related.slice(base.length) || "/" : undefined,
        linkLabel: related && form.keepLink ? pageName(related) : undefined,
        attachments: files.files,
        diagnostics: {
          page: related ?? undefined,
          userAgent: navigator.userAgent.slice(0, 300),
          platform: "web",
          screen: `${window.innerWidth}×${window.innerHeight}`,
        },
      });
      if (form.access && canGrant) {
        await grant({ ticketId, hours: Number(form.hours) });
      }
      toast.add({ title: "Ticket created", description: "We will reply here and by email.", type: "success" });
      router.replace(`${base}/support/${ticketId}`);
    } catch (error) {
      toast.add({ title: "Could not create the ticket", description: friendlyError(error), type: "error" });
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={<Link href={`${base}/support`} aria-label="Back to tickets" />}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Create ticket</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The more you tell us — and show us — the faster we can fix it.
          </p>
        </div>
      </header>

      <div className="flex w-full max-w-4xl min-w-0 flex-col gap-5 p-4 sm:p-6" {...files.surface}>
        <Card>
          <CardHeader>
            <CardTitle>What is happening?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                required
                maxLength={SUPPORT_LIMITS.subject}
                placeholder="WhatsApp replies stopped this morning"
                value={form.subject}
                onChange={(event) => set("subject", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                required
                rows={7}
                maxLength={SUPPORT_LIMITS.body}
                placeholder={"What did you do, what did you expect, and what happened instead?\nPaste a screenshot straight into this box."}
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Attachments</Label>
              <AttachmentBar files={files} />
            </div>
            {related ? (
              <label className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={form.keepLink}
                  onChange={(event) => set("keepLink", event.target.checked)}
                />
                <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
                About the <span className="font-medium">{pageName(related)}</span> page I came from
              </label>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Client access</CardTitle>
            <CardDescription>
              Let the support person handling this ticket open your workspace. It closes on its own
              when the time runs out, and you can end it sooner from the ticket.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <label className="flex items-center gap-3">
              <Switch
                checked={form.access}
                onCheckedChange={(checked) => set("access", checked)}
                disabled={!canGrant}
              />
              <span className="text-sm font-medium">Account access granted</span>
            </label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hours">Access time (hours)</Label>
              <SelectField
                id="hours"
                className="w-full"
                value={form.hours}
                onValueChange={(value) => set("hours", value)}
                disabled={!form.access}
                options={ACCESS_HOURS.map((hours) => ({
                  value: String(hours),
                  label: hours === 168 ? "7 days" : `${hours} hours`,
                }))}
              />
            </div>
            {!canGrant ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Only the workspace&apos;s own login can grant access.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ticket settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="type">Issue type</Label>
              <SelectField
                id="type"
                className="w-full"
                value={form.type}
                placeholder="Select issue type"
                onValueChange={(value) => set("type", value as SupportType)}
                options={SUPPORT_TYPES}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="priority">Priority</Label>
              <SelectField
                id="priority"
                className="w-full"
                value={form.priority}
                onValueChange={(value) => set("priority", value as SupportPriority)}
                options={SUPPORT_PRIORITIES}
              />
            </div>
            {form.priority === "urgent" ? (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="urgent">Why is it urgent?</Label>
                <Input
                  id="urgent"
                  required
                  maxLength={500}
                  placeholder="Customers are not getting replies"
                  value={form.urgentReason}
                  onChange={(event) => set("urgentReason", event.target.value)}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy || files.busy}>
            {busy ? <Spinner /> : null} Create ticket
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href={`${base}/support`} />}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
