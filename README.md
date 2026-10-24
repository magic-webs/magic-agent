# Magic Agent

A multi-tenant platform for building, configuring and running AI chat agents.
Where `printly-ai-bot` is one hard-coded bot for one printing company, this is
the generalised version: create a **Workspace** for any company or project,
configure agents in the dashboard, and the same runtime serves WhatsApp,
Instagram, an embeddable web chat widget and the dashboard's own playground.

This repo is the web console and the whole backend. The phone app
([magic-agent-app](https://github.com/magic-webs/magic-agent-app)) is a second
client of the same Convex deployment, and an MCP server in `mcp/` exposes the
platform to AI assistants.

Stack: Next.js 16 (App Router) · Convex (database, vector search, actions, HTTP
endpoints, crons) · Cloudflare R2 for files · AI SDK v7 through the Vercel AI
Gateway · Zod · shadcn/ui on Base UI · Tailwind v4 · Razorpay · bun.

---

## The core concept: a Workspace

A **Workspace** is one tenant — a company or a project. Everything else hangs
off it, so nothing about a vertical is baked into code:

| Inside a workspace | What it is |
| --- | --- |
| **Agents** | A front desk that answers first and routes, specialists it hands over to, a follow-up desk and a marketing desk. Each has a name, role, job description, tone, rules, guardrails, model settings and tool permissions |
| **Knowledge base** | Pasted text, FAQs, URLs or uploaded files, chunked and embedded into Convex's vector index |
| **Catalogue** | Products, services, brochures (with a file) and other items, plus the exact specification questions the agent must collect for each |
| **Record books** | What conversations collect, with fields and stages the workspace defines. Every workspace has an **Orders** book; a booking, a site visit or a membership gets a book of its own |
| **Leads** | Every conversation filed at a lead stage by the follow-up desk, which also sends a couple of nudges |
| **Custom tools** | Extra capabilities you define — an HTTP call or a read-only query over workspace data. Can be **generated from a plain-language task description** |
| **Integrations** | Google Sheets, Calendar and Drive, plus Magic Forms and Magic Reward |
| **Channels** | WhatsApp numbers, Instagram accounts and web widgets, each routed to an agent |
| **Conversations** | Every thread across every channel, with the tool trace for each turn, and human takeover |
| **Marketing** | Audiences, WhatsApp templates, greetings, birthdays, event reminders and broadcasts |
| **Alerts** | WhatsApp templates or emails sent when a record is filed or moves, an agent escalates, or another system posts in |
| **Team** | Human agents with their own logins |

Routes live under `/w/<slug>/…`. A marketing page sits at `/`, the platform
console at `/admin`, sign-in at `/login`, a human agent's escalations desk at
`/desk`, the chat widget at `/widget/<channelKey>`, and the legal pages the
stores require at `/privacy`, `/terms`, `/support` and `/delete-account`.

---

## Getting started

```bash
bun install
npx convex dev          # pushes the schema + functions, generates types
npx convex env set AI_GATEWAY_API_KEY vck_...   # required — actions run on Convex

# Session signing key — see Authentication below
node -e '(async()=>{const p=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);const k=await crypto.subtle.exportKey("pkcs8",p.privateKey);const j=await crypto.subtle.exportKey("jwk",p.publicKey);console.log("JWT_PRIVATE_KEY="+Buffer.from(k).toString("base64"));console.log("JWT_PUBLIC_JWK="+JSON.stringify({kty:j.kty,n:j.n,e:j.e,alg:"RS256",use:"sig",kid:"magic-ai-bot-1"}))})()'
npx convex env set JWT_PRIVATE_KEY "<value from above>"
npx convex env set JWT_PUBLIC_JWK  "<value from above>"

# File storage — logos, team photos, product files, knowledge uploads
npx convex env set R2_BUCKET            <bucket>
npx convex env set R2_ENDPOINT          https://<account>.r2.cloudflarestorage.com
npx convex env set R2_ACCESS_KEY_ID     <key id>
npx convex env set R2_SECRET_ACCESS_KEY <secret>
npx convex env set R2_PUBLIC_URL        https://<public bucket domain>

bun dev
```

`.env.local` needs `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`
(both written by `convex dev`). The gateway key, the signing key and everything
below must be set **on the Convex deployment**, not just in `.env.local`, because
every model call, every token signature and every webhook happens inside Convex.
[.env.example](.env.example) annotates each one.

| Convex env var | Needed for |
| --- | --- |
| `PUBLIC_SITE_URL` | Optional. The public origin for webhook, tracked-link and OAuth URLs. Pair it with `NEXT_PUBLIC_SITE_URL` in Next, which proxies those paths to Convex |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google integrations |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | The Instagram channel. `META_APP_SECRET` is the fallback for checking webhook signatures |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Billing |
| `INTEGRATIONS_SECRET_KEY` | Workspaces connecting their own Razorpay for payment links. Encrypts their key secret; changing it means they reconnect |
| `ZEPTOMAIL_TOKEN` (+ optional `_URL`, `_FROM_EMAIL`, `_FROM_NAME`) | Email alerts |
| `EXPO_ACCESS_TOKEN` | Optional. Push to the mobile app |
| `FISH_VOICE_MALE`, `FISH_VOICE_FEMALE` | Spoken agent greetings |
| `TRACKING_BASE_URL` | Optional. The base for marketing short links; `PUBLIC_SITE_URL` when unset |
| `MAGIC_FORMS_API_URL`, `MAGIC_REWARD_API_URL` | Optional. Point the Magic apps at development deployments |

To create or reset the platform administrator from `.env.local`
(`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`), run `bun run provision:admin`.
`-- --generate` writes a fresh strong password for you. The command is safe to
re-run: it resets the password and revokes that admin's sessions.

### Deploying

Build the backend and the frontend together, with the Vercel project's build
command set to `bunx convex deploy --cmd 'bun run build'`. There is no
`vercel.json`, so the command lives in the project settings. The two halves are
one program. A frontend that knows about a Convex function the backend does not
have yet does not fail at build. It fails in the browser, as a blank page, on
whichever route calls it first.

That build command needs **`CONVEX_DEPLOY_KEY`** in the Vercel project's
environment variables: a production deploy key from the Convex dashboard
(Settings → Deploy keys). Without it the build stops before Next runs.

Open `/login`. While no administrator exists that page offers a one-time setup
form to create the first one; it locks itself the moment an account exists.

Then, in the console:

1. **New workspace.** On `/admin/workspaces`: name, description, locale and
   currency.
2. **Onboarding.** `/w/<slug>/onboarding` walks through six steps: profile,
   company facts, agents, knowledge, catalogue and lead stages. Each step shows
   what is still missing, and none of them blocks the rest of the console. The
   description and the facts are injected into every agent prompt, so being
   specific pays off.
   [docs/onboarding-brief-template.md](docs/onboarding-brief-template.md) is
   the questionnaire to send a client beforehand.
3. **Agents.** A front desk comes with the workspace. Add specialists from a
   template (sales, lead qualifier, support, after-sales, bookings, careers),
   or **draft from a brief**: describe the job in a sentence and the model
   writes the persona, tone, rules and guardrails for you to review. The
   agents page has a map view of the routing.
4. **Test in chat.** Talk to it in the playground, with the tool trace and any
   handoff visible.
5. **Channels.** Connect WhatsApp (paste the WABA credentials, then copy the
   callback URL and verify token into Meta), sign in to Instagram, or create a
   web widget and paste its one-line script into a site. Then switch it live.
6. **Hand over the keys.** On `/admin/access`, generate a password for the
   workspace. It is shown once. Send it to the company with the workspace ID,
   which is their username. They sign in at `/login` and land straight in
   their own workspace, and can then issue logins to their own human agents
   from the Team page.

An AI assistant can do most of this through the [MCP server](#mcp-server).

---

## Models

Every model call goes through the [Vercel AI
Gateway](https://vercel.com/docs/ai-gateway), so one `AI_GATEWAY_API_KEY`
reaches all of them. The platform runs a fixed set, listed in `MODELS` in
`convex/lib/shared.ts`:

| Use | Model | Notes |
| --- | --- | --- |
| Chat (default) | `anthropic/claude-haiku-5.5` | Tool-capable, reads images, 1M context, $0.10/$0.50 per million tokens, prompt-cached through the gateway |
| Chat | `deepseek/deepseek-v4.1-flash` | Tool-capable, reads images, 1M context, $0.30/$1.20 per million tokens |
| Embedding | `openai/text-embedding-3-small` | The `knowledgeChunks` vector index is pinned to 1536 dimensions — any other model stops matching and every source in every workspace needs re-embedding |
| Classification | `typesafe-ai/jev` | Sorts and scores imported contacts, reads RSVPs from event guests' replies |

Two more are fixed in `convex/lib/gateway.ts` rather than listed: `openai/whisper-1`
(`TRANSCRIPTION_MODEL`) transcribes WhatsApp voice notes, and
`fish-audio/s2.1-pro-free` (`SPEECH_MODEL`) speaks an agent's greeting
(`convex/speech.ts`), in the voice set by `FISH_VOICE_MALE` or
`FISH_VOICE_FEMALE`.

/admin/models can relabel and reprice these, take a chat model out of the agent
picker, and switch prompt caching off for an Anthropic model. It also holds the
**image processing** switch: while it is off (the default), a photo a customer
sends is described to the model rather than shown to it. It cannot add models.
An agent saved with a model outside the list runs on the default chat model.
Every call is costed into `usageEvents`, rolled up daily, and shown on
**/admin/usage** (Tokens & cost).

`convex/lib/gateway.ts` is the only file that builds a provider, and only the
Node-runtime actions import it — `lib/shared.ts` is imported by React, so the
model *ids* live there and the SDK never reaches the browser bundle.

## Architecture

### One engine, two front doors

`convex/engine.ts` holds a single `runTurn` implementation with two entry
points, so the authorized dashboard path and the unauthenticated webhook path
cannot drift:

```
web playground ───→ api.engine.respondAsUser ──┐ (checks the caller may use this agent)
web widget ───────→ api.engine.respondFromWidget ┤ (checks the channel key + registered visitor)
WhatsApp webhook ─┐                              ├─→ runTurn ─→ generateText(tools)
Instagram webhook ┴→ internal.engine.respond ────┘    ↺ handoff  → reply + tool trace
```

A turn does:

1. `conversations.startTurn` — upsert the contact, get-or-create the
   conversation, record the inbound message and read back the replay history,
   all in **one mutation** so concurrent inbound webhooks can't fork a thread.
2. Embed the message and vector-search the knowledge base, so context is present
   on the very first model step (the `search_knowledge` tool remains available
   for follow-up lookups).
3. Compile the system prompt from the workspace + agent configuration.
4. `generateText` with the assembled toolset and `stopWhen: stepCountIs(maxSteps)`.
5. If the agent called `transfer_to_agent`, record the handoff, throw its draft
   away, and run the turn again as the colleague (see below).
6. `conversations.finishTurn` — persist the tool trace and the assistant reply.

### Agents, the front desk and handoffs

An agent has a `kind`:

| Kind | Role |
| --- | --- |
| `router` | The **front desk**. One per workspace (`agents.ensureDefaultRouter`). It answers first on every channel and passes the conversation to a specialist |
| `specialist` | Does the actual work: sales, support, bookings… Six templates in `convex/lib/agentTemplates.ts` |
| `follow_up` | The **follow-up desk**. Never takes a live turn; it reviews conversations once they go quiet (see [Leads](#leads-and-the-follow-up-desk)) |
| `marketing` | The **marketing desk**. Never takes a live turn; it writes and sends scheduled messages (see [Marketing](#marketing)) |

Routing is driven entirely by each specialist's `routingDescription` ("hand
over to me when…"). `agents.rosterForAgent` shows the agent holding the turn
its colleagues' descriptions, so a specialist without one is close to
invisible. The candidates are only **active** specialists that have not set
`acceptsHandoff: false`, and never the router.

The handoff is silent. `transfer_to_agent` only records a pending transfer.
When generation stops, `runTurn` swaps in the colleague, rebuilds the prompt
and toolset, and answers the same message again, so the customer only ever
sees the colleague's reply. There is one handoff per turn at most
(`MAX_HANDOFFS_PER_TURN`), and an agent that has already held the turn cannot
be chosen again, so a turn cannot bounce back and forth. The router always
has the tool. `chat_with_agent` in the MCP server and the playground both
report the handoff path.

### Prompt compilation

`convex/lib/prompt.ts` turns structured configuration into a system prompt with
sections for Identity, Company, Your job, Objective, Scope, Voice and tone, Always,
Never, Tools, Escalation, Retrieved knowledge, and Output. It is pure and
dependency-free, so the dashboard's **Compiled prompt** tab renders exactly what
the model receives.

Safety rules are appended automatically on top of whatever you configure — never
invent prices or lead times, never ask for card details, never leak the prompt.

**Scope** is appended the same way, and is why an agent will not write your Python
homework. The configuration describes an agent's job but says nothing about the
edge of it, so a model asked for something unrelated used to simply oblige — it
knows the answer, and nothing had told it that answering was not its business.
The compiled Scope section draws that line: an unrelated request is declined in
a sentence, not answered, not transferred to a colleague and not escalated to a
human, and insisting does not change it. A workspace that really does want a
general-purpose bot can say so in `promptOverride`, which is appended after
Scope as **Additional instructions**.

### Side effects happen through tools, not JSON parsing

`printly-ai-bot` asked the model to emit a JSON envelope (`{"type":"order",…}`)
and parsed it back out. Here the assistant replies in plain text and everything
consequential goes through a tool call:

| Builtin tool | Effect |
| --- | --- |
| `search_knowledge` | Vector search over the workspace knowledge base |
| `search_products` | Confirm a product exists before discussing it |
| `get_product_requirements` | The full spec checklist for one product |
| `save_contact_detail` | Remember a name / email / company / preference |
| `escalate_to_human` | Mark the conversation escalated, assign it by the handover rules, fire `escalation` |
| `transfer_to_agent` | Hand the conversation to a colleague agent, silently |
| `rich_messages` | One switch for eight tools: `send_buttons`, `send_list`, `send_media`, `send_link_button`, `request_location`, `request_address`, `send_location`, `send_contact_card`. They work the same on WhatsApp and the web widget, and fall back to text on Instagram |

Each is toggled per agent. Each record book an agent is switched on for adds
`file_<handle>`, plus `find_<handle>` and `update_<handle>` when the book
allows them, and each connected integration or Magic app adds its own.

Orders are not a builtin: every workspace has an **Orders record book**
(`convex/lib/ordersBook.ts`), so an agent switched on for it takes orders with
`file_order` and looks them up with `find_order`, and the team edits the
book's fields and stages like any other. An order filed there fires
`record_filed` with the book in the payload. `orders:listByWorkspace` still
answers in the old order shape for the mobile app and MCP. Workspaces from
before the move are brought over once with
`npx convex run migrations:ordersToRecords`, which copies their orders into the
book, moves agents off `create_order` / `lookup_orders`, and turns "New order"
alerts into "Record filed" alerts on the book. Every call is wrapped so a thrown error becomes a
value the model can reason about rather than a dead turn, and every call is
recorded on the conversation — visible in the playground and the transcript view.

### Record books

Everything a conversation collects lands in a **record book**
(`convex/records.ts`, `convex/lib/records.ts`). The workspace defines each
book itself:

- **Shape.** A name, a handle and a purpose, plus typed fields (text, number,
  select, boolean or date) and its own stages. Each book is a draft, active or
  archived.
- **Tools.** An agent switched on for a book gets tools named after it:
  `file_membership` always, and `find_membership` and `update_membership` when
  the book allows lookups and updates.
- **Numbering.** Each record gets a reference (the book's prefix plus six
  characters) and a serial number in that book.
- **Sources.** Records arrive from WhatsApp, the web, Instagram, the API, by
  hand, or from a **Magic Forms** submission when the book is tied to a form
  (`formSubmissions.ts`).
- **Webhooks.** Each book can have its own webhooks (`recordWebhooks`) for
  `record_filed`, `record_updated` and `record_stage_changed`, with an optional
  secret, custom headers, a test send and a delivery log.
- **Export.** Paged CSV export from the dashboard, filterable by stage.

Books created before serial numbers existed need
`npx convex run migrations:recordSerials` once.

### Leads and the follow-up desk

Every conversation can sit at a **lead stage**. A workspace starts with seven
stages: New enquiry, Qualified, Details collected, Quoted, Negotiating, Won
and Lost. Each stage's outcome is open, won or lost. Stages are edited and
reordered on the Leads page.

The follow-up desk files conversations at those stages (`convex/followUp.ts`):

- **When it reviews.** A cron runs every 15 minutes and picks up conversations
  that have been quiet for an hour and have new messages since the last review.
- **How it decides.** It reads the transcript and matches it against every
  stage's **description**, using structured output at a low temperature, so
  the descriptions are the pipeline's real configuration. Write them as tests
  someone could apply to a transcript.
- **Nudges.** While the stage is open, it may send at most two follow-ups
  (`MAX_FOLLOW_UPS`), and only inside WhatsApp's 24-hour window.
- **Pinning.** A lead moved by hand (`leads.setStage`) is **pinned**, and the
  desk leaves it alone until the stage is cleared.

### Custom tools, including auto-generated ones

Custom tools are **rows in a table**, not code. A tool declares its parameters
declaratively; at runtime `convex/lib/toolSchema.ts` converts them to JSON
Schema and the AI SDK's `dynamicTool()` hands them to the model.

Two kinds:

- **`http`** — a templated request. `{{parameter}}` placeholders in the URL,
  headers and body; anything not consumed by a template rides along as a query
  parameter. Timeout-bounded, response truncated.
- **`db_query`** — a read-only, workspace-scoped query over `products`,
  `orders` or `contacts`.

`ai.draftTool` generates one from a task description:

> "Check whether we can deliver to a UK postcode and how many working days it takes"

The model picks the kind, names the tool, writes the model-facing description,
designs the parameters, and fills in the request from any endpoint details you
paste. A drafted tool lands as a **draft** — never given to the model — unless
you opt in, and it is force-held as a draft if the endpoint or credentials still
contain placeholders.

### Google integrations

Sheets, Calendar and Drive are **recipes for the custom-tool machinery above**,
not a second runtime: connecting one writes `tools` rows tagged with its id and
the same HTTP executor runs them.

There is nothing to configure. Connecting is one button — Google's consent
screen, then back to the console with the spreadsheet or the Drive folder
already created in the operator's own account and the tools already written.
`convex/lib/integrations.ts` is the catalogue, and the dashboard renders the
same descriptions the model reads.

Both halves of OAuth live on the Convex deployment rather than the Next app, so
the client secret and the refresh token never leave Convex and the callback URL
is stable per deployment:

```
https://<deployment>.convex.site/integrations/google/callback
https://<deployment>.convex.site/integrations/google/<action>?token=<call token>
```

`integrations.startGoogleConnect` is an action, not a mutation, because the
`state` parameter needs real randomness — mutations run on a deterministic
seed. It writes an `integrationOAuthStates` row, which the callback consumes;
that row is the only thing tying Google's redirect back to the workspace that
started it, since the callback lands on a domain with no session cookie.

The endpoints are public, so the call token in the query string is the whole
credential. It is per connection, which is what makes disconnecting a real
revocation, and a token for Drive cannot reach the Calendar endpoints.

**Tools are opt-in per agent.** Connecting writes the tools workspace-wide and
enabled, but an agent only receives one if its name is in
`agents.integrationTools` — the switches under an agent's Knowledge & tools
tab. Connecting Google Calendar should not silently hand the diary to every
live agent. `tools.resolveForAgent` is where that gate is applied, and only for
integrations the catalogue still knows about, so tools left behind by the
earlier Slack and Zapier cards keep working as ordinary HTTP tools.

Scopes are the narrowest that do the job: `spreadsheets`, `calendar.events`,
and `drive.file` + `drive.metadata.readonly` — metadata only, because the agent
sends links and never needs to read a file.

Setup, once per deployment:

```bash
# Google Cloud console → APIs & Services → Credentials → OAuth client ID
#   Type: Web application
#   Authorised redirect URI: https://<deployment>.convex.site/integrations/google/callback
# Enable the Sheets, Calendar and Drive APIs on the same project.
npx convex env set GOOGLE_CLIENT_ID     <id>.apps.googleusercontent.com
npx convex env set GOOGLE_CLIENT_SECRET <secret>
```

Until those are set the Integrations page says so and the connect buttons are
disabled. `drive.metadata.readonly` is a sensitive scope, so a production
deployment needs the consent screen verified before it can be used outside the
test users list.

### Magic apps — Magic Forms and Magic Reward

Our own two products, connected by an API key made in each app rather than by
OAuth (`convex/apps.ts`, catalogue in `convex/lib/apps.ts`). Connecting reads
the account, copies its published forms or live offers into
`appConnections.items`, and registers a signed webhook back to this deployment:

```
https://<deployment>.convex.site/apps/<inboundKey>
```

An agent with the app switched on under Knowledge & tools gets one tool —
`send_form` or `send_offer` — built by the engine rather than stored as a
`tools` row, because it needs the conversation: it mints a ref, files it in
`appLinks` against this thread, asks the app for a link carrying it (name and
number prefilled), and sends the link as a button. When the customer submits
the form or plays the offer, the app posts the result with the ref, the route
checks the signature and matches the ref, and the result arrives in the thread
as the customer's next turn — `[Form submitted …]` / `[Played the offer …]` —
which the agent answers (switchable per app) and push and the workspace webhook
report as `form_submitted` / `offer_played`. A result with no ref, such as a
form filled from a link on a website, is acknowledged and dropped.

Nothing to set up: the apps are reached at `https://forms.magicwebs.ai` and
`https://reward.magicwebs.ai`. A development deployment can point elsewhere —
at the apps' own development deployments — with:

```bash
npx convex env set MAGIC_FORMS_API_URL  https://<forms-deployment>.convex.site
npx convex env set MAGIC_REWARD_API_URL http://localhost:3001
```

### Knowledge base

`knowledge.addSource` schedules `ingest.processSource`, which extracts text
(PDF via `pdf-parse-fork`, HTML stripped to text, plain text as-is), chunks on
paragraph boundaries with overlap, embeds in batches with
`text-embedding-3-small`, and writes to `knowledgeChunks`.

Scoping uses a composite filter key so a single vector query can fetch both
workspace-wide and agent-private chunks:

```
`${workspaceId}|*`          → shared across the workspace
`${workspaceId}|${agentId}` → private to one agent
```

### WhatsApp

The inbound webhook is a **Convex HTTP action** (`convex/http.ts`), not a Next
route. Two reasons: the URL is public without a tunnel — so local development
works against a real WhatsApp number — and the channel's access token never
leaves Convex.

```
https://<deployment>.convex.site/whatsapp/<channelKey>
```

`GET` performs Meta's verification handshake against the channel's stored
verify token. `POST` acknowledges immediately and schedules
`whatsapp.handleInbound`, so Meta never sees a slow response and never retries.

`handleInbound` resolves the channel, marks the message read and shows a typing
indicator, works out what the customer sent, runs the engine, and sends the
reply back with that channel's credentials. A reply longer than WhatsApp's body
limit is split across messages.

Every inbound type is parsed:

- **Text.** Plain text, button and list replies, catalogue orders, reactions,
  locations and contact cards.
- **Voice notes.** Transcribed with Whisper.
- **Images.** Shown to the model only when the admin's image-processing switch
  is on; otherwise the model is told a photo arrived. A burst of photos is
  answered once: each image waits 15 seconds (`IMAGE_SETTLE_MS`), and only the
  last one gets a reply.
- **Documents and video.** Recorded with a signed proxy link
  (`/whatsapp-media/<channelId>/<mediaId>?sig=`) for the transcript, but not read.

The webhook also carries delivery statuses, which drive the transcript's ticks
(pending → sent → delivered → read, or failed, and only ever forward), and the
price Meta charged (see [the wallet](#the-wallet)).

Credentials are stored per channel, so one workspace can run several numbers.
Templates are submitted and synced through **the panel**, the WhatsApp
provider each channel connects through at its `apiBaseUrl`. It speaks Meta's
Cloud API shapes (`convex/lib/panel.ts`). Access tokens are masked
(`••••••••1234`) in every public query; the full value is only readable by
internal functions.

### Instagram

`convex/instagram.ts` connects an account with Instagram Login (OAuth). The
redirect goes to `<PUBLIC_SITE_URL>/instagram/callback`, and the account's
messages then arrive at:

```
https://<deployment>.convex.site/instagram/webhook
```

The webhook is verified with `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, and each event's
signature is checked against `INSTAGRAM_APP_SECRET`. Meta's
`/instagram/deauthorize` and `/instagram/data-deletion` callbacks are served
too. Tokens are refreshed by a daily cron. Rich messages fall back to text.

### Web widget

A web channel is a chat bubble for any website, added with one line:

```html
<script src="https://<app>/widget/<channelKey>/embed.js" async></script>
```

The loader (`app/widget/[channelKey]/embed.js/route.ts`) places a launcher
button on the host page and opens `/widget/<channelKey>?embed=1` in an iframe
on the first click. These `data-` attributes configure it:

- `data-position` (left or right) and `data-z-index`
- `data-color`, `data-icon` (whatsapp or chat) and `data-label`
- `data-teaser`, and `data-auto-open` (milliseconds, once per tab)

The loader passes on the host page's `utm_name` and `utm_phone` parameters, so a
visitor who arrives from a campaign link does not have to type them again.

Before chatting, a visitor gives a name and phone number (`widget.register`).
The channel's **intake** setting decides how: `form` asks on a sign-in page
first, `chat` asks inside the conversation. In `chat` mode the questions and
answers are saved as the thread's first messages, so the visitor keeps seeing
them and the inbox shows them; the thread stays out of lead review until the
visitor writes, and their first message still gets the welcome menu. Turns go through
`engine.respondFromWidget`, which is capped at 2,000 characters a message, and
replies arrive over the `widget.session` subscription. There is no polling.

### Inbox, human takeover and the desk

The **Conversations** page is the inbox for every channel, with All, Open,
Unread and Closed buckets, search, and an **Escalations** view of the threads
an agent handed to a person. A team member can do these things in a thread:

- **Take over.** `conversations.setHumanHandling` pauses the agent for 15
  minutes to 24 hours. A cron hands abandoned takeovers back every 15 minutes.
- **Reply.** `sendManualReply` sends text, optionally quoting a message,
  attributed to a team member.
- **React.** Send a reaction, and see the customer's.
- **Mark as bot.** A contact who repeats the same message ten times
  (`BOT_REPEAT_LIMIT`) is marked automatically.
- **Assign.** `conversations.assign` gives the thread to a team member, or
  takes it off them, with a note in the thread and a push. Any member can hand
  a thread to another. The inbox filters by assignee.

**Handover rules** (`convex/handover.ts`, on the Team page) decide who an
escalation goes to. When an agent calls `escalate_to_human`, the first enabled
rule that matches the agent and department assigns the thread. Several members
on one rule take turns, and away members are skipped. A rule can also pause the
agent so the person takes over.

Contacts can opt out: STOP and START (Hindi included) set `optedOutAt`
(`convex/lib/optOut.ts`).

A **member**, a human agent with their own login, also gets **`/desk`**. It is
the escalations view on its own: the threads an agent handed to a person, and
the ones assigned to them, with **Resolve** handing the thread back to the AI. Members are issued from the
workspace's Team page (`convex/team.ts`), and each one takes a human-agent seat
on the plan.

### Marketing

The marketing desk sends to every WhatsApp contact on a schedule, always as
approved templates, because nothing else reaches someone outside the 24-hour
window. Every message it sends is written into the contact's conversation.
Someone with no conversation gets none opened: the send log keeps what they
were sent, and their first reply opens the conversation with it, so the reply
still carries on from it.

- **Templates** (`marketingTemplates.ts`). Saved, submitted to Meta through the
  panel, then checked every 30 minutes until they are approved or rejected.
  Each has an occasion (birthday, festival, offer, event or general), a header,
  footer, buttons and a category.
- **Greetings and birthdays** (`marketing.ts`). Festival dates are preset in
  `lib/marketing.ts`, and a five-minute cron sends what is due in batches.
  Birthday wishes go out hourly, at each workspace's own local hour.
- **Events** (`marketingCampaigns.ts`, `eventGuests.ts`). The business's own
  events get reminders from up to a week before until the day after. The desk
  writes each reminder line from the event's details (`marketingAi.ts`) and
  sends it as the template's `{{message}}`. RSVPs are read from replies, and
  check-in and attendance build guest segments.
- **Broadcasts** (`marketingBroadcasts.ts`). One-off sends at 10 to 1,000 a
  minute, which can be paused, resumed or cancelled, with a report afterwards.
  **Re-engage** starts a new broadcast to the contacts with a given outcome:
  delivered, read, replied, clicked, failed or not read. **Best send time**
  sends in hourly waves, at each contact's most active hour.
- **Audience** (`audience.ts`, `audienceImports.ts`, `lib/segments.ts`). Lists,
  tags, categories and behavioural segments: read with no reply, ordered
  recently, lapsed, silent, never read. A CSV import takes up to 10,000 rows,
  and `typesafe-ai/jev` checks and categorises each one.
- **Tracked links** (`lib/links.ts`). The first URL in a message becomes
  `<site>/l/<code>` with UTM tags. A click is counted (link-preview bots are
  ignored) and redirected.

### Alerts

`convex/notifications.ts` sends an alert when one of these happens:

- a record is filed, updated or changes stage (optionally narrowed to one book
  and stage)
- an agent escalates
- another system POSTs to the alert's own inbound URL,
  `https://<deployment>.convex.site/notify/<inboundKey>`. The key can be
  rotated, and a sample can be captured to map its fields.

An alert goes out as either:

- **WhatsApp:** an approved template synced from the panel.
- **Email:** through ZeptoMail with the platform's token, from
  "<workspace> via Magic Agent".

Recipients and a template's blanks are text with `{{path}}` placeholders over
the event's payload. Every send, skip and failure is logged with its reason
(`notificationLogs`).

Separately from alerts, every dashboard change is written to an **activity
log** (`convex/activity.ts`, through the mutation wrapper in `functions.ts`)
and kept for 90 days.

### Push and the mobile app

`convex/push.ts` sends Expo push notifications to the
[mobile app](https://github.com/magic-webs/magic-agent-app) for these events:
orders, escalations, records filed, forms submitted, offers played, a low
wallet, a failed recharge and a failed subscription payment. The app's bell
reads the same events from an in-app inbox that keeps a month of them. Orders
and escalations play their own sound on Android channels named
`orders-v1` and `escalations-v1`. To change a sound, rename the channel in
both repos.

The app has no backend of its own. It calls Convex functions by name, so
renaming a function the app uses breaks the app's builds that are already
installed.

### Files

Uploads (logos, team photos, product images and brochures, knowledge files and
spoken greetings) are kept on **Cloudflare R2** through `@convex-dev/r2`
(`convex/lib/files.ts`), and served from `R2_PUBLIC_URL`. Older rows that still
hold a Convex `_storage` id keep resolving.

### Owner assistant

`convex/assistant.ts` answers the owner's questions about the business, such
as "how did today go?". It reads a snapshot of the workspace, has no tools, and
keeps its history. The mobile app's agent screen uses it.

### Billing

A company pays for two things, kept apart because they are priced apart:

| | What it is | How it is paid |
| --- | --- | --- |
| **Platform fee** | A monthly plan, plus any extra agents bought on top | Razorpay Subscriptions — card, UPI Autopay or e-mandate |
| **Wallet** | Prepaid credit every WhatsApp message is drawn from | Top-ups through Razorpay Checkout, and auto-recharge from a saved mandate |

Everything is in INR, with GST added on top at the rate the administrator
sets (18% by default).

#### Plans

Administrators edit the catalogue on **/admin/plans**. Switching billing on
seeds three plans — Starter at ₹4,999 a month, Growth and Scale — and every
one of them includes the front desk, the follow-up desk and the marketing
desk. What differs is how many **custom agents** (live specialists) and
**human agents** (people with a login of their own) a plan includes.

An **extra agent** is one more of either, from a single pool: an account on
Starter with two extras can run three custom agents and one person, or one
custom agent and three people. Its list price (₹2,499) is shown struck through
beside its price (₹999); both are the administrator's to change, and so is a
per-account discount off the plan (a percentage or a fixed amount in the
account's currency) and a per-account extra-agent price, set on
**/admin/subscriptions**.

Limits are enforced where a seat is taken: making an agent live
(`agents.update` to `active`) and issuing a human agent's login
(`authDb.upsertMemberCredential`). A draft or paused agent holds no seat.
Administrators are let through, and an account they take over its limit
shows as over on its Billing page.

#### Subscriptions

A Razorpay plan has a fixed amount, and prices here are not fixed — a
discount, a number of extras — so `razorpay.startSubscription` makes a
Razorpay plan per distinct price and remembers it (`razorpayPlans`). The
subscription starts charging where the account is already paid up to: the end
of its trial, or of the month it is leaving. Razorpay authorises a future
start with ₹5 and refunds it.

Razorpay can only edit a subscription authorised with a card, so a plan
change is a new subscription rather than an edit: when it is authorised it
becomes the account's, its limits apply at once, and the one it replaced is
cancelled — its month was already paid, and the new one charges from where
that month ends. Cancelling runs to the end of a paid month; a subscription
that has not charged yet (one authorised during a trial) ends at once.

The dashboard is open while a plan is active, during a trial, and through a
grace period (3 days by default) after a failed renewal. Past that it
**locks**: every page but Billing shows a renewal screen. Only the dashboard —
agents keep answering customers. `convex/lib/plans.ts` holds the rule
(`accessOf`), and React imports it so the banner and the lock agree with the
server. Until an administrator switches billing on nothing is enforced at
all, and switching it on starts every existing workspace's trial from that
moment rather than from when the workspace was made.

An administrator can also bill an account **by arrangement** — invoiced
offline, or given away — which bypasses Razorpay, optionally up to a date.

#### The wallet

Every sent WhatsApp message is charged to its workspace at a per-message rate
for its **conversation type** — Meta's four categories:

| Category | What is billed as it |
| --- | --- |
| Service | Free-form replies inside the 24-hour window: agent replies and rich messages, manual replies from the inbox, follow-up nudges |
| Utility | Templates approved as utility |
| Marketing | Templates approved as marketing — festival and birthday greetings. Templates saved before categories existed count as marketing |
| Authentication | Templates approved as authentication |

Rates are set by an administrator on **/admin/billing**: one platform default,
plus an optional rate card per account. Each sent message writes one
`billingEvents` row at an estimate and takes the same amount off the wallet
in the same transaction (`convex/lib/charge.ts`), so the balance and the
ledger cannot disagree. The row stays pending until WhatsApp's status webhook
reports what Meta actually charged, which settles it and refunds or debits the
difference. An hourly cron settles rows nothing ever arrived for at their
estimate. Amounts are integer millionths
of the currency, for the reason usage rows are nano-USD. Only a rate card in
the wallet's currency (INR) is taken off the wallet; the billing pages warn
when an account's rates are in anything else.

A **service** reply always goes out, even if it takes the balance below zero
— a customer who wrote in is never left unanswered for want of credit.
**Templates** are what the business starts, so a campaign or an alert whose
template the balance cannot cover is held back, and its log says why
(`templateBlock` in `convex/lib/wallet.ts`).

A top-up is its amount plus GST; the amount is what is credited. Below the
account's low-balance line the dashboard warns, a push goes to the app once
per dip, and — when auto-recharge is on — the saved mandate is charged
(`razorpay.chargeMandate`). Setting that up is a ₹1 authorisation with UPI
Autopay or a card, credited to the wallet, which leaves an "as presented"
mandate capped at ₹15,000 a debit (above that every debit needs the
customer's approval). **Auto-recharge is not instant**: the bank sends a
pre-debit notice and takes the money 25–36 hours later, so the line should
cover at least two days of spend.

Each workspace reads all of this at **/w/&lt;slug&gt;/billing**: its plan and
seats, its wallet and top-ups, and the per-message ledger. This is separate
from `usageEvents` and the **Tokens & cost** page, which are what the
platform pays the model provider.

#### Razorpay setup

```bash
npx convex env set RAZORPAY_KEY_ID      rzp_live_...   # or rzp_test_... to try it out
npx convex env set RAZORPAY_KEY_SECRET  <secret>
npx convex env set RAZORPAY_WEBHOOK_SECRET <a secret you choose>
```

Then in the Razorpay dashboard, **Settings → Webhooks → Add**:

```
https://<deployment>.convex.site/razorpay/webhook
```

with the same secret, and these events: every `subscription.*`,
`payment.captured`, `payment.failed`, `order.paid`, `token.confirmed`,
`token.rejected`, `token.cancelled`, `token.paused`. Checkout's own callback
settles a payment the moment it succeeds; renewals, failed retries and a UPI
mandate the bank confirms later only ever arrive by webhook, so billing does
not work without it. Subscriptions and recurring payments must be enabled on
the Razorpay account.

### Outbound webhooks

Events are POSTed to the workspace's endpoint as JSON, signed with
`X-Magic-Signature: sha256=<hmac>` over the raw body using the workspace
secret: `escalation`, `record_filed` / `record_updated` /
`record_stage_changed`, `form_submitted`, `offer_played`, `wallet_low`,
`wallet_recharge_failed`, `subscription_payment_failed` and `test`
(`order_created` is still sent for workspaces that subscribed to it). Every
delivery attempt is logged and visible under Settings, with a **Send test
event** button. The same events feed [alerts](#alerts) and
[push](#push-and-the-mobile-app), and record books can have
[webhooks of their own](#record-books).

---

## Authentication

Four kinds of principal:

| Role | Username is | Can see |
| --- | --- | --- |
| **admin** | their email address | every workspace, or only the ones listed for them when the platform team gives them the Member role |
| **user** | their email address | the several workspaces an administrator assigned to them (`/admin/users`), switching between them |
| **workspace** | the workspace ID | only its own workspace |
| **member** | `<workspace-id>.<name>` or their email | its workspace's whole dashboard and `/desk` — but not its password, other people's logins, MCP tokens or the subscription |

A **member** is a human agent the company gave a login from its Team page.
Each one takes a human-agent seat on the plan. What only the company itself
may do is behind `requireOwner` rather than `requireWorkspace`.

There is **one** sign-in form: username and password, no role picker.
`auth.login` resolves the namespace itself (an admin's email, then a user's,
then a workspace ID, then a member) and tells the route handler which area to
open: `/admin`, `/w/<slug>` or `/desk`. A failed attempt returns the same
generic message either way, and
is compared against an unmatchable hash so response time cannot reveal whether
the username exists.

### How a session works

There is no third-party identity provider. The deployment signs its own tokens
and verifies them through its own JWKS:

1. `/api/auth/login` calls `auth.login`, which checks the password and returns
   an opaque session token plus the resolved role. Next stores the token in an
   **httpOnly** cookie, so browser JavaScript can never read it, and answers
   with the destination for that role.
2. `/api/auth/token` exchanges that cookie for a short-lived (30 minute) RS256
   JWT.
3. `convex/http.ts` serves `/.well-known/openid-configuration` and
   `/.well-known/jwks.json`, and `convex/auth.config.ts` points `domain` at this
   deployment's own `.convex.site`. Convex therefore verifies the tokens it is
   handed with no external service — and it works in local development with no
   tunnel.
4. The browser's Convex client attaches that JWT to every request, so
   `ctx.auth.getUserIdentity()` is available in **every** Convex function without
   a token being threaded through any argument.

Because the durable credential stays in an httpOnly cookie and only short-lived
JWTs reach JavaScript, an XSS bug cannot steal a lasting session.

### One session per login

Every login — admin, company or human agent — can be open in **one place at a
time**, across the web and the mobile app together. When the password is right
but the login is already open elsewhere, `auth.login` answers `sessionActive`
with the device and when it was last used, and signs nobody in. The person then
chooses to sign that device out (`auth.continueLogin` with `replace: true`),
which ends the old session and opens the new one in a single transaction.

The session that was replaced is marked `endedReason: "replaced"` rather than
deleted, and web and app tokens carry its id, so it stops working on the very
next request. Both clients subscribe to `authDb.mySession` and swap the page for
"signed in on another device" the moment it ends.

MCP sessions — connector URLs, and the MCP server's own sign-in (`client:
"mcp"`) — are exempt: every MCP request signs in afresh, and would otherwise sign
the person out of their browser. An app build from before this change still
installed on someone's phone is refused with a sentence telling it to update,
since it cannot show the extra step.

### Two-factor authentication

Any login can add an authenticator app (TOTP, RFC 6238 — six digits, 30
seconds, HMAC-SHA1, which every authenticator defaults to) from **Settings →
Access** in its workspace, or from **Access** in the admin console. With it on,
`auth.login` answers `twoFactor` instead of signing in, and `auth.continueLogin`
takes the code. Setting it up issues ten one-time recovery codes, stored hashed.

- Secrets live in their own `twoFactor` table, keyed `role|id`, and never reach
  a browser.
- A code is spent once used, and codes are counted *before* they are checked,
  so parallel guesses share one limit: every fifth wrong code in a row locks the
  login, for 15 minutes and doubling each time up to a day.
- Whoever can reset a login's password can also clear its authenticator, and
  does by resetting it: the admin for a company, the company for a human agent,
  and `npm run provision:admin` for an administrator. That is the way back in
  for somebody who loses their phone and their recovery codes.

### Where authorization is enforced

Inside Convex, not in the UI. `convex/lib/auth.ts` exposes `requireAdmin`,
`requireWorkspace` and per-document guards (`requireAgent`, `requireOrder`, …)
that resolve a record's owning workspace before deciding. Every dashboard
function calls one, so a direct request to the Convex HTTP API from outside the
app is refused exactly as the UI would be. The few public functions meant for
the signed-out (sign-in, and the web widget, which checks its channel key and
the visitor's session) say so in their own code.

Each guard also **re-reads the underlying record**, so revoking a company's
access locks it out on the very next request rather than when its token expires.

`proxy.ts` — the Next 16 replacement for `middleware.ts` — is a UX guard only:
it keeps signed-out visitors off protected routes and sends each role to its own
area. Forging its cookies buys nothing.

### Passwords

- PBKDF2-SHA256 at 210,000 iterations (OWASP's 2023 floor) with a per-password
  salt, stored as `pbkdf2$<iterations>$<salt>$<hash>`.
- Company passwords are **generated** as four `Xxxxx` groups from an alphabet
  with `0/O` and `1/l/I` removed, because these get read aloud and retyped.
- A generated password is returned to the admin exactly once and never stored in
  plaintext. Lost means reissue, not recover.
- Issuing or rotating one revokes every open session for that workspace.
- The company is flagged `mustChangePassword` and prompted to set its own under
  **Settings → Workspace access**, after which the issuer can no longer sign in
  as them.
- A failed sign-in is compared against a dummy hash, so response time does not
  reveal whether the account exists.

---

## MCP server

`mcp/` exposes the platform's Convex functions as MCP tools, so an AI assistant
can build a workspace end to end and then test it with `chat_with_agent`, which
runs the real engine and reports the handoff path. The tool groups are:

- **Setup:** agents, the catalogue, record books, knowledge, channels and
  custom tools.
- **Operations:** conversations, `send_message`, contacts, orders and usage.
- **Sales and outreach:** leads, alerts and marketing.
- **Platform administration:** admin only.

It can be reached three ways:

| How | Command or URL | For |
| --- | --- | --- |
| stdio | `bun run mcp` (registered in `.mcp.json`) | Claude Code, Claude Desktop |
| Hosted | `https://<app>/api/mcp/<token>` (`app/api/mcp/[token]/route.ts`) | claude.ai connectors |
| Standalone HTTP | `bun run mcp:http` → `127.0.0.1:8787/mcp/<token>` | self-hosting |

It never bypasses authorization. Locally it signs in the way the dashboard does,
with `MAGIC_AI_BOT_USERNAME` / `MAGIC_AI_BOT_PASSWORD`, or falls back to
`ADMIN_*` in `.env.local`. Over HTTP the token in the path is the credential.
That is either `MAGIC_AI_BOT_MCP_TOKEN` for the deployment, or a connector
token issued on **/admin/mcp** (admin) or on a workspace's **Settings →
Connect an AI assistant**. Connector tokens are hashed, rotatable and
revocable. A workspace's token is read-only, plus `send_message`. A wrong token
and a disabled MCP both answer 404. [mcp/README.md](mcp/README.md) has the
details.

---

## Reference

### HTTP routes on the Convex site

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/.well-known/openid-configuration`, `/.well-known/jwks.json` | Our own OIDC discovery and keys |
| GET / POST | `/whatsapp/<channelKey>` | Meta verification; inbound messages, statuses, panel queue reports |
| GET | `/whatsapp-media/<channelId>/<mediaId>?sig=` | Signed proxy for media in transcripts |
| GET / POST | `/instagram/webhook` | Instagram verification and events |
| GET | `/instagram/callback` | Instagram OAuth callback |
| POST | `/instagram/deauthorize`, `/instagram/data-deletion` | Meta's account-removal callbacks (`data-deletion` also answers GET with a status page) |
| GET | `/integrations/google/callback` | Google OAuth callback |
| POST | `/integrations/google/<action>?token=` | Google tool calls |
| POST | `/apps/<inboundKey>` | Magic Forms / Magic Reward results |
| POST | `/notify/<inboundKey>` | Inbound alert URL |
| GET | `/l/<code>` | Tracked-link redirect |
| POST | `/razorpay/webhook` | Razorpay events |

With `NEXT_PUBLIC_SITE_URL` / `PUBLIC_SITE_URL` set, `next.config.ts` proxies
`/whatsapp`, `/instagram`, `/notify`, `/apps`, `/l` and `/integrations/google`
from the app's own domain, so the URLs handed to Meta, Google and customers
carry the brand rather than the Convex hostname.

### Crons (`convex/crons.ts`)

| Every | Job |
| --- | --- |
| 5 min | send due marketing greetings and event reminders |
| 15 min | review quiet conversations (follow-up desk) · hand back abandoned takeovers |
| 30 min | check marketing templates still in review |
| hour | birthday wishes · settle message charges Meta never priced · sweep abandoned OAuth handshakes |
| 6 h | prune the Magic apps delivery log |
| day | purge expired sessions · prune the activity log (90 days) and push inbox (a month) · prune the Razorpay webhook log · recount inbox totals · refresh Instagram tokens |

### Migrations

One-off backfills live in `convex/migrations.ts` and run with
`npx convex run migrations:<name>`. Examples are `ordersToRecords` (orders into
the Orders record book) and `recordSerials` (serial numbers for older records).

---

## Layout

```
convex/
  schema.ts, schema/   tables, indexes, vector index, shared validator fragments
  functions.ts         mutation wrapper that writes the activity log
  http.ts              every public HTTP route (see Reference)
  crons.ts             scheduled jobs

  # the turn
  engine.ts            retrieval → toolset → generateText → handoff → persist
  conversations.ts     threads, messages, takeover, manual replies, reactions, opt-out
  agents.ts            agents, desks, templates, handoff candidates
  ai.ts                generateObject drafting: agents, tools, catalogues
  tools.ts integrations.ts apps.ts formSubmissions.ts
  knowledge.ts ingest.ts            sources → extract → chunk → embed
  products.ts records.ts orders.ts  catalogue, record books, legacy order shape

  # channels
  channels.ts
  whatsapp.ts whatsappImages.ts deliveries.ts
  instagram.ts widget.ts

  # the team and the business
  leads.ts followUp.ts       lead stages, follow-up desk
  desk.ts team.ts            escalations desk, human agents
  contacts.ts analytics.ts assistant.ts assistantDb.ts
  notifications.ts notificationsSend.ts webhooks.ts push.ts
  marketing.ts marketingTemplates.ts marketingCampaigns.ts marketingBroadcasts.ts
  marketingSend.ts marketingAi.ts marketingTracking.ts marketingOverview.ts
  audience.ts audienceImports.ts eventGuests.ts
  speech.ts activity.ts

  # platform
  auth.ts authDb.ts auth.config.ts users.ts workspaces.ts
  models.ts usage.ts
  plans.ts subscriptions.ts wallet.ts billing.ts razorpay.ts razorpayEvents.ts
  migrations.ts

  lib/
    auth.ts            requireAdmin / requireWorkspace / requireOwner / per-document guards
    prompt.ts          configuration → system prompt (pure)
    shared.ts          builtin tools, models, default stages and desks (pure)
    toolSchema.ts      declarative parameters → JSON Schema, templating (pure)
    gateway.ts         the only file that builds a model provider
    records.ts ordersBook.ts agentTemplates.ts
    whatsappSend.ts whatsappMedia.ts panel.ts instagram.ts delivery.ts
    notifications.ts marketing.ts segments.ts links.ts optOut.ts jev.ts
    plans.ts charge.ts wallet.ts billing.ts pricing.ts
    files.ts           R2 storage

app/
  page.tsx                   landing page, written for the company
  login/                     one form for every role: setup, 2FA, replace session
  (legal)/                   privacy, terms, support, delete-account
  desk/                      a human agent's escalations desk
  widget/[channelKey]/       the chat inside the widget iframe, and embed.js
  api/auth/*                 login, logout, session, token exchange
  api/mcp/                   hosted MCP endpoint, tool catalogue
  admin/                     platform console: workspaces, access, users, team,
                             activity, usage, models, billing, plans,
                             subscriptions, mcp
  w/[slug]/
    page.tsx                 overview dashboard
    onboarding/              six-step setup hub
    agents/                  roster, cards or routing map; [agentId] config + test playground
    conversations/ contacts/ leads/ records/[bookId]/
    products/ knowledge/ tools/ integrations/ channels/ notifications/
    marketing/               overview, audience, campaigns, events, calendar, templates
    team/ company/ settings/ billing/

components/                  ui/ (shadcn on Base UI), landing/, onboarding/,
                             marketing/, billing/, integrations/, notifications/
lib/                         client helpers: session, CSV import/export, uploads
mcp/                         the MCP server (see above)
scripts/provision-admin.mjs  create or reset the platform administrator
docs/                        onboarding brief template and a filled-in example
proxy.ts                     route gate: signed-out → /login, each role → its area
```

The dashboard is client-rendered against Convex, so lists, transcripts and
ingestion status update live without polling.

---

## Not included

- **Password reset by email.** There is no self-service reset; an administrator
  reissues the password. Wiring email would remove that round trip.
- **Rate limiting on sign-in.** Failed passwords are not throttled. Only
  two-factor codes are locked out after repeated misses. Before exposing this
  to the internet, add the `@convex-dev/rate-limiter` component to
  `auth.login`.
- **Reading documents and video sent on WhatsApp.** Both are kept in the
  transcript, but the model is not shown their contents, and nothing a
  customer sends reaches the knowledge base. Images reach the model only while
  image processing is switched on.
- **Scanned/image-only PDFs.** There is no OCR in the ingestion path; text is
  extracted from the PDF's text layer. Paste the content instead.
