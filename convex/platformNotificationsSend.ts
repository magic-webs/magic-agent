import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { sendExpo, type ExpoMessage } from "./lib/expoPush";
import { fileUrl } from "./lib/files";
import { normalisePhone, platformFrom, sendPlatformEmail } from "./lib/notifications";
import { broadcastEmailHtml } from "./lib/platformEmail";
import { publicSiteUrl } from "./lib/publicUrl";
import { sendSms, smsConfig } from "./lib/sms";

const EMAIL_CONCURRENCY = 5;
const PAGE_GAP_MS = 500;

type Broadcast = Doc<"platformBroadcasts">;

function emailFor(broadcast: Broadcast, imageUrl: string | null, optOutToken?: string) {
  const site = publicSiteUrl();
  return {
    subject: broadcast.emailSubject ?? broadcast.title,
    html: broadcastEmailHtml({
      category: broadcast.category,
      heading: broadcast.title,
      body: broadcast.emailFormat === "html" ? broadcast.body : (broadcast.emailBody ?? broadcast.body),
      bodyHtml: broadcast.emailFormat === "html" ? broadcast.emailBody : undefined,
      imageUrl: imageUrl ?? undefined,
      link: broadcast.link,
      linkLabel: broadcast.linkLabel,
      unsubscribeUrl: optOutToken && site ? `${site}/unsubscribe/${optOutToken}` : undefined,
      brand: platformFrom().fromName,
    }),
  };
}

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += size) {
    out.push(...(await Promise.all(items.slice(at, at + size).map(run))));
  }
  return out;
}

export const run = internalAction({
  args: { broadcastId: v.id("platformBroadcasts"), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    try {
      const page = await ctx.runQuery(internal.platformNotifications.page, {
        broadcastId: args.broadcastId,
        cursor: args.cursor ?? null,
      });
      if (!page) return;
      const { broadcast, imageUrl, targets } = page;

      const items: { workspaceId: Id<"workspaces">; channel: "push" | "email" | "sms"; recipient: string }[] = [];
      for (const target of targets) {
        if (broadcast.channels.push) {
          items.push({ workspaceId: target.workspaceId, channel: "push", recipient: target.workspaceId });
        }
        if (broadcast.channels.email) {
          for (const email of target.emails) {
            items.push({ workspaceId: target.workspaceId, channel: "email", recipient: email });
          }
        }
        if (broadcast.channels.sms && target.phone) {
          items.push({ workspaceId: target.workspaceId, channel: "sms", recipient: target.phone });
        }
      }

      const claimed =
        (await ctx.runMutation(internal.platformNotifications.claim, {
          broadcastId: args.broadcastId,
          items,
        })) ?? [];

      const results: {
        channel: "push" | "email" | "sms";
        recipient: string;
        status: "sent" | "failed" | "skipped";
        detail?: string;
        sent?: number;
        failed?: number;
      }[] = [];

      const pushClaims = claimed.filter((item) => item.channel === "push");
      if (pushClaims.length > 0) {
        const tokensOf = new Map(targets.map((target) => [target.workspaceId as string, target.tokens]));
        const messages: ExpoMessage[] = [];
        const owners: string[] = [];
        for (const item of pushClaims) {
          for (const token of tokensOf.get(item.recipient) ?? []) {
            owners.push(item.recipient);
            messages.push({
              to: token,
              title: broadcast.title,
              body: broadcast.body,
              sound: "default",
              channelId: "default",
              priority: broadcast.category === "notice" ? "high" : "default",
              data: {
                event: "platform_announcement",
                broadcastId: broadcast._id,
                link: broadcast.link ?? null,
              },
            });
          }
        }
        const { accepted, dead } = await sendExpo(messages);
        for (const item of pushClaims) {
          let sent = 0;
          let failed = 0;
          owners.forEach((owner, index) => {
            if (owner !== item.recipient) return;
            if (accepted[index]) sent += 1;
            else failed += 1;
          });
          const total = sent + failed;
          results.push({
            channel: "push",
            recipient: item.recipient,
            status: total === 0 ? "skipped" : sent > 0 ? "sent" : "failed",
            detail: total === 0 ? "No app devices" : `${sent} of ${total} devices`,
            sent,
            failed,
          });
        }
        if (dead.length > 0) {
          await ctx.runMutation(internal.push.markDead, { tokens: dead, error: "DeviceNotRegistered" });
        }
      }

      const emailClaims = claimed.filter((item) => item.channel === "email");
      const emailResults = await inBatches(emailClaims, EMAIL_CONCURRENCY, async (item) => {
        const message = emailFor(broadcast, imageUrl, item.optOutToken);
        const outcome = await sendPlatformEmail({ to: [item.recipient], ...message });
        return {
          channel: "email" as const,
          recipient: item.recipient,
          status: outcome.ok ? ("sent" as const) : ("failed" as const),
          detail: outcome.error,
        };
      });
      results.push(...emailResults);

      const smsClaims = claimed.filter((item) => item.channel === "sms");
      if (smsClaims.length > 0) {
        const config = smsConfig(broadcast.smsTemplateId);
        if (!config) {
          for (const item of smsClaims) {
            results.push({ channel: "sms", recipient: item.recipient, status: "failed", detail: "SMS is not configured" });
          }
        } else {
          const sent = await sendSms(
            config,
            smsClaims.map((item) => item.recipient),
            broadcast.smsText ?? broadcast.body
          );
          for (const outcome of sent) {
            results.push({
              channel: "sms",
              recipient: outcome.phone,
              status: outcome.ok ? "sent" : "failed",
              detail: outcome.error,
            });
          }
        }
      }

      await ctx.runMutation(internal.platformNotifications.record, {
        broadcastId: args.broadcastId,
        results,
        inbox: broadcast.channels.push ? pushClaims.map((item) => item.workspaceId) : [],
        workspaces: targets.length,
        nextCursor: page.nextCursor,
        done: page.done,
      });

      if (!page.done) {
        await ctx.scheduler.runAfter(PAGE_GAP_MS, internal.platformNotificationsSend.run, {
          broadcastId: args.broadcastId,
          cursor: page.nextCursor,
        });
      }
    } catch (error) {
      await ctx.runMutation(internal.platformNotifications.fail, {
        broadcastId: args.broadcastId,
        error: error instanceof Error ? error.message : "Sending stopped unexpectedly.",
      });
    }
  },
});

export const sendTest = action({
  args: { id: v.id("platformBroadcasts"), phone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { broadcast, email } = await ctx.runQuery(internal.platformNotifications.testContext, {
      id: args.id,
    });
    const imageUrl = broadcast.imageKey ? fileUrl(broadcast.imageKey) : null;
    const outcome: { email?: string; sms?: string } = {};

    if (broadcast.channels.email) {
      const message = emailFor(broadcast, imageUrl, broadcast.category === "offer" ? "test" : undefined);
      const sent = await sendPlatformEmail({ to: [email], ...message, subject: `[Test] ${message.subject}` });
      outcome.email = sent.ok ? `Sent to ${email}` : (sent.error ?? "Email failed");
    }

    if (broadcast.channels.sms) {
      const phone = args.phone ? normalisePhone(args.phone, "91") : null;
      const config = smsConfig(broadcast.smsTemplateId);
      if (!phone) outcome.sms = "Enter a phone number to test SMS";
      else if (!config) outcome.sms = "SMS is not configured";
      else {
        const [sent] = await sendSms(config, [phone], broadcast.smsText ?? broadcast.body);
        outcome.sms = sent?.ok ? `Sent to +${phone}` : (sent?.error ?? "SMS failed");
      }
    }

    if (!outcome.email && !outcome.sms) {
      throw new ConvexError("Test sends cover email and SMS. Push goes to customers' app devices only.");
    }
    return outcome;
  },
});
