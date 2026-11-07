// The one-line embed: `<script src=".../widget/<channelKey>/embed.js" async>`.
//
// An iframe alone cannot do this job. The chat panel has to appear and
// disappear on click, and an iframe cannot resize itself on the host page — so
// the launcher button and the panel's frame live in the host document, and only
// the chat itself is inside the iframe. The iframe is not created until the
// first open, so a page that nobody clicks pays nothing for the widget.
//
// Everything is customisable from the script tag:
//
//   <script src="…/embed.js"
//           data-position="left"        left | right (default right)
//           data-color="#25D366"        launcher colour, and the chat's own
//           data-icon="chat-dots"       whatsapp | chat | chat-dots | sparkles |
//                                       bot | headset | smile | help (default whatsapp)
//           data-animation="pulse"      none | pulse | bounce | wiggle | breathe
//                                       (default none); paused while open and
//                                       for visitors who prefer reduced motion
//           data-label="Chat with us"   tooltip / aria-label
//           data-teaser="Hi! Need a hand?"   one-line bubble beside the button
//           data-auto-open="3000"       ms before it opens itself, once per tab
//           data-z-index="2147483000"
//           async></script>

import type { NextRequest } from "next/server";

// Matches convex/lib/shared.ts randomKey(): lowercase alphanumerics only.
const CHANNEL_KEY = /^[a-z0-9]{8,64}$/;

function scriptResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Short enough that a rotated key stops working quickly, long enough
      // that the file is not refetched on every page view.
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// The app's own public origin. Behind a proxy the request URL is the internal
// one, so the forwarded headers win when they are present.
function publicOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelKey: string }> }
) {
  const { channelKey } = await params;

  if (!CHANNEL_KEY.test(channelKey)) {
    return scriptResponse(
      `console.error("[magic-ai-bot] This embed snippet has an invalid widget key.");`,
      400
    );
  }

  const config = JSON.stringify({
    origin: publicOrigin(request),
    channelKey,
  });

  return scriptResponse(loader(config));
}

function loader(config: string): string {
  return `(function () {
  "use strict";

  var CONFIG = ${config};
  var NS = "magic-ai-bot";
  var ROOT_ID = NS + "-root-" + CONFIG.channelKey;

  // A site that pastes the snippet into both a layout and a page would
  // otherwise get two launchers.
  if (document.getElementById(ROOT_ID)) return;

  var script = document.currentScript;
  function opt(name, fallback) {
    var value = script && script.getAttribute("data-" + name);
    return value === null || value === undefined || value === "" ? fallback : value;
  }

  var side = opt("position", "right") === "left" ? "left" : "right";
  // The launcher's default is WhatsApp's brand green, which is too light to
  // carry white text — so the chat panel has its own, darker default in CSS and
  // only hears about this one when the site actually chose a colour.
  var color = opt("color", "#25D366");
  var chosenColor = script && script.getAttribute("data-color");
  var icon = opt("icon", "whatsapp");
  var animation = opt("animation", "none");
  if (!/^(pulse|bounce|wiggle|breathe)$/.test(animation)) animation = "none";
  var label = opt("label", "Chat with us");
  var teaser = opt("teaser", "");
  var zIndex = parseInt(opt("z-index", "2147483000"), 10) || 2147483000;
  var autoOpen = parseInt(opt("auto-open", ""), 10);

  var OPEN_KEY = NS + ":open:" + CONFIG.channelKey;
  var SEEN_KEY = NS + ":auto-opened:" + CONFIG.channelKey;

  function remember(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (e) {}
  }
  function recall(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }

  // Carry the host page's utm_name / utm_phone into the widget, so a site that
  // already knows who the visitor is can skip asking again.
  function frameSrc() {
    var url = CONFIG.origin + "/widget/" + CONFIG.channelKey + "?embed=1";
    try {
      var host = new URLSearchParams(window.location.search);
      ["utm_name", "utm_phone"].forEach(function (key) {
        var value = host.get(key);
        if (value) url += "&" + key + "=" + encodeURIComponent(value);
      });
    } catch (e) {}
    // A site that picked its own colour gets it through the whole widget, not
    // just the button. The page ignores anything that is not a hex literal.
    if (chosenColor) url += "&color=" + encodeURIComponent(chosenColor);
    return url;
  }

  // Each launcher icon: [filled, inner SVG]. Filled glyphs take the launcher's
  // text colour as fill; the rest are 2px line icons drawn in it.
  var ICONS = {
    whatsapp: [true, '<path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01ZM12.05 20.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23a8.18 8.18 0 0 1 5.82 2.42 8.16 8.16 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.4-.12-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.49-.61 1.7-1.2.21-.59.21-1.1.15-1.2-.06-.11-.23-.17-.48-.29Z"/>'],
    chat: [true, '<path d="M12 3c-4.97 0-9 3.58-9 8 0 2.37 1.16 4.5 3 5.95V21l3.3-1.65c.86.23 1.76.35 2.7.35 4.97 0 9-3.58 9-8s-4.03-8-9-8Z"/>'],
    "chat-dots": [false, '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="3"/>'],
    sparkles: [false, '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0Z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>'],
    bot: [false, '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>'],
    headset: [false, '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>'],
    smile: [false, '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01" stroke-width="3"/>'],
    help: [false, '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01" stroke-width="3"/>'],
  };
  if (!ICONS.hasOwnProperty(icon)) icon = "whatsapp";

  function iconSvg() {
    var def = ICONS[icon];
    var paint = def[0]
      ? 'fill="currentColor"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    return (
      '<span class="mab-icon"><svg viewBox="0 0 24 24" width="' + (def[0] ? 30 : 28) + '" height="' + (def[0] ? 30 : 28) + '" ' +
      paint + ' aria-hidden="true" focusable="false">' + def[1] + '</svg></span>'
    );
  }
  var CLOSE_SVG =
    '<span class="mab-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<path d="M6 6l12 12M18 6L6 18"/></svg></span>';

  // ---------------------------------------------------------------- styles ---
  // Scoped to #ROOT_ID and marked !important where the host page's own reset
  // would otherwise reach in (button styles and box-sizing especially).
  var style = document.createElement("style");
  style.textContent = [
    "#" + ROOT_ID + "{position:fixed;bottom:0;" + side + ":0;z-index:" + zIndex + ";",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}",
    "#" + ROOT_ID + " *{box-sizing:border-box!important;}",
    "#" + ROOT_ID + " .mab-launcher{position:fixed;bottom:20px;" + side + ":20px;",
      "width:60px;height:60px;border-radius:50%;border:0!important;padding:0!important;margin:0!important;",
      "display:flex;align-items:center;justify-content:center;cursor:pointer;",
      "background:" + color + ";color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.28);",
      "transition:transform .18s ease,box-shadow .18s ease;-webkit-appearance:none;appearance:none;}",
    "#" + ROOT_ID + " .mab-launcher:hover{transform:scale(1.06);box-shadow:0 10px 26px rgba(0,0,0,.34);}",
    "#" + ROOT_ID + " .mab-icon{display:flex;align-items:center;justify-content:center;animation:mab-in .25s ease-out;}",
    // Attention animations, all paused while the chat is open or hovered.
    "#" + ROOT_ID + "[data-animation='pulse'] .mab-launcher::before{content:'';position:absolute;inset:0;border-radius:50%;",
      "background:" + color + ";z-index:-1;animation:mab-pulse 2s ease-out infinite;}",
    "#" + ROOT_ID + "[data-animation='bounce'] .mab-launcher{animation:mab-bounce 3.2s ease-in-out 1s infinite;}",
    "#" + ROOT_ID + "[data-animation='wiggle'] .mab-launcher .mab-icon{animation:mab-in .25s ease-out,mab-wiggle 3.5s ease-in-out 1s infinite;}",
    "#" + ROOT_ID + "[data-animation='breathe'] .mab-launcher{animation:mab-breathe 2.4s ease-in-out infinite alternate;}",
    "#" + ROOT_ID + "[data-open='true'] .mab-launcher,#" + ROOT_ID + " .mab-launcher:hover{animation:none!important;}",
    "#" + ROOT_ID + "[data-open='true'] .mab-launcher::before,#" + ROOT_ID + "[data-open='true'] .mab-launcher .mab-icon{animation:mab-in .25s ease-out!important;}",
    "#" + ROOT_ID + "[data-open='true'] .mab-launcher::before{display:none;}",
    "@keyframes mab-in{from{transform:rotate(-90deg) scale(.5);opacity:0}to{transform:none;opacity:1}}",
    "@keyframes mab-pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.7);opacity:0}}",
    "@keyframes mab-bounce{0%,30%,100%{transform:translateY(0)}10%{transform:translateY(-12px)}18%{transform:translateY(0)}24%{transform:translateY(-5px)}}",
    "@keyframes mab-wiggle{0%,30%,100%{transform:rotate(0)}5%{transform:rotate(-16deg)}10%{transform:rotate(14deg)}15%{transform:rotate(-10deg)}20%{transform:rotate(6deg)}25%{transform:rotate(-2deg)}}",
    "@keyframes mab-breathe{from{transform:scale(1)}to{transform:scale(1.08)}}",
    "#" + ROOT_ID + " .mab-launcher:focus-visible{outline:3px solid #fff;outline-offset:3px;}",
    "#" + ROOT_ID + " .mab-teaser{position:fixed;bottom:34px;" + side + ":92px;max-width:220px;",
      "background:#fff;color:#111827;border-radius:14px;padding:10px 14px;font-size:14px;line-height:1.35;",
      "box-shadow:0 6px 20px rgba(0,0,0,.18);cursor:pointer;transition:opacity .2s ease;}",
    "#" + ROOT_ID + " .mab-panel{position:fixed;bottom:92px;" + side + ":20px;",
      "width:400px;height:min(620px,calc(100vh - 120px));",
      "background:#fff;border-radius:16px;overflow:hidden;",
      "box-shadow:0 18px 50px rgba(0,0,0,.28);",
      "opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;",
      "transition:opacity .2s ease,transform .2s ease;}",
    "#" + ROOT_ID + "[data-open='true'] .mab-panel{opacity:1;transform:none;pointer-events:auto;}",
    "#" + ROOT_ID + "[data-open='true'] .mab-teaser{display:none;}",
    "#" + ROOT_ID + " .mab-panel iframe{width:100%!important;height:100%!important;border:0!important;display:block;}",
    // On a phone the panel is the screen: a 400px card with a launcher on top
    // of it is unusable.
    "@media (max-width:480px){",
      "#" + ROOT_ID + " .mab-panel{bottom:0;left:0;right:0;width:100%;height:100%;border-radius:0;}",
      "#" + ROOT_ID + "[data-open='true'] .mab-launcher{display:none;}",
      "#" + ROOT_ID + " .mab-teaser{max-width:160px;}",
    "}",
    "@media (prefers-reduced-motion:reduce){",
      "#" + ROOT_ID + " .mab-launcher,#" + ROOT_ID + " .mab-panel{transition:none;}",
      "#" + ROOT_ID + " .mab-launcher,#" + ROOT_ID + " .mab-launcher::before,#" + ROOT_ID + " .mab-icon{animation:none!important;}",
      "#" + ROOT_ID + " .mab-launcher::before{display:none;}",
    "}",
  ].join("");

  // ---------------------------------------------------------------- markup ---
  var root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("data-open", "false");
  root.setAttribute("data-animation", animation);

  var panel = document.createElement("div");
  panel.className = "mab-panel";
  // Hidden from assistive tech and from tab order until it is opened.
  panel.setAttribute("aria-hidden", "true");

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "mab-launcher";
  launcher.setAttribute("aria-label", label);
  launcher.setAttribute("aria-expanded", "false");
  launcher.title = label;
  launcher.innerHTML = iconSvg();

  var teaserEl = null;
  if (teaser) {
    teaserEl = document.createElement("div");
    teaserEl.className = "mab-teaser";
    teaserEl.textContent = teaser;
    teaserEl.setAttribute("role", "button");
    teaserEl.setAttribute("tabindex", "0");
  }

  root.appendChild(panel);
  if (teaserEl) root.appendChild(teaserEl);
  root.appendChild(launcher);

  // ------------------------------------------------------------- behaviour ---
  var frame = null;
  var open = false;

  function mountFrame() {
    if (frame) return;
    frame = document.createElement("iframe");
    frame.src = frameSrc();
    frame.title = label;
    frame.setAttribute("allow", "clipboard-write");
    panel.appendChild(frame);
  }

  function setOpen(next) {
    open = next;
    root.setAttribute("data-open", next ? "true" : "false");
    panel.setAttribute("aria-hidden", next ? "false" : "true");
    launcher.setAttribute("aria-expanded", next ? "true" : "false");
    launcher.setAttribute("aria-label", next ? "Close chat" : label);
    launcher.title = next ? "Close chat" : label;
    launcher.innerHTML = next ? CLOSE_SVG : iconSvg();
    remember(OPEN_KEY, next ? "1" : "0");
    if (next) {
      mountFrame();
      // Focus goes into the chat, so typing works straight away.
      if (frame) { try { frame.focus(); } catch (e) {} }
    } else {
      try { launcher.focus(); } catch (e) {}
    }
  }

  launcher.addEventListener("click", function () { setOpen(!open); });
  if (teaserEl) {
    teaserEl.addEventListener("click", function () { setOpen(true); });
    teaserEl.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
      }
    });
  }

  // Escape closes it, the way every other dialog on the page does.
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && open) setOpen(false);
  });

  // The close button inside the chat cannot collapse the panel itself — the
  // panel belongs to this document — so it asks us to.
  window.addEventListener("message", function (event) {
    if (event.origin !== CONFIG.origin) return;
    var data = event.data;
    if (!data || data.source !== NS) return;
    if (data.type === "close") setOpen(false);
    if (data.type === "open") setOpen(true);
  });

  function mount() {
    document.head.appendChild(style);
    document.body.appendChild(root);

    // Stay open across a navigation on the host site.
    if (recall(OPEN_KEY) === "1") {
      setOpen(true);
    } else if (!isNaN(autoOpen) && recall(SEEN_KEY) !== "1") {
      window.setTimeout(function () {
        if (!open) {
          remember(SEEN_KEY, "1");
          setOpen(true);
        }
      }, Math.max(0, autoOpen));
    }
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }

  // A tiny handle for the host page: window.MagicAIBot.open() / .close().
  window.MagicAIBot = window.MagicAIBot || {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: function () { setOpen(!open); },
  };
})();
`;
}
