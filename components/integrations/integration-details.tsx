import type { IconSvgElement } from "@hugeicons/react";
import {
  Award01Icon,
  CalendarCheckIn01Icon,
  Clock01Icon,
  File02Icon,
  FlashIcon,
  Folder01Icon,
  GiftIcon,
  HierarchyIcon,
  Invoice01Icon,
  Key01Icon,
  LayoutTable01Icon,
  Link01Icon,
  Message01Icon,
  RoboticIcon,
  Search01Icon,
  SecurityCheckIcon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons";

/**
 * What the Integrations panel says about each card.
 *
 * Copy, not configuration: the model-facing tool descriptions stay in
 * convex/lib/integrations.ts and convex/lib/apps.ts, which is what the agent
 * actually reads. This is the operator's side — what connecting does, what
 * it can touch, and how to set it up — kept out of the page so the page is
 * about layout.
 */

export type Feature = { icon: IconSvgElement; title: string; body: string };

export type IntegrationDetail = {
  /** The Overview tab: three things it does, in the operator's words. */
  features: Feature[];
  /** The Permissions tab. */
  permissions: { can: string[]; never: string[] };
  /** "How to connect", as numbered steps. */
  steps: string[];
  /** The reassurance under the steps. */
  note: string;
  faq: Array<{ q: string; a: string }>;
};

export const INTEGRATION_DETAILS: Record<string, IntegrationDetail> = {
  // --------------------------------------------------------------- Magic apps
  magic_forms: {
    features: [
      {
        icon: File02Icon,
        title: "Every form, one tool",
        body: "Agents pick the right published form for the conversation and send it as a button.",
      },
      {
        icon: UserCheck01Icon,
        title: "Filled in for them",
        body: "The customer's name, number and email are already there when the form opens.",
      },
      {
        icon: Message01Icon,
        title: "Answers come back",
        body: "The submission lands in the same chat, and the agent replies to it.",
      },
    ],
    permissions: {
      can: [
        "Read the names of your published forms and which fields they have",
        "Make a prefilled link to a form for one customer",
        "Receive a copy of each submission made through a link an agent sent",
      ],
      never: [
        "Edit, publish or delete your forms",
        "Read submissions made any other way — a link on your website stays yours",
      ],
    },
    steps: [
      "In Magic Forms, open your workspace → API → Keys and create a key",
      "Paste the key above and press Connect",
      "Switch send_form on for an agent under Knowledge & tools",
    ],
    note: "Only forms sent by an agent come back into the chat. Nothing else in Magic Forms changes.",
    faq: [
      {
        q: "Which forms can an agent send?",
        a: "Every published form in the workspace the key belongs to. Publish a new one and it is offered within half an hour — or press Refresh.",
      },
      {
        q: "What happens when the customer submits?",
        a: "Their answers arrive in the conversation as their next message. With “Reply when it comes back” on, the agent answers straight away.",
      },
      {
        q: "Can I use a different Magic Forms workspace?",
        a: "Yes — replace the key with one made in the other workspace. Links already sent keep working.",
      },
    ],
  },

  magic_reward: {
    features: [
      {
        icon: GiftIcon,
        title: "Running offers only",
        body: "Agents can only send offers that are live in Magic Reward — never one they made up.",
      },
      {
        icon: UserCheck01Icon,
        title: "One tap to play",
        body: "The customer's name and number are filled in, so they go straight to the game.",
      },
      {
        icon: Award01Icon,
        title: "The prize comes back",
        body: "What they won lands in the same chat, and the agent follows it up.",
      },
    ],
    permissions: {
      can: [
        "Read your running offers and their prizes",
        "Make a personal link to an offer for one customer",
        "Receive the result of every play through a link an agent sent",
      ],
      never: [
        "Change your offers, prizes or odds",
        "Give anyone a second play — each customer plays each offer once",
      ],
    },
    steps: [
      "In Magic Reward, open your company → Settings → API keys and create a key",
      "Paste the key above and press Connect",
      "Switch send_offer on for an agent under Knowledge & tools",
    ],
    note: "Agents are told these are the only offers that exist, so they never promise a prize you did not set up.",
    faq: [
      {
        q: "Which offers can an agent send?",
        a: "Only the ones switched on in Magic Reward. Pause an offer there and agents stop sending it.",
      },
      {
        q: "What if the customer already played?",
        a: "The agent is told, and tells the customer what they got instead of sending the link again.",
      },
      {
        q: "Does the customer have to type anything?",
        a: "Only what the offer asks beyond their name and number — those are filled in.",
      },
    ],
  },

  // ------------------------------------------------------------------- Google
  google_sheets: {
    features: [
      {
        icon: LayoutTable01Icon,
        title: "A row per enquiry",
        body: "Agents log each completed enquiry as it happens — name, contact, what they want.",
      },
      {
        icon: FlashIcon,
        title: "Nothing to export",
        body: "The sheet is the export. Filter it, share it, pivot it.",
      },
      {
        icon: SecurityCheckIcon,
        title: "New or existing sheet",
        body: "We create a spreadsheet for you, or write to one you already use.",
      },
    ],
    permissions: {
      can: [
        "Create the enquiry spreadsheet in your Drive, or open the one you link",
        "Add an “Enquiries” tab and a header row if the linked sheet has none",
        "Append rows to that one spreadsheet",
      ],
      never: ["Open, read or change any spreadsheet you have not linked"],
    },
    steps: [
      "Optionally switch on “Use an existing sheet” and paste its link",
      "Click “Connect with Google” and allow access",
      "Switch log_enquiry_to_sheet on for an agent under Knowledge & tools",
    ],
    note: "Rows land in the tab open in the link you paste. Without one, the spreadsheet is created for you with headers in row 1.",
    faq: [
      {
        q: "Where is the spreadsheet?",
        a: "Either the one you linked, or a new one in the Drive of the account you connect, named after your workspace. The Open link appears here once connected.",
      },
      {
        q: "Can I switch to a different sheet later?",
        a: "Yes — press “Change sheet”, paste the link, and new enquiries go there. Nothing already written is moved.",
      },
      {
        q: "Which tab is written to?",
        a: "The tab that was open when you copied the link. If the link does not point at a tab, an “Enquiries” tab is used, and added if it is missing.",
      },
      {
        q: "Can I rename or move it?",
        a: "Yes. It is found by its id, not its name or folder. Renaming the tab, though, needs “Change sheet” again.",
      },
    ],
  },

  google_calendar: {
    features: [
      {
        icon: Clock01Icon,
        title: "Real free time",
        body: "Agents read your actual availability before offering a slot.",
      },
      {
        icon: CalendarCheckIn01Icon,
        title: "Booked with a Meet link",
        body: "The meeting goes into your diary with a Google Meet link and the customer invited.",
      },
      {
        icon: Link01Icon,
        title: "Confirmed by email",
        body: "The customer gets an email with the time and the link, and the agent shares the link in the chat.",
      },
      {
        icon: SecurityCheckIcon,
        title: "No double bookings",
        body: "A slot taken between the offer and the booking is caught.",
      },
    ],
    permissions: {
      can: [
        "Read events on your main calendar to find free time",
        "Create events with a Google Meet link and invite the customer",
        "Email the attendees a confirmation from your workspace",
      ],
      never: ["Change your calendar's settings or anyone else's calendar"],
    },
    steps: [
      "Click “Connect with Google” above",
      "Choose your Google account and allow access",
      "Switch check_availability and book_meeting on for an agent",
    ],
    note: "Slots are offered between 9:00 and 18:00 in your workspace's timezone.",
    faq: [
      {
        q: "Which calendar is used?",
        a: "The main calendar of the account you connect.",
      },
      {
        q: "How long is a meeting?",
        a: "Thirty minutes unless the agent agrees another length with the customer.",
      },
      {
        q: "Does every meeting get a Google Meet link?",
        a: "Yes, unless the customer is meeting in person. If your Google account cannot create Meet links, the meeting is still booked without one.",
      },
      {
        q: "Who gets emailed?",
        a: "Everyone invited gets Google's invitation. With “Email a confirmation” on, they also get one from your workspace; replies go to the calendar's account.",
      },
    ],
  },

  google_drive: {
    features: [
      {
        icon: Search01Icon,
        title: "Find & share files",
        body: "Agents search for the right document and share it in chat.",
      },
      {
        icon: Folder01Icon,
        title: "Price lists & brochures",
        body: "Keep your latest files in one folder and agents send them instantly.",
      },
      {
        icon: SecurityCheckIcon,
        title: "Secure access",
        body: "Only the folder we create is searched. You can revoke access anytime.",
      },
    ],
    permissions: {
      can: [
        "Create one shared folder in your Drive",
        "Search file names inside that folder and its subfolders",
      ],
      never: [
        "Read the contents of any file — agents send links",
        "See anything outside the folder",
      ],
    },
    steps: [
      "Click “Connect with Google” above",
      "Choose your Google account and allow access",
      "Put the files agents may send in the folder we create",
    ],
    note: "Only the selected folder will be searched. Subfolders are included automatically.",
    faq: [
      {
        q: "How do I add a new price list?",
        a: "Drop it in the folder. It can be sent at once — no reconnecting.",
      },
      {
        q: "Who can open the links?",
        a: "Whoever the file is shared with in Drive. Share the folder by link if customers should open everything in it.",
      },
    ],
  },

  // ----------------------------------------------------------------- Payments
  razorpay: {
    features: [
      {
        icon: Link01Icon,
        title: "Payment links in the chat",
        body: "Agents create a Razorpay link for an order's total or an agreed amount, and send it to the customer.",
      },
      {
        icon: Invoice01Icon,
        title: "Matched to the order",
        body: "When the link is paid the order moves to Confirmed, a note lands in the conversation, and your alerts fire.",
      },
      {
        icon: SecurityCheckIcon,
        title: "Your own account",
        body: "Money goes straight to your Razorpay account. The key secret is stored encrypted.",
      },
    ],
    permissions: {
      can: [
        "Create payment links in your Razorpay account",
        "Read and cancel the payment links it created",
        "Receive Razorpay's updates when those links are paid or expire",
      ],
      never: [
        "Refund, capture or move money",
        "Charge an amount that is not from your catalogue, an order, or agreed by your team",
        "Read payments made any other way",
      ],
    },
    steps: [
      "In Razorpay, open Account & Settings → API Keys and generate a key",
      "Paste the Key ID and Key Secret above and press Connect",
      "Add the webhook URL and secret shown above in Razorpay's Webhooks settings",
      "Switch create_payment_link and check_payment_status on for an agent",
    ],
    note: "Use test keys first: links made with them can be paid with Razorpay's test cards and nothing is charged.",
    faq: [
      {
        q: "What does the customer see?",
        a: "A short Razorpay link that opens a checkout with UPI, cards, netbanking and wallets, in your business's name.",
      },
      {
        q: "How does the agent know the amount?",
        a: "From the order it filed, or from the catalogue. It is told never to invent or discount a price.",
      },
      {
        q: "Can the team send a link too?",
        a: "Yes, from the Payments page, which also lists every link with its status.",
      },
      {
        q: "What if the webhook isn't set up?",
        a: "Links still work, but nothing updates here until someone presses Refresh or the agent checks the status.",
      },
    ],
  },

  // -------------------------------------------------------------- Other tools
  slack: {
    features: [
      {
        icon: Message01Icon,
        title: "Post to a channel",
        body: "An agent posts a message to your team channel when something needs a look.",
      },
      {
        icon: Link01Icon,
        title: "One webhook URL",
        body: "A Slack incoming webhook is all it takes — no app to install here.",
      },
      {
        icon: SecurityCheckIcon,
        title: "Post only",
        body: "The webhook can post to one channel and read nothing.",
      },
    ],
    permissions: {
      can: ["Post messages to the one channel the webhook was made for"],
      never: ["Read messages, members or other channels"],
    },
    steps: [
      "In Slack, create an Incoming Webhook for the channel",
      "In Custom tools, add a POST tool to that URL with the body {\"text\": \"{{message}}\"}",
      "Switch it on for an agent and say when to use it",
    ],
    note: "Custom tools run from Magic Agent's servers, so the webhook URL never reaches the browser of a customer.",
    faq: [
      {
        q: "Can the team be told about every order instead?",
        a: "Yes — use Notifications, or point the workspace webhook in Settings at a Zapier or Make scenario that posts to Slack.",
      },
    ],
  },

  zapier: {
    features: [
      {
        icon: FlashIcon,
        title: "6,000+ apps",
        body: "Send every order, record and escalation into Zapier and on to anything it connects.",
      },
      {
        icon: HierarchyIcon,
        title: "Or call a Zap",
        body: "An agent can trigger a Zap mid-conversation as a custom tool.",
      },
      {
        icon: SecurityCheckIcon,
        title: "Signed events",
        body: "Every event carries a signature so your Zap can tell it is really us.",
      },
    ],
    permissions: {
      can: ["Receive the events you choose to send it"],
      never: ["Reach into Magic Agent — Zapier only gets what is sent to it"],
    },
    steps: [
      "In Zapier, start a Zap with “Webhooks by Zapier → Catch Hook” and copy its URL",
      "Paste it as the workspace webhook in Settings → Webhook, or as a custom tool",
      "Send a test event and finish the Zap",
    ],
    note: "The same works for Make, n8n and anything else that takes a webhook.",
    faq: [
      {
        q: "Which events are sent?",
        a: "Orders, filed and updated records, stage changes, escalations and Magic app results.",
      },
    ],
  },

  webhooks: {
    features: [
      {
        icon: FlashIcon,
        title: "Every event, as it happens",
        body: "Orders, records, escalations and form results are posted to your URL.",
      },
      {
        icon: Key01Icon,
        title: "Signed",
        body: "An HMAC signature on every delivery, with a secret you can rotate.",
      },
      {
        icon: HierarchyIcon,
        title: "In as well as out",
        body: "Alerts give other systems a URL to post to, which sends a WhatsApp or email.",
      },
    ],
    permissions: {
      can: ["Post the workspace's events to the URL you set"],
      never: ["Accept anything back from that URL"],
    },
    steps: [
      "Open Settings → Webhook",
      "Paste your endpoint's URL and save",
      "Send a test event and check the delivery log",
    ],
    note: "Each record book can also have webhooks of its own, under Record books.",
    faq: [
      {
        q: "How do I check a delivery really came from us?",
        a: "Compute an HMAC-SHA256 of the body with your secret and compare it with the X-Magic-Signature header.",
      },
    ],
  },

  notion: {
    features: [
      {
        icon: File02Icon,
        title: "Write pages",
        body: "An agent adds a page to a Notion database — a lead, a request, a note.",
      },
      {
        icon: Search01Icon,
        title: "Read what you share",
        body: "Only pages you share with your Notion integration can be reached.",
      },
      {
        icon: SecurityCheckIcon,
        title: "Your token, server-side",
        body: "The integration secret stays on Magic Agent's servers.",
      },
    ],
    permissions: {
      can: ["Whatever you share with the Notion integration you create"],
      never: ["Reach pages you have not shared with it"],
    },
    steps: [
      "In Notion, create an internal integration and share a database with it",
      "In Custom tools, add a POST tool to https://api.notion.com/v1/pages with your secret as the Authorization header",
      "Switch it on for an agent and say when to use it",
    ],
    note: "Notion's API needs a Notion-Version header too — add it beside Authorization.",
    faq: [
      {
        q: "Is there a one-click Notion connection?",
        a: "Not yet. A custom tool does the same job today.",
      },
    ],
  },

  mcp: {
    features: [
      {
        icon: RoboticIcon,
        title: "Run it from Claude or ChatGPT",
        body: "Set up agents, catalogue and knowledge by asking an assistant.",
      },
      {
        icon: SecurityCheckIcon,
        title: "Your workspace only",
        body: "The connector acts for this workspace and nothing else.",
      },
      {
        icon: Key01Icon,
        title: "Revocable",
        body: "Rotate or delete the connector URL whenever you like.",
      },
    ],
    permissions: {
      can: ["Everything you can do on this dashboard, for this workspace"],
      never: ["Reach any other workspace"],
    },
    steps: [
      "Open Settings → Assistant and create a connector URL",
      "In Claude or ChatGPT, add it as a custom connector",
      "Ask it to show you your agents",
    ],
    note: "Treat the connector URL like a password — it is the whole credential.",
    faq: [
      {
        q: "What can the assistant do?",
        a: "Draft and update agents, manage the catalogue, knowledge base, record books, channels and alerts, and read conversations.",
      },
    ],
  },
};
