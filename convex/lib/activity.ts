import type { DataModel, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { GenericDatabaseWriter } from "convex/server";
import type { Principal } from "./auth";

/** Per mutation: who is behind it, read once, and how much it has logged. */
export type ActivityState = {
  principal: () => Promise<Principal | null>;
  written: number;
};

export type ActivityCtx = MutationCtx & { activity: ActivityState };

type AnyDoc = Record<string, unknown> & { _id: string };

type TableConfig = {
  entity: string;
  name?: (doc: AnyDoc) => unknown;
  /** Only these fields count as a change; everything else is bookkeeping. */
  only?: string[];
  skipInsert?: (doc: AnyDoc) => boolean;
  skipDelete?: boolean;
};

const field = (...keys: string[]) => (doc: AnyDoc) =>
  keys.map((key) => doc[key]).find((value) => typeof value === "string" && value);

export const LOGGED_TABLES: Partial<Record<TableNames, TableConfig>> = {
  workspaces: { entity: "Workspace", name: field("name") },
  agents: { entity: "Agent", name: field("botName", "name") },
  tools: { entity: "Tool", name: field("displayName", "name") },
  knowledgeSources: { entity: "Knowledge", name: field("title", "filename") },
  channels: { entity: "Channel", name: field("name") },
  products: { entity: "Product", name: field("name") },
  orders: { entity: "Order", name: field("orderNumber") },
  recordBooks: { entity: "Record book", name: field("name") },
  records: {
    entity: "Record",
    name: field("reference"),
    skipInsert: () => true,
    skipDelete: true,
  },
  recordWebhooks: { entity: "Record webhook", name: field("name") },
  leadStages: { entity: "Lead stage", name: field("name") },
  leadTags: { entity: "Lead tag", name: field("name") },
  contacts: {
    entity: "Contact",
    name: field("name", "phone", "email"),
    skipInsert: (doc) => doc.source !== "manual",
  },
  conversations: {
    entity: "Conversation",
    only: ["status", "humanHandling", "markedBot", "leadStageId", "leadTagIds"],
    skipInsert: () => true,
    skipDelete: true,
  },
  teamMembers: { entity: "Team member", name: field("name") },
  memberCredentials: { entity: "Team login", name: field("username", "email") },
  workspaceCredentials: { entity: "Workspace login" },
  mcpTokens: { entity: "MCP token", name: field("prefix") },
  integrationConnections: { entity: "Integration", name: field("integration") },
  appConnections: { entity: "App connection", name: field("app") },
  marketingTemplates: { entity: "Marketing template", name: field("name") },
  marketingEvents: { entity: "Marketing event", name: field("title") },
  marketingCampaigns: { entity: "Marketing campaign", name: field("title") },
  marketingSettings: { entity: "Marketing settings" },
  audiences: { entity: "Audience", name: field("name") },
  instagramRules: { entity: "Instagram rule", name: field("name") },
  notificationSettings: { entity: "Notification settings" },
  notificationRules: { entity: "Alert", name: field("name") },
  emailTemplates: { entity: "Email template", name: field("name") },
  billingSubscriptions: { entity: "Subscription", name: field("planId") },
};

const IGNORED = new Set([
  "_id",
  "_creationTime",
  "createdAt",
  "updatedAt",
  "issuedAt",
  "lastLoginAt",
  "lastUsedAt",
  "lastCalledAt",
  "callCount",
  "chunkCount",
  "charCount",
  "lastSerial",
  "recordCount",
  "lastStatus",
  "lastResponseStatus",
  "lastError",
  "lastDeliveredAt",
  "messageCount",
  "lastActiveAt",
  "lastReplyText",
  "lastReplyAt",
  "sentCount",
  "failedCount",
  "skippedCount",
  "cursor",
  "startedAt",
  "finishedAt",
  "resultCount",
  "lastResultAt",
  "syncedAt",
  "memberCount",
  "lastFiredAt",
  "lastInboundPayload",
  "inboundSampleAt",
  "lastInboundAt",
  "templatesSyncedAt",
  "templatesSyncError",
  "lastBirthdayRun",
  "searchBlob",
  "accessToken",
  "accessTokenExpiresAt",
  "lastSeenAt",
  "paidCount",
  "currentStart",
  "currentEnd",
  "chargeAt",
]);

const RENAMED: Record<string, string> = {
  passwordHash: "password",
  tokenHash: "token",
  leadStageId: "lead stage",
  leadTagIds: "lead tags",
  humanHandling: "human takeover",
  markedBot: "bot flag",
};

/** A single mutation that rewrites a whole catalogue logs its first rows only. */
const MAX_PER_MUTATION = 50;

function changedFields(oldDoc: AnyDoc, newDoc: AnyDoc, only?: string[]): string[] {
  const keys = new Set([...Object.keys(oldDoc), ...Object.keys(newDoc)]);
  return [...keys]
    .filter((key) => (only ? only.includes(key) : !IGNORED.has(key)))
    .filter((key) => JSON.stringify(oldDoc[key]) !== JSON.stringify(newDoc[key]))
    .map((key) => RENAMED[key] ?? key);
}

async function nameOf(
  db: GenericDatabaseWriter<DataModel>,
  table: TableNames,
  doc: AnyDoc,
  config: TableConfig
): Promise<string | undefined> {
  if (table === "conversations") {
    const contact = await db.get("contacts", doc.contactId as Id<"contacts">);
    return contact?.name ?? contact?.phone ?? undefined;
  }
  const name = config.name?.(doc);
  return typeof name === "string" ? name.slice(0, 120) : undefined;
}

export async function logChange(
  ctx: ActivityCtx & { innerDb: GenericDatabaseWriter<DataModel> },
  table: TableNames,
  change: {
    id: string;
    operation: "insert" | "update" | "delete";
    oldDoc: AnyDoc | null;
    newDoc: AnyDoc | null;
  }
): Promise<void> {
  const config = LOGGED_TABLES[table];
  const doc = change.newDoc ?? change.oldDoc;
  if (!config || !doc) return;

  const workspaceId = (
    table === "workspaces" ? doc._id : doc.workspaceId
  ) as Id<"workspaces"> | undefined;
  if (!workspaceId) return;

  if (change.operation === "insert" && config.skipInsert?.(doc)) return;
  if (change.operation === "delete" && config.skipDelete) return;

  let fields: string[] | undefined;
  if (change.operation === "update") {
    fields = changedFields(change.oldDoc!, change.newDoc!, config.only);
    if (fields.length === 0) return;
  }

  if (ctx.activity.written >= MAX_PER_MUTATION) return;
  const principal = await ctx.activity.principal();
  if (!principal) return;
  ctx.activity.written += 1;

  await ctx.innerDb.insert("activityLogs", {
    workspaceId,
    actorRole: principal.role,
    actorId: actorIdOf(principal),
    actorLabel: principal.label,
    table,
    entity: config.entity,
    operation: change.operation,
    docId: change.id,
    name: await nameOf(ctx.innerDb, table, doc, config),
    ...(fields ? { fields } : {}),
  });
}

export function actorIdOf(principal: Principal): string {
  if (principal.role === "admin") return principal.adminId;
  if (principal.role === "member") return principal.memberId;
  if (principal.role === "user") return principal.userId;
  return principal.workspaceId;
}

export const ACTIVITY_ENTITIES = [
  ...new Set(Object.values(LOGGED_TABLES).map((config) => config.entity)),
].sort();
