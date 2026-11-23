// What a human agent's role lets them see and change in their workspace.
//
// Three parts. Areas are the sidebar's sections, each hidden, view or edit.
// Chats is which conversations they see at all. And a few actions that cut
// across areas. A human agent without a role keeps what a login always gave
// them — everything but the owner's own settings — so issuing roles is opt-in.
//
// Edits are enforced on the tables an area owns (see `TABLE_AREAS` and the
// trigger in convex/functions.ts), so a write cannot slip past by going
// through another area's function. Chats are enforced on every read of a
// thread (`threadAccess`) and on the inbox lists.

import type { Infer } from "convex/values";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { areaLevel, chatScope, workspaceArea } from "../schema/validators";

export type WorkspaceArea = Infer<typeof workspaceArea>;
export type AreaLevel = Infer<typeof areaLevel>;
export type ChatScope = Infer<typeof chatScope>;

export const AREAS: WorkspaceArea[] = [
  "dashboard",
  "genie",
  "team",
  "build",
  "inbox",
  "leads",
  "marketing",
  "social",
  "notifications",
  "integrations",
];

export type Access = {
  /** No role: everything a human agent's login has always opened. */
  full: boolean;
  roleId: Id<"workspaceRoles"> | null;
  roleName: string | null;
  chats: ChatScope;
  areas: Record<WorkspaceArea, AreaLevel>;
  canAssignOthers: boolean;
  canDeleteChats: boolean;
  canExport: boolean;
};

const everyArea = (level: AreaLevel) =>
  Object.fromEntries(AREAS.map((area) => [area, level])) as Record<WorkspaceArea, AreaLevel>;

export const FULL_ACCESS: Access = {
  full: true,
  roleId: null,
  roleName: null,
  chats: "all",
  areas: everyArea("edit"),
  canAssignOthers: true,
  canDeleteChats: true,
  canExport: true,
};

/** The two a workspace starts with. */
export const STARTER_ROLES: Array<
  Pick<
    Doc<"workspaceRoles">,
    "name" | "description" | "chats" | "areas" | "canAssignOthers" | "canDeleteChats" | "canExport"
  >
> = [
  {
    name: "Manager",
    description: "Sees every chat and can change everything but billing and logins.",
    chats: "all",
    areas: AREAS.map((area) => ({ area, level: "edit" as const })),
    canAssignOthers: true,
    canDeleteChats: true,
    canExport: true,
  },
  {
    name: "Agent",
    description: "Answers the chats assigned to them, and picks up unassigned ones.",
    chats: "assigned_unassigned",
    areas: AREAS.map((area) => ({
      area,
      level:
        area === "inbox"
          ? ("edit" as const)
          : area === "leads"
            ? ("view" as const)
            : ("none" as const),
    })),
    canAssignOthers: false,
    canDeleteChats: false,
    canExport: false,
  },
];

export function accessFromRole(role: Doc<"workspaceRoles">): Access {
  const areas = everyArea("none");
  for (const row of role.areas) areas[row.area] = row.level;
  return {
    full: false,
    roleId: role._id,
    roleName: role.name,
    chats: role.chats,
    areas,
    canAssignOthers: role.canAssignOthers,
    canDeleteChats: role.canDeleteChats,
    canExport: role.canExport,
  };
}

/** A member's access, read from their role. A role from another workspace counts as none set. */
export async function accessOfMember(
  ctx: QueryCtx | MutationCtx,
  member: Doc<"teamMembers">
): Promise<Access> {
  if (!member.accessRoleId) return FULL_ACCESS;
  const role = await ctx.db.get("workspaceRoles", member.accessRoleId);
  if (!role || role.workspaceId !== member.workspaceId) return FULL_ACCESS;
  return accessFromRole(role);
}

export function allows(access: Access, area: WorkspaceArea, level: "view" | "edit"): boolean {
  const has = access.areas[area];
  return level === "view" ? has !== "none" : has === "edit";
}

/** Whether a thread is inside the chats a role shows. */
export function seesConversation(
  access: Access,
  memberId: Id<"teamMembers">,
  conversation: Pick<Doc<"conversations">, "assignedMemberId">
): boolean {
  if (access.chats === "all") return true;
  if (conversation.assignedMemberId === memberId) return true;
  return access.chats === "assigned_unassigned" && conversation.assignedMemberId === undefined;
}

/**
 * The areas whose edit right a write to each table needs — any one of them.
 * Tables left out are not gated: messages, counters, logs, the owner's own
 * settings (already behind `requireOwner`).
 */
export const TABLE_AREAS: Partial<Record<TableNames, WorkspaceArea[]>> = {
  workspaces: ["build"],
  agents: ["build"],
  tools: ["build"],
  knowledgeSources: ["build"],
  knowledgeGaps: ["build", "inbox"],
  channels: ["build"],
  products: ["build"],
  recordBooks: ["build"],
  recordWebhooks: ["build"],

  conversations: ["inbox", "leads"],
  contacts: ["inbox", "leads"],
  replyDrafts: ["inbox"],

  orders: ["leads"],
  records: ["leads"],
  leadStages: ["leads"],
  leadTags: ["leads"],
  paymentLinks: ["leads"],

  teamMembers: ["team"],
  handoverRules: ["team"],

  genieThreads: ["genie"],
  genieItems: ["genie"],
  genieMemory: ["genie"],

  marketingTemplates: ["marketing"],
  marketingEvents: ["marketing"],
  marketingCampaigns: ["marketing"],
  marketingSettings: ["marketing"],
  audiences: ["marketing"],
  audienceImports: ["marketing"],
  eventGuests: ["marketing"],

  instagramRules: ["social"],
  instagramSettings: ["social"],

  notificationSettings: ["notifications"],
  notificationRules: ["notifications"],
  emailTemplates: ["notifications"],

  integrationConnections: ["integrations"],
  appConnections: ["integrations"],
  appLinks: ["integrations"],
};

/** Bookkeeping a reply or an assignment writes on rows of other areas. */
export const INCIDENTAL_FIELDS = ["nextIndex"];
