import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { interpretEvent } from "./lib/apps";
import { verifyDelivery } from "./lib/appWebhooks";
import { isLinkBot } from "./lib/links";
import { publicSiteUrl } from "./lib/publicUrl";
import { escapeHtml } from "./lib/notifications";
import { parseSignedRequest, validSignature } from "./lib/instagram";
import { fetchMedia, signMedia } from "./lib/whatsappMedia";
import { RAZORPAY_LINK_EVENTS } from "./lib/payments";
import type { Id } from "./_generated/dataModel";
import {
  paymentFields,
  subscriptionFields,
  webhookSignatureValid,
  type RazorpayPayment,
  type RazorpaySubscription,
} from "./lib/razorpay";

const http = httpRouter();

// ---------------------------------------------------------------------------
// OIDC discovery + JWKS for our own session JWTs.
//
// convex/auth.config.ts points `domain` at this deployment's .convex.site, so
// Convex fetches these two routes to learn how to verify the tokens it is
// handed. Keeping the issuer inside Convex means auth works in local
// development with no tunnel and no third-party identity provider.
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}

http.route({
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () => {
    const issuer = process.env.CONVEX_SITE_URL ?? "";
    return jsonResponse({
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      response_types_supported: ["id_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }),
});

http.route({
  path: "/.well-known/jwks.json",
  method: "GET",
  handler: httpAction(async () => {
    const raw = process.env.JWT_PUBLIC_JWK;
    if (!raw) return jsonResponse({ keys: [] });
    return jsonResponse({ keys: [JSON.parse(raw)] });
  }),
});

// Meta's webhook lives on the Convex deployment rather than the Next app: the
// URL is public without a tunnel (so local development works against a real
// number), and the channel's access token never leaves Convex.
//
//   https://<deployment>.convex.site/whatsapp/<channelKey>

function channelKeyFrom(url: string): string | null {
  const path = new URL(url).pathname;
  const key = path.replace(/^\/whatsapp\//, "").replace(/\/+$/, "");
  return key && !key.includes("/") ? key : null;
}

type WebhookValue = {
  messages?: unknown[];
  statuses?: Array<{
    id?: string;
    status?: string;
    errors?: Array<{
      code?: number | string;
      title?: string;
      message?: string;
      error_data?: { details?: string };
    }>;
    pricing?: { billable?: unknown; category?: unknown; type?: unknown };
  }>;
};

function webhookValues(shape: Record<string, unknown>): WebhookValue[] {
  const entries = Array.isArray(shape.entry) ? shape.entry : [];
  return entries.flatMap((entry: { changes?: Array<{ value?: WebhookValue }> }) =>
    (entry?.changes ?? []).flatMap((change) => (change?.value ? [change.value] : []))
  );
}

const HEALTH_FIELDS = new Set([
  "phone_number_quality_update",
  "business_capability_update",
  "account_alerts",
  "message_template_status_update",
  "message_template_quality_update",
]);

function healthChanges(shape: Record<string, unknown>) {
  const entries = Array.isArray(shape.entry) ? shape.entry : [];
  return entries.flatMap((entry: { changes?: Array<{ field?: unknown; value?: unknown }> }) =>
    (entry?.changes ?? []).flatMap((change) =>
      typeof change?.field === "string" && HEALTH_FIELDS.has(change.field) && change.value
        ? [{ field: change.field, value: change.value }]
        : []
    )
  );
}

function withCode(code: unknown, text: string | undefined): string | undefined {
  const known = typeof code === "number" || (typeof code === "string" && /^\d+$/.test(code));
  if (!known) return text;
  return text ? `(#${code}) ${text}` : `(#${code})`;
}

function hasMessages(shape: Record<string, unknown>): boolean {
  return webhookValues(shape).some((value) => (value.messages?.length ?? 0) > 0);
}

const RECEIPTS = new Set(["sent", "delivered", "read", "failed"]);

/**
 * 1Automations queues every send and answers with a `queue_id`; this report
 * is where the queued message gets its Meta `wamid`, or its failure.
 */
function queueReport(shape: Record<string, unknown>) {
  const message = shape.message as
    | { queue_id?: unknown; message_status?: unknown }
    | undefined;
  if (typeof message?.queue_id !== "string") return null;
  const response = shape.response as
    | {
        messages?: Array<{ id?: unknown }>;
        error?: { code?: unknown; message?: unknown; error_data?: { details?: unknown } };
      }
    | undefined;
  const wamid = response?.messages?.[0]?.id;
  const details = response?.error?.error_data?.details ?? response?.error?.message;
  const problem = withCode(response?.error?.code, typeof details === "string" ? details : undefined);
  const failed = message.message_status === "failed" || Boolean(response?.error);
  return {
    queueId: message.queue_id,
    ...(typeof wamid === "string" ? { wamid } : {}),
    failed,
    ...(failed && problem ? { error: problem.slice(0, 300) } : {}),
  };
}

function deliveryStatuses(shape: Record<string, unknown>) {
  return webhookValues(shape).flatMap((value) =>
    (value.statuses ?? []).flatMap((status) => {
      if (!status.id || !status.status || !RECEIPTS.has(status.status)) return [];
      const problem = status.errors?.[0];
      const error = withCode(
        problem?.code,
        problem?.error_data?.details ?? problem?.message ?? problem?.title
      );
      const pricing = status.pricing;
      return [
        {
          wamid: status.id,
          status: status.status as "sent" | "delivered" | "read" | "failed",
          ...(error ? { error: error.slice(0, 300) } : {}),
          ...(pricing && typeof pricing === "object"
            ? {
                pricing: {
                  ...(typeof pricing.billable === "boolean" ? { billable: pricing.billable } : {}),
                  ...(typeof pricing.category === "string" ? { category: pricing.category } : {}),
                  ...(typeof pricing.type === "string" ? { type: pricing.type } : {}),
                },
              }
            : {}),
        },
      ];
    })
  );
}

// --- Verification handshake --------------------------------------------------
http.route({
  pathPrefix: "/whatsapp/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const channelKey = channelKeyFrom(request.url);
    if (!channelKey) {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(request.url);
    const params = url.searchParams;

    const resolved = await ctx.runQuery(internal.channels.resolveByKey, {
      channelKey,
    });
    if (!resolved) {
      return new Response("Unknown channel", { status: 404 });
    }

    // Logged because the handshake is the step that goes wrong, and the only
    // way to know what a provider actually sent is to have recorded it.
    console.log(
      `[whatsapp] verify GET channel=${channelKey} query=${url.search || "(none)"}`
    );

    // Providers disagree about this handshake. Meta sends hub.mode,
    // hub.verify_token and hub.challenge; the reseller panels built on the
    // Cloud API often just GET the URL bare and want a 200, or send the
    // challenge under a different name. So: echo a challenge if one is
    // offered, otherwise answer OK.
    //
    // `challange` is not a typo here. The MagicXBot panel spells it that way
    // on the wire — its own failure notice reads "Failed to verify challange"
    // — and printly-ai-bot has always had to read that spelling first. Miss it
    // and verification fails with no other symptom.
    //
    // Nothing is authenticated here and nothing needs to be. The unguessable
    // channelKey in the path is what selects the channel, and this response
    // discloses only the caller's own challenge string.
    const challenge =
      params.get("challange") ??
      params.get("hub.challange") ??
      params.get("hub.challenge") ??
      params.get("challenge") ??
      params.get("hub_challenge");

    return new Response(challenge ?? "OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// --- Inbound messages --------------------------------------------------------
http.route({
  pathPrefix: "/whatsapp/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const channelKey = channelKeyFrom(request.url);
    if (!channelKey) {
      return new Response("Not found", { status: 404 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const shape =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    console.log(
      `[whatsapp] POST channel=${channelKey} keys=${Object.keys(shape).join(",") || "(none)"}`
    );

    // Some panels verify with a POST rather than a GET. Echo the challenge and
    // do not treat it as a message: a verification ping has no entry array.
    if (!("entry" in shape)) {
      const challenge =
        shape["challange"] ?? shape["challenge"] ?? shape["hub.challenge"];
      if (typeof challenge === "string") {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }

    const queued = queueReport(shape);
    if (queued) {
      await ctx.scheduler.runAfter(0, internal.deliveries.resolveQueued, {
        channelKey,
        ...queued,
      });
      return new Response(JSON.stringify({ status: "accepted" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const statuses = deliveryStatuses(shape);
    if (statuses.length > 0) {
      await ctx.scheduler.runAfter(0, internal.deliveries.applyStatuses, {
        channelKey,
        statuses,
      });
    }

    const health = healthChanges(shape);
    if (health.length > 0) {
      await ctx.scheduler.runAfter(0, internal.marketingRollout.applyHealthWebhook, {
        channelKey,
        changes: health,
      });
    }

    // Meta retries anything that is slow or non-2xx, so acknowledge straight
    // away and do the model work in a scheduled action.
    if ((statuses.length === 0 && health.length === 0) || hasMessages(shape)) {
      await ctx.scheduler.runAfter(0, internal.whatsapp.handleInbound, {
        channelKey,
        payload,
      });
    }

    return new Response(JSON.stringify({ status: "accepted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

function keyAfter(prefix: string, url: string): string | null {
  const key = new URL(url).pathname.slice(prefix.length).replace(/\/+$/, "");
  return key && !key.includes("/") ? key : null;
}

const accepted = () =>
  new Response(JSON.stringify({ status: "accepted" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

http.route({
  pathPrefix: "/rcs/",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const params = new URL(request.url).searchParams;
    const challenge =
      params.get("hub.challenge") ?? params.get("challenge") ?? params.get("challange");
    return new Response(challenge ?? "OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

http.route({
  pathPrefix: "/rcs/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const channelKey = keyAfter("/rcs/", request.url);
    if (!channelKey) return new Response("Not found", { status: 404 });

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const shape =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    console.log(
      `[rcs] POST channel=${channelKey} keys=${Object.keys(shape).join(",") || "(none)"}`
    );

    const challenge = shape["challange"] ?? shape["challenge"] ?? shape["hub.challenge"];
    if (typeof challenge === "string") {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    const statuses = deliveryStatuses(shape);
    if (statuses.length > 0) {
      await ctx.scheduler.runAfter(0, internal.deliveries.applyStatuses, {
        channelKey,
        statuses,
      });
    }
    if (statuses.length === 0 || hasMessages(shape)) {
      await ctx.scheduler.runAfter(0, internal.rcs.handleInbound, { channelKey, payload });
    }
    return accepted();
  }),
});

http.route({
  pathPrefix: "/telegram/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const channelKey = keyAfter("/telegram/", request.url);
    if (!channelKey) return new Response("Not found", { status: 404 });

    const resolved = await ctx.runQuery(internal.channels.resolveByKey, { channelKey });
    const secret = resolved?.channel.telegram?.secretToken;
    if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return new Response("Forbidden", { status: 403 });
    }

    let update: unknown;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    await ctx.scheduler.runAfter(0, internal.telegram.handleInbound, { channelKey, update });
    return accepted();
  }),
});

http.route({
  pathPrefix: "/whatsapp-media/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const [channelId, rawMediaId] = url.pathname
      .replace(/^\/whatsapp-media\//, "")
      .split("/");
    const mediaId = rawMediaId ? decodeURIComponent(rawMediaId) : "";
    const sig = url.searchParams.get("sig");
    if (!channelId || !mediaId || !sig) {
      return new Response("Not found", { status: 404 });
    }

    const resolved = await ctx.runQuery(internal.channels.resolveById, {
      channelId: channelId as Id<"channels">,
    }).catch(() => null);
    const config = resolved?.channel.whatsapp;
    if (!config || sig !== (await signMedia(config.accessToken, channelId, mediaId))) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const { response, mimeType } = await fetchMedia(config, mediaId);
      return new Response(response.body, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "private, max-age=86400, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      console.warn(
        "[whatsapp] media unavailable",
        error instanceof Error ? error.message : String(error)
      );
      return new Response("Media no longer available", { status: 410 });
    }
  }),
});

// ---------------------------------------------------------------------------
// Google integrations.
//
// Both halves live on the Convex deployment rather than the Next app. The
// refresh token and the OAuth client secret never leave Convex, the callback
// URL is stable per deployment (so it can be whitelisted once in the Google
// console and works in local development with no tunnel), and the engine
// reaches the tool endpoints without the web app being deployed at all.
//
//   https://<deployment>.convex.site/integrations/google/callback
//   https://<deployment>.convex.site/integrations/google/<action>?token=…
// ---------------------------------------------------------------------------

/** A page for the browser, since the callback is the only route a human sees. */
function callbackPage(title: string, detail: string, backTo?: string): Response {
  const escape = (text: string) =>
    text.replace(/[<>&]/g, (char) =>
      char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&amp;"
    );

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escape(title)}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6">` +
      `<h1 style="font-size:1.25rem">${escape(title)}</h1>` +
      `<p style="color:#555">${escape(detail)}</p>` +
      (backTo
        ? `<p><a href="${escape(backTo)}">Back to Integrations</a></p>`
        : "") +
      `</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

http.route({
  path: "/integrations/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const state = params.get("state") ?? "";
    const code = params.get("code");
    const denied = params.get("error");

    // Somebody who pressed Cancel on the consent screen. Burn the state so it
    // cannot be reused, then send them back without an alarming page.
    if (denied || !code) {
      const pending = state
        ? await ctx.runMutation(internal.integrations.takeState, { state })
        : null;
      if (pending?.returnTo) {
        return Response.redirect(
          `${pending.returnTo}?integration_error=${encodeURIComponent(
            denied === "access_denied"
              ? "Google sign-in was cancelled."
              : denied ?? "Google did not return an authorisation code."
          )}`,
          302
        );
      }
      return callbackPage(
        "Nothing was connected",
        denied === "access_denied"
          ? "Google sign-in was cancelled. You can close this tab."
          : "Google did not return an authorisation code."
      );
    }

    const result = await ctx.runAction(internal.integrations.finishGoogleConnect, {
      code,
      state,
      siteUrl: publicSiteUrl(),
    });

    if (!result.returnTo) {
      return callbackPage(
        result.ok ? "Connected" : "Could not connect",
        result.error ?? "You can close this tab."
      );
    }

    const query = result.ok
      ? `?connected=${encodeURIComponent(result.integration ?? "")}`
      : `?integration_error=${encodeURIComponent(result.error ?? "Could not connect.")}`;
    return Response.redirect(`${result.returnTo}${query}`, 302);
  }),
});

// ---------------------------------------------------------------------------
// Instagram, through Instagram Login. One app-wide webhook for every connected
// account, routed by `entry.id`, which is the account's `user_id`.
//
//   https://<deployment>.convex.site/instagram/callback
//   https://<deployment>.convex.site/instagram/webhook
//   https://<deployment>.convex.site/instagram/deauthorize
//   https://<deployment>.convex.site/instagram/data-deletion
// ---------------------------------------------------------------------------

function withQuery(base: string, key: string, value: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

http.route({
  path: "/instagram/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const state = params.get("state") ?? "";
    const code = params.get("code");
    const denied = params.get("error");

    if (denied || !code) {
      const pending = state
        ? await ctx.runMutation(internal.instagram.takeState, { state })
        : null;
      const reason =
        params.get("error_reason") === "user_denied"
          ? "Instagram sign-in was cancelled."
          : (params.get("error_description") ??
            "Instagram did not return an authorisation code.");
      if (pending?.returnTo) {
        return Response.redirect(
          withQuery(pending.returnTo, "instagram_error", reason),
          302
        );
      }
      return callbackPage("Nothing was connected", reason);
    }

    const result = await ctx.runAction(internal.instagram.finishConnect, {
      code,
      state,
    });
    if (!result.returnTo) {
      return callbackPage(
        result.ok ? "Connected" : "Could not connect",
        result.error ?? "You can close this tab."
      );
    }
    return Response.redirect(
      result.ok
        ? withQuery(result.returnTo, "connected", "instagram")
        : withQuery(result.returnTo, "instagram_error", result.error ?? "Could not connect."),
      302
    );
  }),
});

http.route({
  path: "/instagram/webhook",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const params = new URL(request.url).searchParams;
    const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    if (
      params.get("hub.mode") !== "subscribe" ||
      !expected ||
      params.get("hub.verify_token") !== expected
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response(params.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

http.route({
  path: "/instagram/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    // Meta signs Instagram Login webhooks with the Meta app's secret on some
    // apps and the Instagram app's on others, so either is accepted.
    const secrets = [
      process.env.INSTAGRAM_APP_SECRET,
      process.env.META_APP_SECRET,
    ].filter((secret): secret is string => Boolean(secret));
    let signed = false;
    for (const secret of secrets) {
      if (await validSignature(secret, raw, signature)) signed = true;
    }
    if (!signed) {
      console.warn(
        `[instagram] webhook rejected: signature=${signature ? "mismatch" : "missing"} secrets=${secrets.length}`
      );
      return new Response("Invalid signature", { status: 403 });
    }

    let payload: {
      object?: string;
      entry?: Array<{
        id?: string | number;
        messaging?: unknown[];
        changes?: Array<{ field?: string; value?: unknown }>;
      }>;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    console.log(
      `[instagram] webhook object=${payload.object} entries=${payload.entry?.length ?? 0} events=${(payload.entry ?? []).reduce((n, e) => n + (e.messaging?.length ?? 0), 0)} changes=${(payload.entry ?? []).reduce((n, e) => n + (e.changes?.length ?? 0), 0)}`
    );
    if (payload.object === "instagram") {
      for (const entry of payload.entry ?? []) {
        if (entry.id === undefined) continue;
        for (const event of entry.messaging ?? []) {
          await ctx.scheduler.runAfter(0, internal.instagram.handleInbound, {
            userId: String(entry.id),
            event,
          });
        }
        for (const change of entry.changes ?? []) {
          if (change.field !== "comments" && change.field !== "live_comments") continue;
          await ctx.scheduler.runAfter(0, internal.instagramAutomation.handleComment, {
            userId: String(entry.id),
            comment: change.value ?? null,
          });
        }
      }
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  }),
});

async function signedRequestUser(request: Request): Promise<string | null> {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret) return null;
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  if (typeof signed !== "string") return null;
  return (await parseSignedRequest(secret, signed))?.user_id ?? null;
}

http.route({
  path: "/instagram/deauthorize",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const userId = await signedRequestUser(request);
    if (!userId) return new Response("Invalid request", { status: 400 });
    await ctx.runMutation(internal.instagram.revokeAccount, { userId });
    return new Response("ok", { status: 200 });
  }),
});

http.route({
  path: "/instagram/data-deletion",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const userId = await signedRequestUser(request);
    if (!userId) return new Response("Invalid request", { status: 400 });
    await ctx.runMutation(internal.instagram.revokeAccount, { userId });
    const code = crypto.randomUUID();
    return new Response(
      JSON.stringify({
        url: `${publicSiteUrl()}/instagram/data-deletion?code=${code}`,
        confirmation_code: code,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }),
});

http.route({
  path: "/instagram/data-deletion",
  method: "GET",
  handler: httpAction(async () =>
    callbackPage(
      "Instagram data removed",
      "The access token for this Instagram account has been deleted, and no further messages are read from it."
    )
  ),
});

// --- Incoming webhooks for alerts --------------------------------------------
//
//   https://<deployment>.convex.site/notify/<inboundKey>
//
// Another system — a website form, a payment gateway, a booking tool — posts
// here and the alert that owns the key sends its template. The key is the
// credential, as a channel's is: unguessable, one per alert, and rotated from
// the app when it leaks.

const MAX_INBOUND_BYTES = 64_000;

function inboundResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

http.route({
  pathPrefix: "/l/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const code = new URL(request.url).pathname.replace(/^\/l\//, "").replace(/\/+$/, "");
    if (!/^[a-z0-9]{6,20}$/.test(code)) return new Response("Not found", { status: 404 });
    const target = isLinkBot(request.headers.get("user-agent"))
      ? await ctx.runQuery(internal.marketingTracking.target, { code })
      : await ctx.runMutation(internal.marketingTracking.click, { code });
    if (!target) return new Response("This link has expired.", { status: 404 });
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Cache-Control": "no-store" },
    });
  }),
});

http.route({
  pathPrefix: "/notify/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/notify\//, "").replace(/\/+$/, "");
    if (!key || key.includes("/")) {
      return inboundResponse(404, { ok: false, error: "Not found." });
    }

    const text = await request.text();
    if (text.length > MAX_INBOUND_BYTES) {
      return inboundResponse(413, { ok: false, error: "Body too large." });
    }

    // JSON is what nearly everything sends; form posts are what website
    // builders send. Anything else is refused rather than guessed at.
    let body: unknown = {};
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return inboundResponse(400, { ok: false, error: "Send JSON or a form post." });
      }
    }
    // Placeholders address fields by name, so the payload has to be an object.
    const data: Record<string, unknown> =
      body && typeof body === "object" && !Array.isArray(body)
        ? { ...(body as Record<string, unknown>) }
        : Array.isArray(body)
          ? { items: body }
          : { value: body };
    const query = Object.fromEntries(url.searchParams);
    if (Object.keys(query).length > 0) data.query = query;

    const status = await ctx.runMutation(internal.notifications.acceptInbound, {
      inboundKey: key,
      payload: JSON.stringify(data),
    });
    if (status === "unknown") {
      return inboundResponse(404, { ok: false, error: "No alert has this address." });
    }
    return inboundResponse(status === "queued" ? 202 : 200, {
      ok: true,
      queued: status === "queued",
      ...(status === "disabled" ? { reason: "The alert is switched off." } : {}),
    });
  }),
});

// --- Incoming records ----------------------------------------------------------
//
//   https://<deployment>.convex.site/records/<inboundKey>
//
// Another system posts here and the record book that owns the key files it.

http.route({
  pathPrefix: "/records/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/records\//, "").replace(/\/+$/, "");
    if (!key || key.includes("/")) {
      return inboundResponse(404, { ok: false, error: "Not found." });
    }

    const text = await request.text();
    if (text.length > MAX_INBOUND_BYTES) {
      return inboundResponse(413, { ok: false, error: "Body too large." });
    }

    let body: unknown = {};
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(text));
    } else if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return inboundResponse(400, { ok: false, error: "Send JSON or a form post." });
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return inboundResponse(400, { ok: false, error: "Send one record as an object." });
    }
    const data = {
      ...Object.fromEntries(url.searchParams),
      ...(body as Record<string, unknown>),
    };

    const status = await ctx.runMutation(internal.recordIntake.acceptInbound, {
      inboundKey: key,
      payload: JSON.stringify(data),
    });
    if (status === "unknown") {
      return inboundResponse(404, { ok: false, error: "No record book has this address." });
    }
    return inboundResponse(status === "filed" ? 201 : 200, {
      ok: true,
      filed: status === "filed",
      ...(status === "disabled" ? { reason: "This record book is not taking records." } : {}),
    });
  }),
});

// --- Results from the Magic apps ---------------------------------------------
//
//   https://<deployment>.convex.site/apps/<inboundKey>
//
// Magic Forms and Magic Reward post here — a submission, a spin — on the
// webhook `apps.connect` registered with them. The key picks the connection
// and the signature proves the sender; both are checked before anything is
// read. Anything that is not an agent's own link is acknowledged and dropped,
// with a 200, so the app does not retry what will never match.

const MAX_APP_EVENT_BYTES = 256_000;

http.route({
  pathPrefix: "/apps/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/apps\//, "").replace(/\/+$/, "");
    if (!key || key.includes("/")) {
      return inboundResponse(404, { ok: false, error: "Not found." });
    }

    const raw = await request.text();
    if (raw.length > MAX_APP_EVENT_BYTES) {
      return inboundResponse(413, { ok: false, error: "Body too large." });
    }

    const connection = await ctx.runQuery(internal.apps.byInboundKey, {
      inboundKey: key,
    });
    if (!connection) {
      return inboundResponse(404, { ok: false, error: "Not found." });
    }

    const verified = await verifyDelivery(
      connection.app,
      request.headers,
      raw,
      connection.webhookSecret,
      Date.now()
    );
    if (!verified.ok) {
      return inboundResponse(401, { ok: false, error: verified.error });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return inboundResponse(400, { ok: false, error: "Invalid JSON." });
    }
    const envelopeEvent =
      payload && typeof payload === "object"
        ? (payload as { event?: unknown }).event
        : undefined;
    const event =
      verified.delivery.event ||
      (typeof envelopeEvent === "string" ? envelopeEvent : "");

    const meaning = interpretEvent(connection.app, event, payload);
    if (meaning.kind === "ignore") {
      return inboundResponse(200, { ok: true, ignored: true });
    }
    if (meaning.kind === "catalogue") {
      await ctx.scheduler.runAfter(0, internal.apps.refreshItems, {
        connectionId: connection.connectionId,
      });
      return inboundResponse(200, { ok: true });
    }

    const status = await ctx.runMutation(internal.apps.acceptResult, {
      connectionId: connection.connectionId,
      deliveryId: verified.delivery.deliveryId,
      ref: meaning.ref ?? undefined,
      text: meaning.text,
      data: meaning.data,
      submission: meaning.submission,
    });
    return inboundResponse(200, { ok: true, status });
  }),
});

http.route({
  pathPrefix: "/integrations/google/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\/integrations\/google\//, "");
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing token." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // The engine sends the tool's parameters as the whole JSON body; a body
    // that will not parse is a bug on our side, not something to pass on.
    let input: unknown = {};
    try {
      input = await request.json();
    } catch {
      input = {};
    }

    const result = await ctx.runAction(internal.integrations.runToolCall, {
      callToken: token,
      action,
      input,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ---------------------------------------------------------------------------
// Razorpay's webhook: subscriptions renewing and failing, payments settling,
// mandates confirming.
//
//   https://<deployment>.convex.site/razorpay/webhook
//
// Set in the Razorpay dashboard (Settings -> Webhooks) with the secret that
// is RAZORPAY_WEBHOOK_SECRET here, and these events: subscription.*,
// payment.captured, payment.failed, order.paid, token.confirmed,
// token.rejected, token.cancelled, token.paused.
//
// The signature is checked over the raw body before anything is parsed. The
// payload is narrowed to the few fields billing reads and applied in one
// mutation (convex/razorpayEvents.ts), deduplicated on the event id, so a
// retry or a late duplicate changes nothing.
// ---------------------------------------------------------------------------

type Entity<T> = { entity?: T } | undefined;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

http.route({
  path: "/razorpay/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret) return new Response("Webhook secret not configured", { status: 503 });

    const raw = await request.text();
    const signature = request.headers.get("x-razorpay-signature") ?? "";
    if (!signature || !(await webhookSignatureValid(secret, raw, signature))) {
      return new Response("Invalid signature", { status: 400 });
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = asObject(JSON.parse(raw));
    } catch {
      body = null;
    }
    const event = typeof body?.event === "string" ? body.event : null;
    if (!body || !event) return new Response("Bad payload", { status: 400 });

    const payload = asObject(body.payload) ?? {};
    const subscription = (payload.subscription as Entity<RazorpaySubscription>)?.entity;
    const payment = (payload.payment as Entity<RazorpayPayment>)?.entity;
    const token = asObject((payload.token as Entity<unknown>)?.entity);
    const recurring = asObject(token?.recurring_details);

    await ctx.runMutation(internal.razorpayEvents.apply, {
      eventId: request.headers.get("x-razorpay-event-id") ?? "",
      event,
      subscription:
        subscription && typeof subscription.id === "string"
          ? subscriptionFields(subscription)
          : undefined,
      payment:
        payment && typeof payment.id === "string" && typeof payment.amount === "number"
          ? paymentFields(payment)
          : undefined,
      token:
        token && typeof token.id === "string"
          ? {
              tokenId: token.id,
              status:
                typeof recurring?.status === "string" ? recurring.status : undefined,
              failureReason:
                typeof recurring?.failure_reason === "string"
                  ? recurring.failure_reason
                  : undefined,
            }
          : undefined,
    });
    return new Response("ok", { status: 200 });
  }),
});

http.route({
  pathPrefix: "/payments/razorpay/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const inboundKey = new URL(request.url).pathname
      .replace(/^\/payments\/razorpay\//, "")
      .replace(/\/+$/, "");
    const connection = inboundKey
      ? await ctx.runQuery(internal.payments.byInboundKey, { inboundKey })
      : null;
    if (!connection) return new Response("Unknown webhook", { status: 404 });

    const raw = await request.text();
    const signature = request.headers.get("x-razorpay-signature") ?? "";
    if (!signature || !(await webhookSignatureValid(connection.webhookSecret, raw, signature))) {
      return new Response("Invalid signature", { status: 400 });
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = asObject(JSON.parse(raw));
    } catch {
      body = null;
    }
    const event = typeof body?.event === "string" ? body.event : "";
    if (!RAZORPAY_LINK_EVENTS.includes(event)) return new Response("ignored", { status: 200 });

    const payload = asObject(body?.payload) ?? {};
    const link = asObject((payload.payment_link as Entity<unknown>)?.entity);
    const payment = asObject((payload.payment as Entity<unknown>)?.entity);
    if (typeof link?.id !== "string") return new Response("Bad payload", { status: 400 });

    const status = event.replace(/^payment_link\./, "") as
      | "paid"
      | "partially_paid"
      | "expired"
      | "cancelled";

    await ctx.runMutation(internal.payments.applyLinkStatus, {
      connectionId: connection.id,
      razorpayLinkId: link.id,
      status,
      amountPaidPaise: typeof link.amount_paid === "number" ? link.amount_paid : undefined,
      paymentId: typeof payment?.id === "string" ? payment.id : undefined,
      method: typeof payment?.method === "string" ? payment.method : undefined,
      fromWebhook: true,
    });
    return new Response("ok", { status: 200 });
  }),
});

function unsubscribePage(title: string, body: string, form?: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b">
<main style="max-width:420px;margin:64px auto;padding:28px 24px;background:#fff;border:1px solid #e4e4e7;border-radius:12px">
<h1 style="margin:0 0 12px;font-size:20px">${title}</h1><p style="margin:0 0 20px;line-height:1.6;color:#52525b">${body}</p>${form ?? ""}
</main></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const unsubscribeToken = (request: Request) =>
  new URL(request.url).pathname.replace(/^\/unsubscribe\//, "").replace(/[^a-zA-Z0-9]/g, "");

// GET only asks: mail scanners open every link, and must not unsubscribe anyone.
http.route({
  pathPrefix: "/unsubscribe/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = unsubscribeToken(request);
    const info = token
      ? await ctx.runQuery(internal.platformNotifications.optOutInfo, { token })
      : null;
    if (!info) return unsubscribePage("Link not valid", "This unsubscribe link has expired or is not valid.");
    if (info.optedOut) {
      return unsubscribePage("You are unsubscribed", `${escapeHtml(info.address)} no longer receives offers from us.`);
    }
    return unsubscribePage(
      "Unsubscribe from offers",
      `Stop sending offers to ${escapeHtml(info.address)}? You will still get service notices about your account.`,
      `<form method="post"><button style="background:#18181b;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer">Unsubscribe</button></form>`
    );
  }),
});

http.route({
  pathPrefix: "/unsubscribe/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = unsubscribeToken(request);
    const done = token ? await ctx.runMutation(internal.platformNotifications.optOut, { token }) : false;
    return done
      ? unsubscribePage("You are unsubscribed", "You will no longer receive offers from us.")
      : unsubscribePage("Link not valid", "This unsubscribe link has expired or is not valid.");
  }),
});

export default http;
