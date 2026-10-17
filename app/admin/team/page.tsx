"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSession } from "@/components/use-session";
import { SelectField } from "@/components/select-field";
import {
  PasswordField,
  WorkspacePicker,
  errorText,
  relative,
  type WorkspaceOption,
} from "@/components/admin-account-fields";
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
  KeyIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

type TeamRow = {
  _id: Id<"admins">;
  email: string;
  name?: string;
  role: "admin" | "member";
  roleId: Id<"adminRoles"> | null;
  workspaceIds: Id<"workspaces">[];
  createdAt: number;
  lastLoginAt: number | null;
  twoFactor: boolean;
};

type PlatformRole = Doc<"adminRoles">;

/** "admin" for the built-in role, otherwise a platform role's id. */
const ADMIN = "admin";

function MemberDialog({
  workspaces,
  roles,
  member,
}: {
  workspaces: WorkspaceOption[];
  roles: PlatformRole[];
  member?: TeamRow;
}) {
  const createAdmin = useAction(api.auth.createAdmin);
  const updateAccess = useMutation(api.authDb.updateAdminAccess);
  const { me } = useSession();
  const isSelf = Boolean(member && me?.email === member.email);

  const initial = () => ({
    email: member?.email ?? "",
    name: member?.name ?? "",
    password: "",
    access:
      member?.role === "admin"
        ? ADMIN
        : (member?.roleId ?? roles[0]?._id ?? ADMIN) as string,
    workspaceIds: member?.workspaceIds ?? [],
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(initial);

  const roleOptions = [
    { value: ADMIN, label: "Admin — everything, every workspace" },
    ...roles.map((role) => ({
      value: role._id as string,
      label: `${role.name} — ${role.allWorkspaces ? "every workspace" : "the workspaces you pick"}`,
    })),
  ];
  const chosen = roles.find((role) => role._id === form.access) ?? null;
  const role = chosen ? ("member" as const) : ("admin" as const);
  const picksWorkspaces = chosen !== null && !chosen.allWorkspaces;

  const invalid =
    (!member && (!form.email.includes("@") || form.password.length < 12)) ||
    (picksWorkspaces && form.workspaceIds.length === 0);

  const submit = async () => {
    setBusy(true);
    const access = {
      role,
      roleId: chosen?._id,
      workspaceIds: picksWorkspaces ? form.workspaceIds : [],
    };
    try {
      if (member) {
        await updateAccess({
          adminId: member._id,
          name: form.name.trim() || undefined,
          ...access,
        });
        toast.add({ title: "Access updated", type: "success" });
      } else {
        await createAdmin({
          email: form.email.trim(),
          name: form.name.trim() || undefined,
          password: form.password,
          ...access,
        });
        toast.add({
          title: `${form.email.trim()} can now sign in`,
          description: "Hand over the password — it is not stored in readable form.",
          type: "success",
        });
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: member ? "Could not update access" : "Could not add the team member",
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
          member ? (
            <Button size="sm" variant="outline">
              <PencilSimpleIcon /> Edit
            </Button>
          ) : (
            <Button>
              <PlusIcon /> Add team member
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${member.email}` : "Add a team member"}</DialogTitle>
          <DialogDescription>
            Admins reach everything. Anyone else gets the areas and workspaces
            their role opens — set those up under Roles.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {member ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-email">Email</Label>
              <Input
                id="team-email"
                type="email"
                autoComplete="off"
                value={form.email}
                placeholder="Email address"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={form.name}
              placeholder="Optional"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-role">Role</Label>
            <SelectField
              id="team-role"
              value={form.access}
              disabled={isSelf}
              options={roleOptions}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, access: value }))
              }
            />
            {isSelf ? (
              <p className="text-xs text-muted-foreground">
                You cannot change your own role.
              </p>
            ) : null}
          </div>

          {picksWorkspaces ? (
            <div className="flex flex-col gap-1.5">
              <Label>Workspace access</Label>
              <WorkspacePicker
                workspaces={workspaces}
                selected={form.workspaceIds}
                onChange={(workspaceIds) =>
                  setForm((prev) => ({ ...prev, workspaceIds }))
                }
              />
            </div>
          ) : null}

          {member ? null : (
            <PasswordField
              id="team-password"
              value={form.password}
              email={form.email}
              onChange={(password) => setForm((prev) => ({ ...prev, password }))}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || invalid} onClick={() => void submit()}>
            {busy ? <Spinner /> : member ? <PencilSimpleIcon /> : <PlusIcon />}
            {member ? "Save" : "Add team member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ member }: { member: TeamRow }) {
  const resetPassword = useAction(api.auth.resetAdminPassword);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");

  const submit = async () => {
    setBusy(true);
    try {
      await resetPassword({ adminId: member._id, password });
      toast.add({
        title: "Password reset",
        description: `${member.email} has been signed out everywhere.`,
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Could not reset the password",
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
        if (next) setPassword("");
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost">
            <KeyIcon /> Password
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset the password for {member.email}</DialogTitle>
          <DialogDescription>
            Their open sessions end and two-factor authentication is turned off,
            so they can sign in with the new password and set it up again.
          </DialogDescription>
        </DialogHeader>
        <PasswordField
          id="reset-password"
          value={password}
          email={member.email}
          onChange={setPassword}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || password.length < 12} onClick={() => void submit()}>
            {busy ? <Spinner /> : <KeyIcon />} Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveButton({ member }: { member: TeamRow }) {
  const removeAdmin = useMutation(api.authDb.removeAdmin);

  const remove = async () => {
    try {
      await removeAdmin({ adminId: member._id });
      toast.add({ title: `${member.email} removed`, type: "success" });
    } catch (error) {
      toast.add({
        title: "Could not remove the team member",
        description: errorText(error),
        type: "error",
      });
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant="ghost">
            <TrashIcon /> Remove
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are signed out at once and their login, MCP connectors and
            two-factor setup are deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
          <AlertDialogAction
            render={
              <Button variant="destructive" onClick={() => void remove()}>
                Remove
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminTeamPage() {
  const team = useQuery(api.authDb.listAdmins, {});
  const workspaces = useQuery(api.workspaces.list, {});
  const roles = useQuery(api.adminRoles.list, {});
  const { me } = useSession();
  const roleById = new Map((roles ?? []).map((role) => [role._id as string, role]));

  const options: WorkspaceOption[] = (workspaces ?? []).map((workspace) => ({
    _id: workspace._id,
    name: workspace.name,
    slug: workspace.slug,
  }));
  const nameById = new Map(options.map((option) => [option._id as string, option.name]));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Team
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The people who run the platform. A role decides which areas of this
            console they open and which workspaces they reach.
          </p>
        </div>
        <MemberDialog workspaces={options} roles={roles ?? []} />
      </header>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersThreeIcon className="size-4" /> Team members
          </CardTitle>
          <CardDescription>
            Changes to a role or its workspaces apply on their next request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {team === undefined || workspaces === undefined || roles === undefined ? (
            <TableSkeleton columns={5} rows={3} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Workspaces</TableHead>
                    <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.map((member) => {
                    const isSelf = me?.email === member.email;
                    const platformRole = member.roleId ? roleById.get(member.roleId) : undefined;
                    const everyWorkspace =
                      member.role === "admin" || Boolean(platformRole?.allWorkspaces);
                    return (
                      <TableRow key={member._id}>
                        <TableCell>
                          <div className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5 truncate font-medium">
                              {member.name || member.email}
                              {isSelf ? <Badge variant="outline">you</Badge> : null}
                              {member.twoFactor ? (
                                <Badge variant="outline">2FA</Badge>
                              ) : null}
                            </span>
                            {member.name ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {member.email}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={member.role === "admin" ? "default" : "secondary"}>
                            {member.role === "admin" ? "Admin" : (platformRole?.name ?? "Member")}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-72">
                          {everyWorkspace ? (
                            <span className="text-sm text-muted-foreground">
                              All workspaces
                            </span>
                          ) : member.workspaceIds.length === 0 ? (
                            <span className="text-sm text-muted-foreground">None</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {member.workspaceIds.map((id) => (
                                <Badge key={id} variant="outline">
                                  {nameById.get(id) ?? "Deleted workspace"}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {relative(member.lastLoginAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <MemberDialog workspaces={options} roles={roles} member={member} />
                            <ResetPasswordDialog member={member} />
                            {isSelf ? null : <RemoveButton member={member} />}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
