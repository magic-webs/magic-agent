import { defineSchema } from "convex/server";
import { authTables } from "./auth";
import { workspacesTables } from "./workspaces";
import { agentsTables } from "./agents";
import { conversationsTables } from "./conversations";
import { recordsTables } from "./records";
import { integrationsTables } from "./integrations";
import { billingTables } from "./billing";
import { marketingTables } from "./marketing";
import { notificationsTables } from "./notifications";
import { instagramTables } from "./instagram";
import { paymentsTables } from "./payments";

export * from "./validators";
export * from "./instagram";

export default defineSchema({
  ...authTables,
  ...workspacesTables,
  ...agentsTables,
  ...conversationsTables,
  ...recordsTables,
  ...integrationsTables,
  ...billingTables,
  ...marketingTables,
  ...notificationsTables,
  ...instagramTables,
  ...paymentsTables,
});
