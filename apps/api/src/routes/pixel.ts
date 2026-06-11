// Browser measurement snippet (W2.3). Sites embed:
//   <script src="https://<engine>/pixel.js" data-site="my-shop" data-key="sk_..."></script>
// It captures ad click IDs on landing, persists them 180 days, auto-sends
// ViewContent, and exposes window.adEngine.track(name, props) — closing the
// landing-capture dependency (SW §8.3) without site engineering work.
import type { FastifyInstance } from "fastify";

const PIXEL_SOURCE = `(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var SITE = script.getAttribute("data-site");
  var KEY = script.getAttribute("data-key");
  if (!SITE || !KEY) return;
  var ENDPOINT = new URL(script.src).origin + "/v1/events";
  var STORE = "adengine_ids";
  var TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days (Google requires >= 180d)
  var CLICK_PARAMS = ["fbclid", "gclid", "gbraid", "wbraid", "ttclid", "sccid", "epik"];

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (parsed._ts && Date.now() - parsed._ts > TTL_MS) return {};
      return parsed;
    } catch (e) {
      return {};
    }
  }

  function writeStore(ids) {
    try {
      ids._ts = ids._ts || Date.now();
      localStorage.setItem(STORE, JSON.stringify(ids));
    } catch (e) {
      /* storage unavailable — events still send without persisted ids */
    }
  }

  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Capture click IDs from the landing URL on every page view.
  var ids = readStore();
  var params = new URLSearchParams(location.search);
  var found = false;
  for (var i = 0; i < CLICK_PARAMS.length; i++) {
    var v = params.get(CLICK_PARAMS[i]);
    if (v) {
      ids[CLICK_PARAMS[i]] = v;
      found = true;
    }
  }
  var fbp = readCookie("_fbp");
  if (fbp) ids.fbp = fbp;
  if (found || fbp) {
    ids._ts = Date.now();
    writeStore(ids);
  }

  function clickIds() {
    var out = {};
    var stored = readStore();
    for (var k in stored) {
      if (k !== "_ts" && stored[k]) out[k] = stored[k];
    }
    return out;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "e-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function track(eventName, props) {
    props = props || {};
    var payload = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      content_id: props.content_id || location.pathname || "/",
      event_id: props.event_id || uuid(),
      source_site: SITE,
      click_ids: clickIds(),
      hashed_identifiers: props.hashed_identifiers || {},
    };
    if (typeof props.value === "number") {
      payload.value = props.value;
      payload.currency = props.currency || "AED";
    }
    if (props.consent) payload.consent = props.consent;
    try {
      var body = JSON.stringify(payload);
      fetch(ENDPOINT, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json", "x-api-key": KEY },
        body: body,
      }).catch(function () {});
    } catch (e) {
      /* never break the host page */
    }
    return payload.event_id;
  }

  window.adEngine = window.adEngine || { track: track, clickIds: clickIds };

  // Auto page-view unless the site opts out with data-manual="true".
  if (script.getAttribute("data-manual") !== "true") {
    track("ViewContent", {});
  }
})();
`;

export async function pixelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/pixel.js", async (_req, reply) => {
    return reply
      .type("application/javascript; charset=utf-8")
      .header("cache-control", "public, max-age=3600")
      .send(PIXEL_SOURCE);
  });
}
