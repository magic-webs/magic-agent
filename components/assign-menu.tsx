"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/use-session";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Tick02Icon,
  UserCircleIcon,
  UserRemove01Icon,
} from "@hugeicons/core-free-icons";


export function AssignMenu({
  conversationId,
  workspaceId,
  assignedMemberId,
}: {
  conversationId: Id<"conversations">;
  workspaceId: Id<"workspaces">;
  assignedMemberId: Id<"teamMembers"> | undefined;
}) {
  const session = useSession().me;
  const me = session?.role === "member" ? session.memberId : undefined;
  const members = useQuery(api.team.activeForReply, { workspaceId });
  const assign = useMutation(api.conversations.assign);
  const assignee = members?.find((member) => member._id === assignedMemberId);

  const pick = async (memberId: Id<"teamMembers"> | null) => {
    try {
      await assign({ conversationId, memberId });
      const name = members?.find((member) => member._id === memberId)?.name;
      toast.add({
        title: memberId ? `Assigned to ${memberId === me ? "you" : name}` : "Unassigned",
        type: "success",
      });
    } catch (error) {
      toast.add({ title: "Could not assign", description: friendlyError(error), type: "error" });
    }
  };

  const ordered = [...(members ?? [])].sort(
    (a, b) => Number(b._id === me) - Number(a._id === me)
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="max-w-40 max-sm:size-8 max-sm:px-0"
            aria-label={assignee ? `Assigned to ${assignee.name}` : "Assign"}
            title={assignee ? `Assigned to ${assignee.name}` : "Assign to a team member"}
          />
        }
      >
        <HugeiconsIcon icon={UserCircleIcon} strokeWidth={2} />
        <span className="truncate max-sm:hidden">
          {assignee ? (assignee._id === me ? "You" : assignee.name) : "Assign"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Assign to</DropdownMenuLabel>
          {ordered.map((member) => (
            <DropdownMenuItem key={member._id} onClick={() => void pick(member._id)}>
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className={cn(member._id !== assignedMemberId && "invisible")} />
              <span className="min-w-0 flex-1 truncate">
                {member.name}
                {member._id === me ? " (you)" : ""}
              </span>
              {member.role ? (
                <span className="truncate text-xs text-muted-foreground">{member.role}</span>
              ) : null}
            </DropdownMenuItem>
          ))}
          {members?.length === 0 ? (
            <DropdownMenuItem disabled>No team members yet</DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {assignedMemberId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void pick(null)}>
              <HugeiconsIcon icon={UserRemove01Icon} strokeWidth={2} /> Unassign
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
