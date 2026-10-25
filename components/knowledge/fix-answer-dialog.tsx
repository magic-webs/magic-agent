"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { SourceDialog } from "@/components/knowledge/source-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  FloppyDiskIcon,
  PencilEdit02Icon,
  SentIcon,
} from "@hugeicons/core-free-icons";
import { friendlyError } from "@/lib/errors";

/**
 * Fixes an agent reply marked as wrong: edit the reply in place and save it as
 * a correction FAQ, or edit a source it was built from, then optionally send
 * the customer the right answer.
 */
export function FixAnswerDialog({
  workspaceId,
  gapId,
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  gapId: Id<"knowledgeGaps"> | null;
  onClose: () => void;
}) {
  const gap = useQuery(api.knowledgeGaps.get, gapId ? { gapId } : "skip");
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId,
  });
  const answerGap = useMutation(api.knowledgeGaps.answer);
  const markFixed = useMutation(api.knowledgeGaps.markFixed);
  const dismiss = useMutation(api.knowledgeGaps.dismiss);
  const sendReply = useAction(api.conversations.sendManualReply);

  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState("");
  const [scope, setScope] = useState("all");
  const [correction, setCorrection] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (gap && loadedFor !== gap._id) {
    setLoadedFor(gap._id);
    setEditing(false);
    setAnswer(gap.wrongReply ?? "");
    setScope("all");
    setCorrection("");
  }

  const close = () => {
    setLoadedFor(null);
    onClose();
  };

  const saveCorrection = async () => {
    if (!gap) return;
    if (!answer.trim()) {
      toast.add({ title: "Write the correct answer first", type: "error" });
      return;
    }
    if (answer.trim() === gap.wrongReply?.trim()) {
      toast.add({ title: "Change the reply before saving", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await answerGap({
        gapId: gap._id,
        question: gap.question || gap.customerMessage || undefined,
        answer,
        agentId: scope === "all" ? undefined : (scope as Id<"agents">),
      });
      setEditing(false);
      setCorrection(answer.trim());
      toast.add({
        title: "Correction saved",
        description: "Agents use it once embedding finishes, ahead of anything that disagrees.",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Could not save the correction",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const sourceEdited = async (sourceId: Id<"knowledgeSources">) => {
    if (!gap) return;
    try {
      await markFixed({ gapId: gap._id, sourceId });
    } catch (error) {
      toast.add({
        title: "Saved, but the answer is still marked wrong",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  const sendCorrection = async () => {
    if (!gap?.conversationId || !correction.trim()) return;
    setSending(true);
    try {
      const result = await sendReply({
        conversationId: gap.conversationId,
        text: correction,
        replyToMessageId: gap.messageId,
      });
      if (!result.ok) {
        toast.add({ title: "Not sent", description: result.error, type: "error" });
        return;
      }
      toast.add({ title: "Correction sent to the customer", type: "success" });
      close();
    } finally {
      setSending(false);
    }
  };

  const fixed = gap?.status === "answered";

  return (
    <Dialog open={gapId !== null} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col overflow-y-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Fix this answer</DialogTitle>
          <DialogDescription>
            Correct the knowledge the agent answered from, so it gets this
            right next time.
          </DialogDescription>
        </DialogHeader>

        {gap === undefined ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : gap === null ? null : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
            {gap.customerMessage ? (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <p className="text-xs font-medium text-muted-foreground">Customer asked</p>
                <p className="whitespace-pre-wrap">{gap.customerMessage}</p>
              </div>
            ) : null}

            {fixed ? (
              <Alert>
                <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
                <AlertTitle>Fixed</AlertTitle>
                <AlertDescription>
                  {gap.sourceTitle
                    ? `The answer now comes from “${gap.sourceTitle}”.`
                    : "The knowledge base has been updated."}
                </AlertDescription>
              </Alert>
            ) : editing ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="fix-answer">Correct reply</Label>
                <Textarea
                  id="fix-answer"
                  rows={6}
                  autoFocus
                  value={answer}
                  placeholder="The answer, as the agent should give it"
                  onChange={(event) => setAnswer(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <SelectField
                    className="min-w-0 flex-1"
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
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setAnswer(gap.wrongReply ?? "");
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={saveCorrection} disabled={busy}>
                    {busy ? <Spinner /> : <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} />} Save correction
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-destructive">Agent replied</p>
                  <Button size="sm" variant="ghost" className="-my-1 -mr-2" onClick={() => setEditing(true)}>
                    <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} /> Edit
                  </Button>
                </div>
                <p className="whitespace-pre-wrap">{gap.wrongReply}</p>
                {gap.note ? (
                  <p className="mt-2 text-xs text-muted-foreground">Note: {gap.note}</p>
                ) : null}
              </div>
            )}

            {!fixed && gap.usedSources.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Answered from</p>
                {gap.usedSources.map((source) => {
                  const editable = source.kind === "text" || source.kind === "faq";
                  return (
                    <div
                      key={source._id}
                      className="flex items-center gap-2 rounded-md border px-3 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{source.title}</span>
                      <Badge variant="outline">{source.kind}</Badge>
                      {source.correction ? <Badge variant="secondary">correction</Badge> : null}
                      <SourceDialog
                        sourceId={source._id}
                        agents={agents}
                        label={editable ? "Edit" : "Open"}
                        needsUpdate
                        onSaved={editable ? () => void sourceEdited(source._id) : undefined}
                      />
                    </div>
                  );
                })}
              </section>
            ) : null}

            {fixed && gap.kind === "wrong_answer" && gap.conversationId ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Send the right answer to the customer</h3>
                {gap.canSendCorrection ? (
                  <>
                    <Textarea
                      rows={4}
                      value={correction}
                      placeholder="Sorry, I gave you the wrong answer earlier…"
                      onChange={(event) => setCorrection(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Sent as a reply to the wrong message. Like any team reply,
                      it pauses the agent in this conversation for a while.
                    </p>
                    <Button
                      onClick={sendCorrection}
                      disabled={sending || !correction.trim()}
                      className="self-start"
                    >
                      {sending ? <Spinner /> : <HugeiconsIcon icon={SentIcon} strokeWidth={2} />} Send to customer
                    </Button>
                  </>
                ) : (
                  <Alert>
                    <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                    <AlertTitle>Outside the 24-hour window</AlertTitle>
                    <AlertDescription>
                      The customer last wrote more than 24 hours ago, so a
                      free-form message would not be delivered.
                    </AlertDescription>
                  </Alert>
                )}
              </section>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {gap && !fixed ? (
            <Button
              variant="ghost"
              className="sm:mr-auto"
              onClick={async () => {
                await dismiss({ gapId: gap._id });
                toast.add({ title: "Unmarked", type: "success" });
                close();
              }}
            >
              Not wrong after all
            </Button>
          ) : null}
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
