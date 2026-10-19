"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { HANDBACK_AFTER_MINUTES, PAUSE_CHOICES_MINUTES, pauseLabel } from "@/convex/lib/shared";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react";

type Rule = FunctionReturnType<typeof api.handover.list>[number];
type Department = "sales" | "support" | "accounts" | "other";

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "support", label: "Support" },
  { value: "accounts", label: "Accounts" },
  { value: "other", label: "Other" },
];

type Draft = {
  name: string;
  agentId: string;
  department: string;
  memberIds: Id<"teamMembers">[];
  pauseAgent: boolean;
  pauseMinutes: number;
  enabled: boolean;
};

const EMPTY: Draft = {
  name: "",
  agentId: "any",
  department: "any",
  memberIds: [],
  pauseAgent: true,
  pauseMinutes: HANDBACK_AFTER_MINUTES,
  enabled: true,
};

function draftOf(rule: Rule): Draft {
  return {
    name: rule.name,
    agentId: rule.agentId ?? "any",
    department: rule.department ?? "any",
    memberIds: rule.memberIds,
    pauseAgent: rule.pauseAgent,
    pauseMinutes: rule.pauseMinutes ?? HANDBACK_AFTER_MINUTES,
    enabled: rule.enabled,
  };
}

export function HandoverRulesButton({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <TreeStructureIcon /> Handover rules
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <HandoverRules workspaceId={workspaceId} />
      </DialogContent>
    </Dialog>
  );
}

function HandoverRules({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const rules = useQuery(api.handover.list, { workspaceId });
  const agents = useQuery(api.agents.listByWorkspace, { workspaceId });
  const members = useQuery(api.team.activeForReply, { workspaceId });
  const setEnabled = useMutation(api.handover.setEnabled);
  const move = useMutation(api.handover.move);
  const remove = useMutation(api.handover.remove);
  const [editing, setEditing] = useState<Rule | "new" | null>(null);

  const run = async (action: () => Promise<unknown>, failure: string) => {
    try {
      await action();
    } catch (error) {
      toast.add({ title: failure, description: friendlyError(error), type: "error" });
    }
  };

  const departmentLabel = (value: string | undefined) =>
    DEPARTMENTS.find((one) => one.value === value)?.label;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Handover rules</DialogTitle>
        <DialogDescription>
          Who gets a conversation when an AI agent escalates it to a person. The first
          rule that matches wins; a rule with several people takes turns between them.
        </DialogDescription>
      </DialogHeader>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        {rules === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading rules…
          </div>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules yet. Escalated conversations stay unassigned until someone picks
            them up.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {rules.map((rule, index) => (
              <li key={rule._id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rule.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    When {rule.agentName ?? "any agent"} escalates
                    {rule.department ? ` to ${departmentLabel(rule.department)}` : ""} →{" "}
                    {rule.members.length > 0
                      ? rule.members.map((member) => member.name).join(", ")
                      : "nobody"}
                    {rule.members.length > 1 ? " (in turn)" : ""}
                    {rule.pauseAgent
                      ? ` · pauses the agent for ${pauseLabel(rule.pauseMinutes ?? HANDBACK_AFTER_MINUTES)}`
                      : ""}
                  </p>
                </div>
                {rule.enabled ? null : <Badge variant="secondary">Off</Badge>}
                <Switch
                  size="sm"
                  aria-label={rule.enabled ? "Turn rule off" : "Turn rule on"}
                  checked={rule.enabled}
                  onCheckedChange={(enabled) =>
                    void run(() => setEnabled({ ruleId: rule._id, enabled }), "Could not update")
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        aria-label="Rule actions"
                      />
                    }
                  >
                    <DotsThreeIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => setEditing(rule)}>
                      <PencilSimpleIcon /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === 0}
                      onClick={() =>
                        void run(() => move({ ruleId: rule._id, direction: "up" }), "Could not move")
                      }
                    >
                      <ArrowUpIcon /> Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === rules.length - 1}
                      onClick={() =>
                        void run(() => move({ ruleId: rule._id, direction: "down" }), "Could not move")
                      }
                    >
                      <ArrowDownIcon /> Move down
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() =>
                        void run(() => remove({ ruleId: rule._id }), "Could not delete")
                      }
                    >
                      <TrashIcon /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ol>
        )}
      </div>
      <DialogFooter>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon /> Add rule
        </Button>
      </DialogFooter>

      {editing ? (
        <RuleDialog
          key={editing === "new" ? "new" : editing._id}
          workspaceId={workspaceId}
          rule={editing === "new" ? null : editing}
          agents={(agents ?? []).filter(
            (agent) => agent.kind !== "follow_up" && agent.kind !== "marketing"
          )}
          members={members ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function RuleDialog({
  workspaceId,
  rule,
  agents,
  members,
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  rule: Rule | null;
  agents: { _id: Id<"agents">; botName: string }[];
  members: { _id: Id<"teamMembers">; name: string; role: string }[];
  onClose: () => void;
}) {
  const create = useMutation(api.handover.create);
  const update = useMutation(api.handover.update);
  const [draft, setDraft] = useState<Draft>(() => (rule ? draftOf(rule) : EMPTY));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const toggleMember = (id: Id<"teamMembers">, on: boolean) =>
    set("memberIds", on ? [...draft.memberIds, id] : draft.memberIds.filter((one) => one !== id));

  const save = async () => {
    setSaving(true);
    const fields = {
      name: draft.name,
      agentId: draft.agentId === "any" ? undefined : (draft.agentId as Id<"agents">),
      department: draft.department === "any" ? undefined : (draft.department as Department),
      memberIds: draft.memberIds,
      pauseAgent: draft.pauseAgent,
      pauseMinutes: draft.pauseAgent ? draft.pauseMinutes : undefined,
      enabled: draft.enabled,
    };
    try {
      if (rule) await update({ ruleId: rule._id, ...fields });
      else await create({ workspaceId, ...fields });
      toast.add({ title: rule ? "Rule saved" : "Rule added", type: "success" });
      onClose();
    } catch (error) {
      toast.add({ title: "Could not save", description: friendlyError(error), type: "error" });
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit handover rule" : "Add handover rule"}</DialogTitle>
          <DialogDescription>
            When an agent escalates a conversation that matches, it is assigned to the
            people you pick.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={draft.name}
              placeholder="Sales leads to the sales team"
              maxLength={80}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-agent">When this agent escalates</Label>
              <SelectField
                id="rule-agent"
                value={draft.agentId}
                onValueChange={(value) => set("agentId", value)}
                options={[
                  { value: "any", label: "Any agent" },
                  ...agents.map((agent) => ({ value: agent._id as string, label: agent.botName })),
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-department">To the department</Label>
              <SelectField
                id="rule-department"
                value={draft.department}
                onValueChange={(value) => set("department", value)}
                options={[{ value: "any", label: "Any department" }, ...DEPARTMENTS]}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Assign to</Label>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add a human agent first.</p>
            ) : (
              <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1.5">
                {members.map((member) => (
                  <label
                    key={member._id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={draft.memberIds.includes(member._id)}
                      onCheckedChange={(checked) => toggleMember(member._id, checked)}
                    />
                    <span className="min-w-0 flex-1 truncate">{member.name}</span>
                    {member.role ? (
                      <span className="truncate text-xs text-muted-foreground">{member.role}</span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
            {draft.memberIds.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                They take turns. Anyone set to away is skipped.
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="rule-pause">Pause the agent</Label>
              <p className="text-xs text-muted-foreground">
                The agent stops replying so the person can take over.
              </p>
            </div>
            <Switch
              id="rule-pause"
              checked={draft.pauseAgent}
              onCheckedChange={(checked) => set("pauseAgent", checked)}
            />
          </div>
          {draft.pauseAgent ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-pause-for">Hand back to the agent after</Label>
              <SelectField
                id="rule-pause-for"
                value={String(draft.pauseMinutes)}
                onValueChange={(value) => set("pauseMinutes", Number(value))}
                options={PAUSE_CHOICES_MINUTES.map((minutes) => ({
                  value: String(minutes),
                  label: pauseLabel(minutes),
                }))}
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="rule-enabled">Rule is on</Label>
            <Switch
              id="rule-enabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => set("enabled", checked)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !draft.name.trim() || draft.memberIds.length === 0}
            onClick={() => void save()}
          >
            {saving ? <Spinner /> : null}
            {rule ? "Save" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
