// The one-line embed for the AI voice widget:
//
//   <script src=".../voice/<channelKey>/embed.js"
//           data-position="top-right"   top-left | top-center | top-right |
//                                       bottom-left | bottom-center | bottom-right
//                                       (defaults to the channel's setting)
//           data-offset="20"            distance from the edges, in px
//           data-z-index="2147483000"
//           async></script>
//
// The sphere lives in a small transparent iframe pinned to the chosen corner.
// The page inside reports its size as captions come and go, so the frame never
// covers more of the host page than it draws on.

import type { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const CHANNEL_KEY = /^[a-z0-9]{8,64}$/;
const ORB_SIZE = { small: 88, medium: 120, large: 160 } as const;

function scriptResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function publicOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelKey: string }> }
) {
  const { channelKey } = await params;
  if (!CHANNEL_KEY.test(channelKey)) {
    return scriptResponse(`console.error("[magic-ai-bot] This voice widget snippet has an invalid key.");`, 400);
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const settings = convexUrl
    ? await new ConvexHttpClient(convexUrl)
        .query(api.voiceWidget.embedConfig, { channelKey })
        .catch(() => null)
    : null;
  if (!settings) {
    return scriptResponse(`console.warn("[magic-ai-bot] This voice widget is paused or no longer exists.");`);
  }

  const config = JSON.stringify({
    origin: publicOrigin(request),
    channelKey,
    position: settings.position,
    orb: ORB_SIZE[settings.size] + 16,
  });
  return scriptResponse(loader(config));
}

function loader(config: string): string {
  return `(function () {
  "use strict";
  var CONFIG = ${config};
  var ID = "magic-ai-bot-voice-" + CONFIG.channelKey;
  if (document.getElementById(ID)) return;

  var script = document.currentScript;
  var data = (script && script.dataset) || {};
  var POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];
  var position = POSITIONS.indexOf(data.position) >= 0 ? data.position : CONFIG.position;
  var offset = Math.max(0, parseInt(data.offset || "20", 10) || 20) + "px";
  var zIndex = data.zIndex || "2147483000";

  function mount() {
    if (document.getElementById(ID)) return;
    var frame = document.createElement("iframe");
    frame.id = ID;
    frame.title = "AI voice assistant";
    frame.src = CONFIG.origin + "/voice/" + CONFIG.channelKey + "?embed=1";
    frame.allow = "microphone; autoplay";
    frame.setAttribute("allowtransparency", "true");
    var vertical = position.indexOf("top") === 0 ? "top" : "bottom";
    var horizontal = position.split("-")[1];
    var style = {
      position: "fixed",
      border: "0",
      margin: "0",
      padding: "0",
      background: "transparent",
      colorScheme: "normal",
      overflow: "hidden",
      width: CONFIG.orb + "px",
      height: CONFIG.orb + "px",
      zIndex: zIndex
    };
    style[vertical] = offset;
    if (horizontal === "center") {
      style.left = "50%";
      style.transform = "translateX(-50%)";
    } else {
      style[horizontal] = offset;
    }
    for (var key in style) frame.style[key] = style[key];

    window.addEventListener("message", function (event) {
      if (event.origin !== CONFIG.origin || event.source !== frame.contentWindow) return;
      var msg = event.data;
      if (!msg || msg.type !== "magic-ai-bot:voice-size" || msg.channelKey !== CONFIG.channelKey) return;
      var width = Math.min(Math.max(msg.width, 40), window.innerWidth - 16);
      var height = Math.min(Math.max(msg.height, 40), window.innerHeight - 16);
      frame.style.width = width + "px";
      frame.style.height = height + "px";
    });

    document.body.appendChild(frame);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
`;
}
