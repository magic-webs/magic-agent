"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { AdminScope } from "@/components/use-session";
import { SelectField } from "@/components/select-field";
import { errorText } from "@/components/admin-account-fields";
import { TableSkeleton } from "@/components/skeletons";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@phosphor-icons/react";

type Role = Doc<"adminRoles"> & { memberCount: number };

/** `modify` is what Modify adds; an area without it can only be looked at. */
const AREAS: { value: AdminScope; label: string; modify?: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "workspaces", label: "Workspaces", modify: "Create, archive, stage" },
  { value: "activity", label: "Activity" },
  { value: "access", label: "Access", modify: "Issue and revoke logins" },
  { value: "mcp", label: "MCP connector", modify: "Issue their own tokens" },
  { value: "models", label: "AI models", modify: "Edit the catalogue, pick agents' models" },
  { value: "usage", label: "Tokens & cost" },
  { value: "plans", label: "Plans & pricing", modify: "Edit plans and pricing" },
  { value: "subscriptions", label: "Subscriptions", modify: "Change accounts and wallets" },
  { value: "billing", label: "Message billing", modify: "Markups and Meta rates" },
  { value: "users", label: "Users", modify: "Add and manage their users" },
];

const labelOf = new Map(AREAS.map((area) => [area.value, area.label]));

type Level = "off" | "view" | "modify";

function levelsOf(role?: Role): Record<AdminScope, Level> {
  const scopes = role?.scopes ?? (["workspaces"] as AdminScope[]);
  const viewOnly = role?.viewOnly ?? [];
  return Object.fromEntries(
    AREAS.map((area) => [
      area.value,
      !scopes.includes(area.value)
        ? "off"
        : viewOnly.includes(area.value) || !area.modify
          ? "view"
          : "modify",
    ])
  ) as Record<AdminScope, Level>;
}

const REACH_OPTIONS = [
  { value: "picked", label: "Only the workspaces picked for each person" },
  { value: "all", label: "Every workspace" },
];

function RoleDialog({ role }: { role?: Role }) {
  const create = useMutation(api.adminRoles.create);
  const update = useMutation(api.adminRoles.update);

  const initial = () => ({
    name: role?.name ?? "",
    description: role?.description ?? "",
    levels: levelsOf(role),
    allWorkspaces: role?.allWorkspaces ?? false,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(initial);

  const scopes = AREAS.filter((area) => form.levels[area.value] !== "off").map(
    (area) => area.value
  );
  const invalid = !form.name.trim() || scopes.length === 0;

  const setLevel = (scope: AdminScope, level: Level) =>
    setForm((prev) => ({ ...prev, levels: { ...prev.levels, [scope]: level } }));

  const submit = async () => {
    setBusy(true);
    const fields = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      scopes,
      viewOnly: AREAS.filter((area) => form.levels[area.value] === "view").map(
        (area) => area.value
      ),
      allWorkspaces: form.allWorkspaces,
    };
    try {
      if (role) await update({ roleId: role._id, ...fields });
      else await create(fields);
      toast.add({ title: role ? "Role updated" : `${fields.name} created`, type: "success" });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: role ? "Could not update the role" : "Could not create the role",
        description: errorText(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setForm(initial());
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          role ? (
            <Button size="sm" variant="outline">
              <PencilSimpleIcon /> Edit
            </Button>
          ) : (
            <Button>
              <PlusIcon /> New role
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            The areas of this console the role opens. Areas about the whole
            platform show all of it; the rest stay within the role&apos;s workspaces.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={form.name}
              maxLength={40}
              placeholder="Account manager"
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={form.description}
              maxLength={200}
              placeholder="Optional"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-reach">Workspaces</Label>
            <SelectField
              id="role-reach"
              value={form.allWorkspaces ? "all" : "picked"}
              options={REACH_OPTIONS}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, allWorkspaces: value === "all" }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Platform access</Label>
            <div className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-md border">
              {AREAS.map((area) => (
                <div key={area.value} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium">{area.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {area.modify ? `Modify: ${area.modify.toLowerCase()}` : "View only"}
                    </span>
                  </div>
                  <SelectField
                    size="sm"
                    aria-label={`${area.label} access`}
                    className="w-28"
                    value={form.levels[area.value]}
                    options={[
                      { value: "off", label: "Off" },
                      { value: "view", label: "View" },
                      ...(area.modify ? [{ value: "modify", label: "Modify" }] : []),
                    ]}
                    onValueChange={(value) => setLevel(area.value, value as Level)}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              View opens the page to look at. Modify also allows every change on
              it. Team and Roles stay with administrators.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || invalid} onClick={() => void submit()}>
            {busy ? <Spinner /> : role ? <PencilSimpleIcon /> : <PlusIcon />}
            {role ? "Save" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveRoleButton({ role }: { role: Role }) {
  const remove = useMutation(api.adminRoles.remove);

  const run = async () => {
    try {
      await remove({ roleId: role._id });
      toast.add({ title: `${role.name} deleted`, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not delete the role",
        description: errorText(error),
        type: "error",
      });
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant="ghost" disabled={role.memberCount > 0}>
            <TrashIcon /> Delete
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Nobody holds this role, so nobody loses access.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
          <AlertDialogAction
            render={
              <Button variant="destructive" onClick={() => void run()}>
                Delete
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminRolesPage() {
  const roles = useQuery(api.adminRoles.list, {});

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            What each member of the platform team can open. Give a role to
            someone on the Team page.
          </p>
        </div>
        <RoleDialog />
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4" /> Platform roles
          </CardTitle>
          <CardDescription>
            Changes apply to everyone holding the role on their next request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roles === undefined ? (
            <TableSkeleton columns={5} rows={3} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Platform access</TableHead>
                    <TableHead>Workspaces</TableHead>
                    <TableHead>People</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="flex items-center gap-1.5 font-medium">
                          Admin <Badge variant="outline">built in</Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Everything, including Team and Roles.
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">Every area</TableCell>
                    <TableCell className="text-sm text-muted-foreground">All workspaces</TableCell>
                    <TableCell className="text-sm text-muted-foreground">—</TableCell>
                    <TableCell />
                  </TableRow>
                  {roles.map((role) => (
                    <TableRow key={role._id}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{role.name}</span>
                          {role.description ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {role.description}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-80">
                        <div className="flex flex-wrap gap-1">
                          {role.scopes.map((scope) => (
                            <Badge
                              key={scope}
                              variant={role.viewOnly?.includes(scope) ? "outline" : "secondary"}
                            >
                              {labelOf.get(scope) ?? scope}
                              {role.viewOnly?.includes(scope) ? " · view" : ""}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {role.allWorkspaces ? "All workspaces" : "Picked per person"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {role.memberCount}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <RoleDialog role={role} />
                          <RemoveRoleButton role={role} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
