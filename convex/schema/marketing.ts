import { defineTable } from "convex/server";
import { v } from "convex/values";
import { deliveryStatus, kvPair } from "./validators";
import { headerMedia, templateButton } from "../lib/templateParts";

export const audienceSelection = v.object({
  audienceIds: v.array(v.id("audiences")),
  categories: v.array(v.string()),
  tags: v.array(v.string()),
  excludeAudienceIds: v.array(v.id("audiences")),
  segments: v.optional(v.array(v.string())),
  records: v.optional(
    v.array(
      v.object({
        bookId: v.id("recordBooks"),
        stages: v.optional(v.array(v.string())),
      })
    )
  ),
});

export const guestSegment = v.union(
  v.literal("everyone"),
  v.literal("not_declined"),
  v.literal("interested"),
  v.literal("attended"),
  v.literal("no_show")
);

export const rsvpStatus = v.union(
  v.literal("going"),
  v.literal("maybe"),
  v.literal("declined")
);

export const importRowStatus = v.union(
  v.literal("queued"),
  v.literal("invalid"),
  v.literal("duplicate"),
  v.literal("check"),
  v.literal("ready"),
  v.literal("skipped"),
  v.literal("saved")
);

export const importCounts = v.object({
  queued: v.number(),
  invalid: v.number(),
  duplicate: v.number(),
  check: v.number(),
  ready: v.number(),
  skipped: v.number(),
  saved: v.number(),
});

export const variableFill = v.object({
  variable: v.union(
    v.literal("name"),
    v.literal("business"),
    v.literal("event"),
    v.literal("date"),
    v.literal("venue"),
    v.literal("message")
  ),
  source: v.union(
    v.literal("first_name"),
    v.literal("full_name"),
    v.literal("phone"),
    v.literal("email"),
    v.literal("company"),
    v.literal("birthday"),
    v.literal("attribute"),
    v.literal("business"),
    v.literal("campaign"),
    v.literal("date"),
    v.literal("text")
  ),
  key: v.optional(v.string()),
  text: v.optional(v.string()),
  fallback: v.optional(v.string()),
});

export const healthQuality = v.union(
  v.literal("GREEN"),
  v.literal("YELLOW"),
  v.literal("RED"),
  v.literal("UNKNOWN")
);

export const rolloutState = v.object({
  phase: v.union(
    v.literal("planning"),
    v.literal("sending"),
    v.literal("watching"),
    v.literal("holding"),
    v.literal("done")
  ),
  shares: v.array(v.number()),
  gapDays: v.number(),
  engagedFirst: v.boolean(),
  limitTier: v.optional(v.string()),
  planCursor: v.optional(v.union(v.string(), v.null())),
  planned: v.number(),
  queued: v.number(),
  targets: v.optional(v.array(v.number())),
  step: v.number(),
  stepLeft: v.number(),
  wave: v.number(),
  lastSize: v.optional(v.number()),
  shrink: v.optional(v.number()),
  holds: v.number(),
  heldForWave: v.optional(v.boolean()),
  ackWave: v.optional(v.number()),
  waveGap: v.optional(v.number()),
  waveStartedAt: v.optional(v.number()),
  waveEndedAt: v.optional(v.number()),
  nextCheckAt: v.optional(v.number()),
});

const counters = {
  sent: v.number(),
  failed: v.number(),
  delivered: v.number(),
  read: v.number(),
  replied: v.number(),
  clicked: v.number(),
  optedOut: v.number(),
  converted: v.optional(v.number()),
  heldBack: v.optional(v.number()),
  blocked: v.optional(v.number()),
  unreachable: v.optional(v.number()),
};

export const audienceCategory = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
});

export const marketingTables = {
  marketingTemplates: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    occasion: v.union(
      v.literal("birthday"),
      v.literal("festival"),
      v.literal("offer"),
      v.literal("event"),
      v.literal("general")
    ),
    body: v.string(),
    header: v.optional(v.string()),
    headerMedia: v.optional(headerMedia),
    footer: v.optional(v.string()),
    buttons: v.optional(v.array(templateButton)),
    metaTemplateName: v.optional(v.string()),
    metaStatus: v.optional(v.string()),
    metaTemplateId: v.optional(v.string()),
    metaRejectedReason: v.optional(v.string()),
    appliedAt: v.optional(v.number()),
    languageCode: v.string(),
    category: v.optional(
      v.union(
        v.literal("marketing"),
        v.literal("utility"),
        v.literal("authentication")
      )
    ),
    qualityScore: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_metaStatus", ["metaStatus"]),

  marketingEvents: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    date: v.string(),
    sendHour: v.number(),
    sendAt: v.number(),
    templateId: v.optional(v.id("marketingTemplates")),
    presetKey: v.optional(v.string()),
    note: v.optional(v.string()),
    campaignId: v.optional(v.id("marketingCampaigns")),
    offsetDays: v.optional(v.number()),
    message: v.optional(v.string()),
    variables: v.optional(v.array(variableFill)),
    audience: v.optional(audienceSelection),
    guestSegment: v.optional(guestSegment),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("paused"),
      v.literal("cancelled")
    ),
    sentCount: v.number(),
    failedCount: v.number(),
    skippedCount: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    ratePerMinute: v.optional(v.number()),
    trackLinks: v.optional(v.boolean()),
    smartTiming: v.optional(v.boolean()),
    replyAgentId: v.optional(v.id("agents")),
    wave: v.optional(v.number()),
    rollout: v.optional(rolloutState),
    lastError: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_and_date", ["workspaceId", "date"])
    .index("by_workspaceId_and_campaignId_and_date", ["workspaceId", "campaignId", "date"])
    .index("by_templateId_and_status", ["templateId", "status"])
    .index("by_status_and_sendAt", ["status", "sendAt"])
    .index("by_campaignId", ["campaignId"]),

  marketingCampaigns: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    date: v.string(),
    startTime: v.optional(v.string()),
    venue: v.optional(v.string()),
    details: v.string(),
    offer: v.optional(v.string()),
    link: v.optional(v.string()),
    templateId: v.optional(v.id("marketingTemplates")),
    sendHour: v.number(),
    audience: v.optional(audienceSelection),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_and_date", ["workspaceId", "date"])
    .index("by_templateId", ["templateId"]),

  marketingSettings: defineTable({
    workspaceId: v.id("workspaces"),
    birthdayEnabled: v.boolean(),
    birthdayTemplateId: v.optional(v.id("marketingTemplates")),
    birthdayHour: v.number(),
    lastBirthdayRun: v.optional(v.string()),
    weeklyCap: v.optional(v.number()),
    categories: v.optional(v.array(audienceCategory)),
    rolloutDefaults: v.optional(
      v.object({ shares: v.array(v.number()), gapDays: v.number(), engagedFirst: v.boolean() })
    ),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_birthdayEnabled", ["birthdayEnabled"]),

  marketingSends: defineTable({
    workspaceId: v.id("workspaces"),
    contactId: v.id("contacts"),
    eventId: v.optional(v.id("marketingEvents")),
    key: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    text: v.optional(v.string()),
    agentId: v.optional(v.id("agents")),
    messageId: v.optional(v.id("messages")),
    delivery: v.optional(deliveryStatus),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    clickedAt: v.optional(v.number()),
    optedOutAt: v.optional(v.number()),
    convertedAt: v.optional(v.number()),
    linkCode: v.optional(v.string()),
    linkTarget: v.optional(v.string()),
    wave: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_linkCode", ["linkCode"])
    .index("by_contact_and_key", ["contactId", "key"])
    .index("by_contactId_and_createdAt", ["contactId", "createdAt"])
    .index("by_key_and_createdAt", ["key", "createdAt"])
    .index("by_messageId", ["messageId"])
    .index("by_workspace", ["workspaceId"]),

  marketingStats: defineTable({
    workspaceId: v.id("workspaces"),
    key: v.string(),
    shard: v.number(),
    ...counters,
  }).index("by_key_and_shard", ["key", "shard"]),

  marketingDaily: defineTable({
    workspaceId: v.id("workspaces"),
    day: v.string(),
    shard: v.number(),
    ...counters,
  }).index("by_workspaceId_and_day_and_shard", ["workspaceId", "day", "shard"]),

  marketingHourly: defineTable({
    workspaceId: v.id("workspaces"),
    hour: v.number(),
    shard: v.number(),
    sent: v.number(),
  }).index("by_workspaceId_and_hour_and_shard", ["workspaceId", "hour", "shard"]),

  rolloutRecipients: defineTable({
    eventId: v.id("marketingEvents"),
    contactId: v.id("contacts"),
    score: v.number(),
    wave: v.optional(v.number()),
  })
    .index("by_eventId_and_wave_and_score", ["eventId", "wave", "score"])
    .index("by_eventId_and_contactId", ["eventId", "contactId"]),

  rolloutChecks: defineTable({
    eventId: v.id("marketingEvents"),
    wave: v.number(),
    at: v.number(),
    quality: v.optional(healthQuality),
    limitTier: v.optional(v.string()),
    used24h: v.optional(v.number()),
    metrics: v.optional(
      v.object({
        sent: v.number(),
        failed: v.number(),
        delivered: v.number(),
        optedOut: v.number(),
        heldBack: v.number(),
        blocked: v.number(),
        unreachable: v.number(),
      })
    ),
    decision: v.union(
      v.literal("launch"),
      v.literal("hold"),
      v.literal("wait"),
      v.literal("pause"),
      v.literal("finish")
    ),
    size: v.optional(v.number()),
    reason: v.string(),
  }).index("by_eventId_and_at", ["eventId", "at"]),

  channelHealth: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    quality: healthQuality,
    limitTier: v.optional(v.string()),
    throughput: v.optional(v.string()),
    alert: v.optional(v.string()),
    source: v.union(v.literal("meta"), v.literal("webhook")),
    checkedAt: v.number(),
  }).index("by_channelId", ["channelId"]),

  audiences: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    source: v.union(
      v.literal("import"),
      v.literal("manual"),
      v.literal("retarget")
    ),
    memberCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  audienceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    audienceId: v.id("audiences"),
    contactId: v.id("contacts"),
    addedAt: v.number(),
  })
    .index("by_audienceId_and_contactId", ["audienceId", "contactId"])
    .index("by_contactId", ["contactId"]),

  audienceImports: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    fileName: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("import"), v.literal("recheck"))),
    status: v.union(
      v.literal("uploading"),
      v.literal("sorting"),
      v.literal("review"),
      v.literal("saving"),
      v.literal("saved"),
      v.literal("discarded")
    ),
    total: v.number(),
    counts: importCounts,
    audienceId: v.optional(v.id("audiences")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]),

  audienceImportRows: defineTable({
    workspaceId: v.id("workspaces"),
    importId: v.id("audienceImports"),
    line: v.number(),
    raw: v.object({
      name: v.optional(v.string()),
      phone: v.string(),
      email: v.optional(v.string()),
      company: v.optional(v.string()),
      birthday: v.optional(v.string()),
      tags: v.optional(v.string()),
      notes: v.optional(v.string()),
      fields: v.optional(v.array(kvPair)),
    }),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    birthday: v.optional(v.string()),
    tags: v.array(v.string()),
    notes: v.optional(v.string()),
    fields: v.optional(v.array(kvPair)),
    problem: v.optional(v.string()),
    fixes: v.array(v.string()),
    status: importRowStatus,
    duplicateOfLine: v.optional(v.number()),
    existingContactId: v.optional(v.id("contacts")),
    optedOut: v.optional(v.boolean()),
    category: v.optional(v.string()),
    confidence: v.optional(v.number()),
    junk: v.optional(v.number()),
    business: v.optional(v.boolean()),
    doNotContact: v.optional(v.boolean()),
    interest: v.optional(v.union(v.literal("cold"), v.literal("warm"), v.literal("hot"))),
    sortError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_importId_and_status", ["importId", "status"])
    .index("by_importId_and_phone", ["importId", "phone"])
    .index("by_importId_and_line", ["importId", "line"]),

  eventGuests: defineTable({
    workspaceId: v.id("workspaces"),
    campaignId: v.id("marketingCampaigns"),
    contactId: v.id("contacts"),
    rsvp: v.optional(rsvpStatus),
    rsvpSource: v.optional(v.union(v.literal("reply"), v.literal("manual"))),
    rsvpText: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    attended: v.optional(v.boolean()),
    checkedInAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_campaignId_and_contactId", ["campaignId", "contactId"])
    .index("by_campaignId_and_rsvp", ["campaignId", "rsvp"])
    .index("by_campaignId_and_attended", ["campaignId", "attended"]),
};
