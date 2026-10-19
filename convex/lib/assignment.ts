import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { patchConversation } from "./inbox";

export async function assignConversation(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  member: Doc<"teamMembers"> | null,
  by: { label: string; memberId?: Id<"teamMembers"> }
): Promise<Doc<"conversations">> {
  if ((conversation.assignedMemberId ?? null) === (member?._id ?? null)) {
    return conversation;
  }
  const now = Date.now();
  const after = await patchConversation(ctx, conversation, {
    assignedMemberId: member?._id,
    assignedAt: member ? now : undefined,
    assignedByMemberId: member ? by.memberId : undefined,
  });

  const selfAssigned = member && by.memberId === member._id;
  await ctx.db.insert("messages", {
    workspaceId: conversation.workspaceId,
    conversationId: conversation._id,
    role: "system",
    kind: "note",
    text: !member
      ? `Unassigned by ${by.label}.`
      : selfAssigned
        ? `${member.name} took this conversation.`
        : `Assigned to ${member.name} by ${by.label}.`,
    createdAt: now,
  });

  if (member && !selfAssigned) {
    const contact = await ctx.db.get("contacts", conversation.contactId);
    await ctx.scheduler.runAfter(0, internal.push.notify, {
      workspaceId: conversation.workspaceId,
      event: "conversation_assigned",
      data: {
        conversationId: conversation._id,
        member: member.name,
        by: by.label,
        contact: { name: contact?.name ?? contact?.phone ?? undefined },
      },
    });
  }
  return after;
}
