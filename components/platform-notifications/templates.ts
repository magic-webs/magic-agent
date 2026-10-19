import type { Category, Channel } from "./shared";

export type NotificationTemplate = {
  id: string;
  name: string;
  description: string;
  category: Category;
  channels: Record<Channel, boolean>;
  title: string;
  body: string;
  emailSubject?: string;
  emailBody: string;
  smsText: string;
  linkLabel?: string;
};

export const PLACEHOLDER = /\[[^\]\n]{2,40}\]/;

export function placeholdersIn(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(new RegExp(PLACEHOLDER, "g"))) found.add(match[0]);
  }
  return [...found];
}

export const TEMPLATES: NotificationTemplate[] = [
  {
    id: "monthly-update",
    name: "Monthly product update",
    description: "A round-up of what shipped this month",
    category: "update",
    channels: { push: true, email: true, sms: false },
    title: "What's new in Magic Agent this [Month]",
    body: "[Highlight 1], [Highlight 2] and more improvements are live in your workspace. Tap to see what changed.",
    emailSubject: "Your [Month] product update from Magic Agent",
    emailBody:
      "Here is everything we shipped this month to help your agents sell and support better.\n\n• [Highlight 1] — [one line on what it does for them]\n• [Highlight 2] — [one line on what it does for them]\n• [Highlight 3] — [one line on what it does for them]\n\nEverything is already live in your workspace; there is nothing to install.\n\nThank you for building with us.",
    smsText: "Magic Agent: [Highlight 1] and more are now live in your workspace. Details in your email.",
    linkLabel: "See what's new",
  },
  {
    id: "improvement",
    name: "Improvement shipped",
    description: "Something they already use got better",
    category: "update",
    channels: { push: true, email: true, sms: false },
    title: "[Feature] just got better",
    body: "[Feature] is now [faster / easier / smarter]. [One line on what changed for them].",
    emailBody:
      "We have improved [Feature] based on your feedback.\n\nWhat changed:\n• [Change 1]\n• [Change 2]\n\nYou do not need to do anything — the improvement is already live in your workspace.",
    smsText: "Magic Agent: [Feature] is now [faster / easier / smarter]. Already live in your workspace.",
    linkLabel: "Try it now",
  },
  {
    id: "feature-launch",
    name: "New feature launch",
    description: "Announce a new feature and how to switch it on",
    category: "feature",
    channels: { push: true, email: true, sms: false },
    title: "New: [Feature name] is here",
    body: "Your agents can now [what the feature does]. Turn it on from [where in the app].",
    emailSubject: "Introducing [Feature name]",
    emailBody:
      "We have just launched [Feature name].\n\nYour agents can now [what the feature does], so your team can [the benefit — save time, close more sales, answer faster].\n\nHow to get started:\n1. Open [where in the app]\n2. [Step two]\n3. [Step three]\n\nReply to this email if you would like us to set it up with you.",
    smsText: "Magic Agent: New [Feature name] lets your agents [what it does]. Turn it on from [where in the app].",
    linkLabel: "Set it up",
  },
  {
    id: "new-channel",
    name: "New channel available",
    description: "A new messaging channel can be connected",
    category: "feature",
    channels: { push: true, email: true, sms: false },
    title: "Your agents can now reply on [Channel]",
    body: "Connect [Channel] in a few minutes and your agents answer customers there too, from the same inbox.",
    emailSubject: "[Channel] is now available in Magic Agent",
    emailBody:
      "You can now connect [Channel] to your workspace.\n\nOnce connected, the same agents that answer on WhatsApp reply on [Channel], and every conversation lands in your one inbox with its leads and orders.\n\nConnect it from Channels → Add channel → [Channel]. It takes about [time] minutes.",
    smsText: "Magic Agent: You can now connect [Channel] — your agents reply there from the same inbox. Go to Channels to add it.",
    linkLabel: "Connect [Channel]",
  },
  {
    id: "app-update",
    name: "Mobile app update",
    description: "Ask customers to update the mobile app",
    category: "feature",
    channels: { push: true, email: false, sms: false },
    title: "A new version of the app is ready",
    body: "Update Magic Agent for [highlight] and faster performance.",
    emailBody:
      "A new version of the Magic Agent mobile app is available.\n\nWhat's new:\n• [Highlight 1]\n• [Highlight 2]\n\nUpdate from the App Store or Google Play to get it.",
    smsText: "Magic Agent: A new app version with [highlight] is ready. Update from the App Store or Google Play.",
    linkLabel: "Update the app",
  },
  {
    id: "festive-offer",
    name: "Festive offer",
    description: "A seasonal discount on plans",
    category: "offer",
    channels: { push: true, email: true, sms: true },
    title: "[Festival] offer: [X]% off your plan",
    body: "Celebrate [Festival] with [X]% off when you renew or upgrade before [date]. Use code [CODE].",
    emailSubject: "[Festival] special — [X]% off Magic Agent",
    emailBody:
      "Wishing you and your team a very happy [Festival]!\n\nTo celebrate, take [X]% off when you renew or upgrade your plan before [date].\n\nUse code [CODE] at checkout, or reply to this email and we will apply it for you.\n\nThe offer ends on [date].",
    smsText: "Magic Agent: Happy [Festival]! Get [X]% off your plan with code [CODE] till [date].",
    linkLabel: "Claim the offer",
  },
  {
    id: "upgrade-offer",
    name: "Plan upgrade discount",
    description: "Nudge customers to a bigger plan",
    category: "offer",
    channels: { push: true, email: true, sms: false },
    title: "Upgrade to [Plan] and save [X]%",
    body: "Get [benefit] with [Plan]. Upgrade before [date] and save [X]% on your first [period].",
    emailSubject: "Save [X]% when you upgrade to [Plan]",
    emailBody:
      "Your business is growing, and [Plan] is built for that.\n\nWith [Plan] you get:\n• [Benefit 1]\n• [Benefit 2]\n• [Benefit 3]\n\nUpgrade before [date] and save [X]% on your first [period].",
    smsText: "Magic Agent: Upgrade to [Plan] before [date] and save [X]%. Open Billing in your workspace.",
    linkLabel: "Upgrade now",
  },
  {
    id: "wallet-bonus",
    name: "Wallet recharge bonus",
    description: "Extra credit on message wallet top-ups",
    category: "offer",
    channels: { push: true, email: true, sms: false },
    title: "Get [X]% extra on wallet recharges",
    body: "Recharge your message wallet with [amount] or more before [date] and get [X]% extra credit.",
    emailBody:
      "For a limited time, every wallet recharge of [amount] or more gets [X]% extra credit for WhatsApp messages.\n\nRecharge from Billing → Wallet before [date]. The bonus is added automatically.",
    smsText: "Magic Agent: Recharge your wallet with [amount]+ before [date] and get [X]% extra credit.",
    linkLabel: "Recharge wallet",
  },
  {
    id: "referral",
    name: "Referral offer",
    description: "Reward customers for bringing a business",
    category: "offer",
    channels: { push: false, email: true, sms: false },
    title: "Refer a business, get [reward]",
    body: "Know a business that would love an AI agent? Refer them and you both get [reward].",
    emailSubject: "Give [reward], get [reward]",
    emailBody:
      "Know a business that spends its day answering the same WhatsApp questions?\n\nIntroduce them to Magic Agent. When they start a paid plan, you both get [reward].\n\nJust reply to this email with their name and number and we will take it from there.",
    smsText: "Magic Agent: Refer a business and you both get [reward]. Reply to our email with their details.",
    linkLabel: "Refer a business",
  },
  {
    id: "maintenance",
    name: "Scheduled maintenance",
    description: "Planned downtime, announced in advance",
    category: "notice",
    channels: { push: true, email: true, sms: true },
    title: "Scheduled maintenance on [date]",
    body: "Magic Agent will be briefly unavailable on [date] from [start] to [end] IST while we upgrade our systems.",
    emailSubject: "Scheduled maintenance: [date], [start]–[end] IST",
    emailBody:
      "We will be upgrading our systems on [date] from [start] to [end] IST.\n\nDuring this window:\n• The dashboard and mobile app may be unavailable\n• Customer messages are queued and your agents reply as soon as we are back\n\nNo action is needed from you. We are sorry for the inconvenience.",
    smsText: "Magic Agent: Scheduled maintenance on [date], [start]-[end] IST. Messages are queued and answered after.",
  },
  {
    id: "incident-resolved",
    name: "Service issue resolved",
    description: "Tell customers an incident is over",
    category: "notice",
    channels: { push: true, email: true, sms: false },
    title: "Resolved: [issue]",
    body: "The issue affecting [what was affected] between [start] and [end] IST is fixed. Everything is working normally.",
    emailSubject: "Resolved: [issue]",
    emailBody:
      "Between [start] and [end] IST on [date], [what was affected] was not working as expected.\n\nWhat happened: [one line on the cause]\nWhat we did: [one line on the fix]\nWhat it means for you: [any messages delayed, anything to check]\n\nEverything is working normally again. We are sorry for the disruption.",
    smsText: "Magic Agent: The issue with [what was affected] is resolved. Everything is working normally.",
  },
  {
    id: "policy-change",
    name: "WhatsApp policy change",
    description: "Meta pricing or policy changes that affect them",
    category: "notice",
    channels: { push: true, email: true, sms: false },
    title: "WhatsApp is changing [what] from [date]",
    body: "Meta is changing [what] from [date]. Here is what it means for your messages and costs.",
    emailSubject: "Important: WhatsApp [what] changes from [date]",
    emailBody:
      "Meta has announced a change to WhatsApp Business [what], effective [date].\n\nWhat is changing: [summary]\nWhat it means for you: [impact on messages, templates or costs]\nWhat you need to do: [action, or 'nothing — we handle it']\n\nReply to this email if you have any questions.",
    smsText: "Magic Agent: WhatsApp [what] changes from [date]. Please check your email for what it means for you.",
    linkLabel: "Read the details",
  },
  {
    id: "price-change",
    name: "Pricing change",
    description: "Advance notice of a plan price change",
    category: "notice",
    channels: { push: false, email: true, sms: false },
    title: "Changes to [Plan] pricing from [date]",
    body: "From [date], [Plan] will be [new price]. Your current price stays until your next renewal after that date.",
    emailSubject: "Upcoming change to your Magic Agent plan price",
    emailBody:
      "We are writing to let you know about a change to our pricing.\n\nFrom [date], [Plan] will be [new price] per [period], up from [old price]. [One line on why — new features, costs].\n\nYour current price stays in place until your first renewal after [date]. If you renew before then, you keep today's price for that period.\n\nReply to this email if you would like to talk through your plan.",
    smsText: "Magic Agent: [Plan] pricing changes from [date]. Please check your email for details.",
  },
];
