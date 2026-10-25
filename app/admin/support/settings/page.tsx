"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SUPPORT_PRIORITIES, type SupportSettings } from "@/convex/lib/support";
import { useSession } from "@/components/use-session";
import { PanelSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Delete02Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons";

function SlaCard({ settings, editable }: { settings: SupportSettings; editable: boolean }) {
  const save = useMutation(api.supportAdmin.saveSettings);
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);

  const number = (value: string) => Number(value) || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Response targets</CardTitle>
        <CardDescription>
          Hours from when a ticket is opened. A ticket past its target shows as at risk and the
          assignee gets an email. Changing a ticket&apos;s priority recalculates its targets.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-4 gap-y-2 text-sm sm:max-w-lg">
          <span />
          <span className="font-medium">First reply (h)</span>
          <span className="font-medium">Resolve (h)</span>
          {SUPPORT_PRIORITIES.map((priority) => (
            <div key={priority.value} className="contents">
              <span className="text-muted-foreground">{priority.label}</span>
              <Input
                type="number"
                min={1}
                disabled={!editable}
                value={form.firstResponseHours[priority.value]}
                onChange={(event) =>
                  setForm({
                    ...form,
                    firstResponseHours: { ...form.firstResponseHours, [priority.value]: number(event.target.value) },
                  })
                }
              />
              <Input
                type="number"
                min={1}
                disabled={!editable}
                value={form.resolutionHours[priority.value]}
                onChange={(event) =>
                  setForm({
                    ...form,
                    resolutionHours: { ...form.resolutionHours, [priority.value]: number(event.target.value) },
                  })
                }
              />
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label>Resolve when the client goes quiet (days)</Label>
            <Input type="number" min={1} disabled={!editable} value={form.autoResolveWaitingDays}
              onChange={(event) => setForm({ ...form, autoResolveWaitingDays: number(event.target.value) })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Close resolved tickets after (days)</Label>
            <Input type="number" min={1} disabled={!editable} value={form.autoCloseResolvedDays}
              onChange={(event) => setForm({ ...form, autoCloseResolvedDays: number(event.target.value) })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Client can reopen within (days)</Label>
            <Input type="number" min={1} disabled={!editable} value={form.reopenDays}
              onChange={(event) => setForm({ ...form, reopenDays: number(event.target.value) })} />
          </div>
        </div>
        {editable ? (
          <Button
            className="self-start"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await save(form);
                toast.add({ title: "Targets saved", type: "success" });
              } catch (error) {
                toast.add({ title: "Save failed", description: friendlyError(error), type: "error" });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Spinner /> : null} Save targets
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Only an administrator can change these.</p>
        )}
      </CardContent>
    </Card>
  );
}

function RepliesCard({ editable }: { editable: boolean }) {
  const replies = useQuery(api.supportAdmin.replies, {});
  const save = useMutation(api.supportAdmin.saveReply);
  const remove = useMutation(api.supportAdmin.deleteReply);
  const [draft, setDraft] = useState<{ replyId?: Id<"supportReplies">; title: string; body: string }>({
    title: "",
    body: "",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canned replies</CardTitle>
        <CardDescription>
          Answers the team sends often. <code>{"{{client_name}}"}</code>, <code>{"{{ticket}}"}</code> and{" "}
          <code>{"{{workspace}}"}</code> are filled in when inserted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {replies === undefined ? (
          <PanelSkeleton />
        ) : (
          <ul className="divide-y rounded-lg border">
            {replies.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">None yet.</li>
            ) : null}
            {replies.map((reply) => (
              <li key={reply._id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{reply.title}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{reply.body}</p>
                </div>
                {editable ? (
                  <>
                    <Button variant="ghost" size="icon-sm" aria-label="Edit"
                      onClick={() => setDraft({ replyId: reply._id, title: reply.title, body: reply.body })}>
                      <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Delete"
                      onClick={() => void remove({ replyId: reply._id }).catch((error) =>
                        toast.add({ title: "Delete failed", description: friendlyError(error), type: "error" }))}>
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <form
            className="flex flex-col gap-2 sm:max-w-xl"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await save(draft);
                toast.add({ title: draft.replyId ? "Reply updated" : "Reply added", type: "success" });
                setDraft({ title: "", body: "" });
              } catch (error) {
                toast.add({ title: "Save failed", description: friendlyError(error), type: "error" });
              }
            }}
          >
            <Input required placeholder="Title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            <Textarea required rows={4} placeholder="Hi {{client_name}}, …" value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
            <div className="flex gap-2">
              <Button type="submit">{draft.replyId ? "Update reply" : "Add reply"}</Button>
              {draft.replyId ? (
                <Button type="button" variant="outline" onClick={() => setDraft({ title: "", body: "" })}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function SupportSettingsPage() {
  const session = useSession();
  const settings = useQuery(api.supportAdmin.settings, {});

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-4 sm:px-6">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/admin/support" aria-label="Back to the inbox" />}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Support settings</h1>
      </header>
      <div className="flex w-full max-w-4xl min-w-0 flex-col gap-5 p-4 sm:p-6">
        {settings === undefined ? <PanelSkeleton lines={6} /> : <SlaCard settings={settings} editable={session.isAdmin} />}
        <RepliesCard editable={session.canModify("support")} />
      </div>
    </div>
  );
}
