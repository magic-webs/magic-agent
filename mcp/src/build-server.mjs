/**
 * The server factory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "./tools/index.mjs";

/**
 * Builds a server instance with the tools its scope allows — everything, or
 * for a company's connector only the reads and send_message.
 *
 * A factory rather than a singleton: an McpServer binds to exactly one
 * transport, and the HTTP transport needs a fresh one per client session.
 * Authentication and the Convex client are module-level, so a new instance
 * costs nothing but the registrations.
 *
 * @param {{ scope?: "full" | "workspace" }} [options]
 */
export function buildServer({ scope = "full" } = {}) {
  const server = new McpServer(
    { name: "magic-agent", version: "1.0.0" },
    { instructions: scope === "workspace" ? WORKSPACE_INSTRUCTIONS : FULL_INSTRUCTIONS }
  );

  registerAll(server, scope);

  return server;
}

const WORKSPACE_INSTRUCTIONS = [
  "Read a Magic Agent workspace — its agents, catalogue, knowledge, channels, conversations, contacts, records, leads, notifications and marketing — and reply to customers in its conversations.",
  "",
  "This connector is read-only apart from send_message. It cannot create, change or delete anything; configuration is done in the dashboard.",
  "- list_conversations finds a thread; read_conversation shows the transcript, with message ids to quote.",
  "- send_message replies on the thread's own channel, as a person in the inbox would, and pauses the agent so it does not talk over the reply. WhatsApp refuses free text more than 24 hours after the customer's last message.",
  "- Agents answer only about products in the catalogue and quote only stored prices, so list_products and list_knowledge are where to check what an agent would say.",
].join("\n");

const FULL_INSTRUCTIONS = [
        "Manage a Magic Agent workspace: agents, the front desk that routes between them, the product catalogue, the knowledge base, channels, custom tools and the marketing desk.",
  "",
  "How the platform fits together, so configuration lands in the right place:",
  "- Every workspace has one front desk agent (kind: router). It answers first on every channel and hands each conversation to the specialist that should deal with it, silently. Specialists can hand on to each other.",
  "- Routing is driven entirely by each specialist's `routingDescription` — 'hand over to me when…'. An agent without one is nearly invisible to the front desk, so always set it.",
  "- Only *active* agents receive handoffs. A draft agent gets no traffic.",
  "- Agents refuse to discuss products that are not in the catalogue, and never quote a price that is not stored on the product.",
  "- Everything a conversation collects lands in a *record book*, which defines its own fields and stages and gives the agents switched on for it tools named after it (file_membership, find_membership). Orders are one of them: every workspace has an Orders book (handle `order`, so file_order and find_order) for things sold out of the catalogue, and its fields and stages are edited like any other book's. A membership, an appointment, a site visit, a quotation for work that is not a catalogue line each belong in a book of their own, not in Orders.",
  "- The follow-up desk (kind: follow_up) reads each conversation once it has gone quiet, files it at a lead stage by matching it against every stage's description, and sends at most a couple of nudges while the stage is open. Stage descriptions are therefore the pipeline's real configuration: write them as tests a reader could apply to a transcript. A lead filed by hand with set_lead_stage is pinned, and the desk leaves it there.",
  "- Alerts (notification alerts) send a WhatsApp template or an email when a record is filed, updated or changes stage (an order taken is a record filed in the Orders book), an agent escalates, or another system POSTs to the alert's own URL. WhatsApp alerts can only send approved templates synced from the panel (sync_whatsapp_templates), because nothing else reaches someone outside the 24-hour window. A template's blanks and an alert's recipients are text with {{path}} placeholders over the event's payload — list_whatsapp_templates shows the blanks, get_notification_settings the variables each event offers. Confirm one with test_notification_alert, and read list_notification_activity for why a send did not go.",
  "- The marketing desk (kind: marketing) sends to every WhatsApp contact on a schedule: festival and one-off greetings (schedule_greeting), birthday wishes (update_birthday_wishes), and the reminders of the business's own events (save_marketing_event) — up to a week before, on the day and the day after, each with its own line the desk writes from the event's details and sends as the template's {{message}}. All of it goes out as approved templates, so the order is: save_marketing_template, apply_marketing_template (submits it to Meta through the panel), wait until list_marketing_templates shows canSend, then schedule. An event's reminders are drafts until it has a template that can send. add_marketing_contacts adds people who have not written in (pass a CSV's rows to import one, with consent confirmed). Every message the desk sends is written into the contact's conversation — opened for them if they have none — so the inbox shows it and a reply carries on from it; a thread nobody has answered yet is left out of lead review and the dashboard counts.",
  "- On a connected Instagram account, comment rules (save_instagram_rule) answer a matching comment with a public reply, one private DM, or both — the classic 'comment PRICE and we'll DM you'. Moderation hides or deletes comments with links, blocked words or abuse before any rule runs, and story mentions and ice breakers are set with update_instagram_settings. DMs sent this way land in the inbox, and the account's agent answers whatever comes back. An account connected before comment access was added shows canManageComments false and must be reconnected from the app.",
  "- With Razorpay connected (Integrations page, the workspace's own keys), agents switched on for create_payment_link send the customer a payment link for a filed order's total or an agreed amount, and check_payment_status reads whether it was paid. A paid link moves its record to the paid stage (Confirmed by default), notes it in the conversation and fires the record's alerts. list_payment_links and create_payment_link do the same from here.",
  "- After changing configuration, use chat_with_agent to see what the customer would actually get. It reports the handoff path, so you can tell whether routing worked.",
].join("\n");
