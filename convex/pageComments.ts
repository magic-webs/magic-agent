import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { friendlySendError } from "./lib/sendErrors";
import { PUBLIC_REPLY_LIMIT, fillUsername, moderationReason, pickRule } from "./lib/instagram";
import { facebookUrl } from "./lib/messenger";
import { graphError } from "./instagram";
import { dmMessage } from "./instagramAutomation";

type PageConfig = NonNullable<Doc<"channels">["messenger"]>;

type FeedValue = {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  message?: string;
  from?: { id?: string; name?: string };
};

async function pageCall(
  config: PageConfig,
  path: string,
  init: { method: "POST" | "DELETE"; body?: Record<string, unknown> }
): Promise<{ ok: boolean; error?: string; body?: Record<string, unknown> }> {
  const response = await fetch(facebookUrl(path), {
    method: init.method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  }).catch(() => null);
  if (!response) return { ok: false, error: "Facebook could not be reached." };
  if (!response.ok) return { ok: false, error: await graphError(response) };
  return { ok: true, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

async function postMessage(config: PageConfig, postId: string | undefined) {
  if (!postId) return undefined;
  const response = await fetch(facebookUrl(postId, { fields: "message" }), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  }).catch(() => null);
  if (!response?.ok) return undefined;
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message?.slice(0, 1000);
}

export const handleComment = internalAction({
  args: { pageId: v.string(), change: v.any() },
  handler: async (ctx, args): Promise<{ handled: boolean; reason?: string }> => {
    const value = (args.change ?? {}) as FeedValue;
    if (value.item !== "comment" || value.verb !== "add") return { handled: false, reason: "not_new_comment" };
    const commentId = value.comment_id;
    const fromId = value.from?.id;
    const text = (value.message ?? "").trim();
    if (!commentId || !fromId || !text) return { handled: false, reason: "incomplete" };
    if (fromId === args.pageId) return { handled: false, reason: "own_comment" };

    const context = await ctx.runQuery(internal.instagramAutomation.automationContext, {
      externalId: args.pageId,
      type: "messenger",
      fromId,
    });
    if (!context) return { handled: false, reason: "unknown_page" };
    const { channel, settings, rules, answeredRuleIds } = context;
    const config = channel.messenger!;
    if (channel.status !== "active" || !config.accessToken) {
      return { handled: false, reason: "channel_paused" };
    }
    if (!(await ctx.runMutation(internal.instagram.claimEvent, { mid: `fbcomment:${commentId}` }))) {
      return { handled: false, reason: "duplicate" };
    }

    const name = value.from?.name;
    const firstName = name?.split(/\s+/)[0];
    const postId = value.post_id;
    const base = {
      channelId: channel._id,
      kind: "comment" as const,
      externalId: commentId,
      mediaId: postId,
      fromId,
      fromName: name,
      text,
    };

    if (settings.moderation.enabled) {
      let reason = moderationReason(settings.moderation, text);
      if (!reason && settings.moderation.screenWithAi) {
        reason = await ctx.runAction(internal.instagramAi.screenComment, {
          workspaceId: channel.workspaceId,
          agentId: channel.agentId,
          text,
          platform: "messenger",
        });
      }
      if (reason) {
        const hide = settings.moderation.action === "hide";
        const result = hide
          ? await pageCall(config, commentId, { method: "POST", body: { is_hidden: true } })
          : await pageCall(config, commentId, { method: "DELETE" });
        await ctx.runMutation(internal.instagramAutomation.logActivity, {
          ...base,
          actions: result.ok ? [hide ? "hidden" : "deleted"] : [],
          reason,
          error: result.ok ? undefined : friendlySendError("messenger", result.error),
        });
        return { handled: true, reason: "moderated" };
      }
    }

    const rule = pickRule(rules, { text, mediaId: postId });
    if (!rule) {
      await ctx.runMutation(internal.instagramAutomation.logActivity, {
        ...base,
        actions: [],
        reason: "No rule matched",
      });
      return { handled: false, reason: "no_rule" };
    }
    const ruleRef = { ruleId: rule._id, ruleName: rule.name };
    if (rule.oncePerUser && answeredRuleIds.includes(rule._id)) {
      await ctx.runMutation(internal.instagramAutomation.logActivity, {
        ...base,
        ...ruleRef,
        actions: [],
        reason: "Already answered this person",
      });
      return { handled: false, reason: "already_answered" };
    }

    const actions: Array<"public_reply" | "dm"> = [];
    const errors: string[] = [];

    let publicReply: string | undefined;
    if (rule.publicReply.mode !== "off") {
      const written =
        rule.publicReply.mode === "ai"
          ? await ctx.runAction(internal.instagramAi.writeReply, {
              workspaceId: channel.workspaceId,
              agentId: channel.agentId,
              comment: text,
              username: name,
              caption: await postMessage(config, postId),
              sendsDm: Boolean(rule.dm),
              platform: "messenger",
            })
          : rule.publicReply.variants[
              Math.floor(Math.random() * rule.publicReply.variants.length)
            ];
      publicReply = fillUsername(written ?? "", firstName, "").slice(0, PUBLIC_REPLY_LIMIT) || undefined;
      if (publicReply) {
        const sent = await pageCall(config, `${commentId}/comments`, {
          method: "POST",
          body: { message: publicReply },
        });
        if (sent.ok) actions.push("public_reply");
        else errors.push(`Reply: ${friendlySendError("messenger", sent.error)}`);
      }
    }

    let dmText: string | undefined;
    if (rule.dm) {
      dmText = fillUsername(rule.dm.text, firstName, "");
      const sent = await pageCall(config, `${config.pageId}/messages`, {
        method: "POST",
        body: { recipient: { comment_id: commentId }, message: dmMessage(rule.dm, dmText) },
      });
      if (sent.ok) {
        actions.push("dm");
        const psid = typeof sent.body?.recipient_id === "string" ? sent.body.recipient_id : undefined;
        await ctx.runMutation(internal.instagramAutomation.recordDm, {
          channelId: channel._id,
          fromId: psid ?? fromId,
          name,
          text: rule.dm.buttonUrl ? `${dmText}\n\n${rule.dm.buttonTitle}: ${rule.dm.buttonUrl}` : dmText,
        });
      } else {
        errors.push(`DM: ${friendlySendError("messenger", sent.error)}`);
      }
    }

    await ctx.runMutation(internal.instagramAutomation.logActivity, {
      ...base,
      ...ruleRef,
      actions,
      publicReply,
      dmText,
      error: errors.length ? errors.join(" · ") : undefined,
    });
    return { handled: actions.length > 0, reason: errors.length ? "partial" : undefined };
  },
});
