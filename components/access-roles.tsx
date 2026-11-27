"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useCachedQuery } from "@/lib/use-cached-query";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AREAS, type AreaLevel, type ChatScope, type WorkspaceArea } from "@/convex/lib/access";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/errors";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";

type Role = FunctionReturnType<typeof api.workspaceRoles.list>[number];

export const AREA_LABEL: Record<WorkspaceArea, string> = {
  dashboard: "Dashboard",
  genie: "Genie",
  team: "Team",
  build: "Build",
  inbox: "Inbox & Escalations",
  leads: "Leads",
  marketing: "Marketing",
  social: "Social",
  notifications: "Notifications",
  integrations: "Integrations",
};

const AREA_HINT: Partial<Record<WorkspaceArea, string>> = {
  build: "Company profile, knowledge, catalogue, record books, agents, tools, channels",
  leads: "Stages, contacts, orders and record books' entries",
};

export const CHAT_LABEL: Record<ChatScope, string> = {
  all: "All chats",
  assigned_unassigned: "Assigned to them, and unassigned",
  assigned: "Only chats assigned to them",
};

const LEVELS: { value: AreaLevel; label: string }[] = [
  { value: "none", label: "Hidden" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
];

type Draft = {
  name: string;
  description: string;
  chats: ChatScope;
  areas: Record<WorkspaceArea, AreaLevel>;
  canAssignOthers: boolean;
  canDeleteChats: boolean;
  canExport: boolean;
};

function draftOf(role: Role | null): Draft {
  const areas = Object.fromEntries(AREAS.map((area) => [area, "none"])) as Record<
    WorkspaceArea,
    AreaLevel
  >;
  if (!role) {
    areas.inbox = "edit";
    return {
      name: "",
      description: "",
      chats: "assigned_unassigned",
      areas,
      canAssignOthers: false,
      canDeleteChats: false,
      canExport: false,
    };
  }
  for (const row of role.areas) areas[row.area] = row.level;
  return {
    name: role.name,
    description: role.description ?? "",
    chats: role.chats,
    areas,
    canAssignOthers: role.canAssignOthers,
    canDeleteChats: role.canDeleteChats,
    canExport: role.canExport,
  };
}

/** One line on what a role opens, for the list and the member menu. */
export function roleSummary(role: Pick<Role, "chats" | "areas">): string {
  const open = role.areas.filter((row) => row.level !== "none").length;
  return `${CHAT_LABEL[role.chats]} · ${open} of ${AREAS.length} areas`;
}

export function RolesButton({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <HugeiconsIcon icon={Shield01Icon} strokeWidth={2} /> Roles
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <Roles workspaceId={workspaceId} />
      </DialogContent>
    </Dialog>
  );
}

function Roles({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const roles = useCachedQuery(api.workspaceRoles.list, { workspaceId });
  const ensureStarters = useMutation(api.workspaceRoles.ensureStarters);
  const remove = useMutation(api.workspaceRoles.remove);
  const [editing, setEditing] = useState<Role | "new" | null>(null);

  // Manager and Agent, the first time Roles is opened.
  const seeded = useRef(false);
  useEffect(() => {
    if (roles?.length === 0 && !seeded.current) {
      seeded.current = true;
      void ensureStarters({ workspaceId }).catch(() => undefined);
    }
  }, [roles, ensureStarters, workspaceId]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Roles</DialogTitle>
        <DialogDescription>
          What a human agent sees and can change when they sign in with their own login:
          which chats, which areas of the dashboard, and a few actions. Give someone a
          role from the menu on their card. Without one they can use everything except
          billing and other people&apos;s logins.
        </DialogDescription>
      </DialogHeader>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        {roles === undefined || roles.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading roles…
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {roles.map((role) => (
              <li key={role._id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{role.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {roleSummary(role)}
                  </p>
                </div>
                <Badge variant="secondary">
                  {role.memberCount} {role.memberCount === 1 ? "person" : "people"}
                </Badge>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label={`Edit ${role.name}`}
                  onClick={() => setEditing(role)}
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label={`Delete ${role.name}`}
                  onClick={async () => {
                    try {
                      await remove({ roleId: role._id });
                    } catch (error) {
                      toast.add({
                        title: "Could not delete",
                        description: friendlyError(error),
                        type: "error",
                      });
                    }
                  }}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter>
        <Button onClick={() => setEditing("new")}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add role
        </Button>
      </DialogFooter>

      {editing ? (
        <RoleDialog
          key={editing === "new" ? "new" : editing._id}
          workspaceId={workspaceId}
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function RoleDialog({
  workspaceId,
  role,
  onClose,
}: {
  workspaceId: Id<"workspaces">;
  role: Role | null;
  onClose: () => void;
}) {
  const save = useMutation(api.workspaceRoles.save);
  const [draft, setDraft] = useState<Draft>(() => draftOf(role));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const setArea = (area: WorkspaceArea, level: AreaLevel) =>
    setDraft((prev) => ({ ...prev, areas: { ...prev.areas, [area]: level } }));

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        workspaceId,
        roleId: role?._id,
        name: draft.name,
        description: draft.description,
        chats: draft.chats,
        areas: AREAS.map((area) => ({ area, level: draft.areas[area] })),
        canAssignOthers: draft.canAssignOthers,
        canDeleteChats: draft.canDeleteChats,
        canExport: draft.canExport,
      });
      toast.add({ title: role ? "Role saved" : "Role added", type: "success" });
      onClose();
    } catch (error) {
      toast.add({ title: "Could not save", description: friendlyError(error), type: "error" });
      setSaving(false);
    }
  };

  const inboxHidden = draft.areas.inbox === "none";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "Add role"}</DialogTitle>
          <DialogDescription>
            Hidden takes the area off their sidebar. View shows it without letting them
            change anything. Edit lets them change it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={draft.name}
                placeholder="Sales agent"
                maxLength={40}
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-chats">Chats they see</Label>
              <SelectField
                id="role-chats"
                value={draft.chats}
                disabled={inboxHidden}
                onValueChange={(value) => set("chats", value as ChatScope)}
                options={(Object.keys(CHAT_LABEL) as ChatScope[]).map((value) => ({
                  value,
                  label: CHAT_LABEL[value],
                }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={draft.description}
              placeholder="Answers the chats handed to them"
              maxLength={120}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Areas</Label>
            <ul className="divide-y rounded-lg border">
              {AREAS.map((area) => (
                <li key={area} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{AREA_LABEL[area]}</p>
                    {AREA_HINT[area] ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {AREA_HINT[area]}
                      </p>
                    ) : null}
                  </div>
                  <ToggleGroup
                    aria-label={`${AREA_LABEL[area]} access`}
                    value={[draft.areas[area]]}
                    onValueChange={(value) => {
                      const next = value[0] as AreaLevel | undefined;
                      if (next) setArea(area, next);
                    }}
                    variant="outline"
                    size="sm"
                    spacing={0}
                  >
                    {LEVELS.map((level) => (
                      <ToggleGroupItem key={level.value} value={level.value}>
                        {level.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Actions</Label>
            {(
              [
                ["canAssignOthers", "Assign chats to other people", "They can always take a chat or let go of their own."],
                ["canDeleteChats", "Delete and reset chats", null],
                ["canExport", "Export contacts", "Download the contact list as a CSV."],
              ] as const
            ).map(([key, label, hint]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
              >
                <div>
                  <Label htmlFor={`role-${key}`}>{label}</Label>
                  {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
                </div>
                <Switch
                  id={`role-${key}`}
                  checked={draft[key]}
                  onCheckedChange={(checked) => set(key, checked)}
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !draft.name.trim()} onClick={() => void submit()}>
            {saving ? <Spinner /> : null}
            {role ? "Save" : "Add role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
