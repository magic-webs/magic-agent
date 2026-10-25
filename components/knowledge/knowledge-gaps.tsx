"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { CardGridSkeleton } from "@/components/skeletons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BubbleChatIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  HelpCircleIcon,
  PlusSignIcon,
  Undo02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { friendlyError } from "@/lib/errors";
import { FixAnswerDialog } from "@/components/knowledge/fix-answer-dialog";

type Status = "open" | "answered" | "dismissed";
type Kind = "all" | "unanswered" | "wrong_answer";

type Gap = {
  _id: Id<"knowledgeGaps">;
  kind: "unanswered" | "wrong_answer";
  wrongReply?: string;
  note?: string;
  question: string;
  customerMessage?: string;
  askCount: number;
  lastAskedAt: number;
  conversationIds: Id<"conversations">[];
  status: Status;
  agentName?: string;
  sourceTitle?: string;
};

const EMPTY_COPY: Record<Status, { title: string; description: string }> = {
  open: {
    title: "No knowledge gaps",
    description:
      "Questions an agent could not answer, and replies marked as wrong in the inbox, show up here so you can fix the knowledge base.",
  },
  answered: {
    title: "Nothing answered yet",
    description: "Questions you answer from here are listed with the FAQ they became.",
  },
  dismissed: {
    title: "Nothing dismissed",
    description: "Questions you dismiss stay here and are not raised again.",
  },
};

function AnswerGapDialog({
  gap,
  onClose,
}: {
  gap: Gap | null;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const agents = useQuery(api.agents.listByWorkspace, {
    workspaceId: workspace._id,
  });
  const answerGap = useMutation(api.knowledgeGaps.answer);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (gap && loadedFor !== gap._id) {
    setLoadedFor(gap._id);
    setQuestion(gap.question);
    setAnswer("");
    setScope("all");
  }

  const save = async () => {
    if (!gap) return;
    if (!answer.trim()) {
      toast.add({ title: "Write the answer first", type: "error" });
      return;
    }
    setBusy(true);
    try {
      await answerGap({
        gapId: gap._id,
        question,
        answer,
        agentId: scope === "all" ? undefined : (scope as Id<"agents">),
      });
      toast.add({
        title: "Answer added",
        description: "Saved as an FAQ. Agents can use it once embedding finishes.",
        type: "success",
      });
      onClose();
    } catch (error) {
      toast.add({
        title: "Could not save the answer",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={gap !== null}
      onOpenChange={(next) => {
        if (!next) {
          setLoadedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add the answer</DialogTitle>
          <DialogDescription>
            Saved to the knowledge base as an FAQ, so the agents answer this
            question themselves next time.
          </DialogDescription>
        </DialogHeader>

        {gap?.customerMessage ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Customer asked: &ldquo;{gap.customerMessage}&rdquo;
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gap-question">Question</Label>
          <Input
            id="gap-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gap-answer">Answer</Label>
          <Textarea
            id="gap-answer"
            rows={6}
            value={answer}
            placeholder="The answer, as you would want the agent to give it"
            onChange={(event) => setAnswer(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gap-scope">Available to</Label>
          <SelectField
            id="gap-scope"
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

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />} Add to knowledge base
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KnowledgeGaps() {
  const workspace = useWorkspace();
  const [status, setStatus] = useState<Status>("open");
  const [kind, setKind] = useState<Kind>("all");
  const gaps = useQuery(api.knowledgeGaps.listByWorkspace, {
    workspaceId: workspace._id,
    status,
    kind: kind === "all" ? undefined : kind,
  });
  const dismiss = useMutation(api.knowledgeGaps.dismiss);
  const reopen = useMutation(api.knowledgeGaps.reopen);
  const [answering, setAnswering] = useState<Gap | null>(null);
  const [fixing, setFixing] = useState<Id<"knowledgeGaps"> | null>(null);
  const base = `/w/${workspace.slug}`;

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast.add({ title: done, type: "success" });
    } catch (error) {
      toast.add({ title: "Something went wrong", description: friendlyError(error), type: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Questions the agents could not answer, and replies the team marked as
          wrong. The same question asked again is grouped, most asked first.
        </p>
        <div className="flex gap-2">
          <SelectField
            className="w-40"
            value={kind}
            onValueChange={(value) => setKind(value as Kind)}
            options={[
              { value: "all", label: "All types" },
              { value: "unanswered", label: "Unanswered" },
              { value: "wrong_answer", label: "Wrong answers" },
            ]}
          />
          <SelectField
            className="w-36"
            value={status}
            onValueChange={(value) => setStatus(value as Status)}
            options={[
              { value: "open", label: "Open" },
              { value: "answered", label: "Fixed" },
              { value: "dismissed", label: "Dismissed" },
            ]}
          />
        </div>
      </div>

      {gaps === undefined ? (
        <CardGridSkeleton count={3} />
      ) : gaps.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>{EMPTY_COPY[status].title}</EmptyTitle>
            <EmptyDescription>{EMPTY_COPY[status].description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {gaps.map((gap) => (
            <Card key={gap._id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="line-clamp-3">
                  {gap.question || "Agent reply marked wrong"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap gap-1">
                  {gap.kind === "wrong_answer" ? (
                    <Badge variant="destructive">Wrong answer</Badge>
                  ) : (
                    <Badge variant={gap.askCount > 1 ? "default" : "secondary"}>
                      Asked {gap.askCount}×
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    {formatDistanceToNow(gap.lastAskedAt, { addSuffix: true })}
                  </Badge>
                  {gap.agentName ? (
                    <Badge variant="outline">{gap.agentName}</Badge>
                  ) : null}
                </div>

                {gap.kind === "wrong_answer" ? (
                  <>
                    {gap.wrongReply ? (
                      <p className="line-clamp-3 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-sm">
                        {gap.wrongReply}
                      </p>
                    ) : null}
                    {gap.note ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        Note: {gap.note}
                      </p>
                    ) : null}
                  </>
                ) : gap.customerMessage ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    &ldquo;{gap.customerMessage}&rdquo;
                  </p>
                ) : null}

                {gap.status === "answered" && gap.sourceTitle ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 shrink-0" />
                    <span className="truncate">Answered in &ldquo;{gap.sourceTitle}&rdquo;</span>
                  </p>
                ) : null}

                {gap.conversationIds.length > 0 ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {gap.conversationIds.map((conversationId, index) => (
                      <Link
                        key={conversationId}
                        href={`${base}/conversations?c=${conversationId}`}
                        className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        <HugeiconsIcon icon={BubbleChatIcon} strokeWidth={2} className="size-3.5" />
                        Conversation {index + 1}
                      </Link>
                    ))}
                  </div>
                ) : null}

                <div className="mt-auto flex gap-1 pt-1">
                  {gap.status === "open" ? (
                    <>
                      {gap.kind === "wrong_answer" ? (
                        <Button className="flex-1" onClick={() => setFixing(gap._id)}>
                          <HugeiconsIcon icon={Wrench01Icon} strokeWidth={2} /> Fix
                        </Button>
                      ) : (
                        <Button className="flex-1" onClick={() => setAnswering(gap)}>
                          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add answer
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => run(() => dismiss({ gapId: gap._id }), "Dismissed")}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /> Dismiss
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => run(() => reopen({ gapId: gap._id }), "Moved back to open")}
                    >
                      <HugeiconsIcon icon={Undo02Icon} strokeWidth={2} /> Reopen
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AnswerGapDialog gap={answering} onClose={() => setAnswering(null)} />
      <FixAnswerDialog
        workspaceId={workspace._id}
        gapId={fixing}
        onClose={() => setFixing(null)}
      />
    </div>
  );
}
