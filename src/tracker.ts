/**
 * The client-side tracking script served at GET /js/script.js.
 *
 * It is a drop-in replacement for Plausible's script.js: the same
 * `window.plausible(...)` API, the same payload field names (n/u/d/r/w/h/p),
 * automatic SPA pageviews, and a localhost/bot guard. Existing Plausible users
 * migrate by pointing `src` at https://stats.houtini.ai/js/script.js — nothing
 * else changes.
 *
 * The endpoint is derived from the script's own origin, so this exact byte
 * stream works unmodified on any deployment host.
 */
export const TRACKER_SCRIPT = `(function(){
  "use strict";
  var loc = window.location, doc = window.document;
  var script = doc.currentScript;
  var endpoint = (script && script.getAttribute("data-api")) || new URL(script.src).origin + "/api/event";
  var domain = script && script.getAttribute("data-domain");
  var hashMode = /hash/.test(script.src) || (script && script.getAttribute("data-hash") === "true");

  function warn(reason){ if (script && script.getAttribute("data-debug")) console.warn("[pfc] ignoring event: " + reason); }

  function send(name, options){
    if (/^localhost$|^127(\\.[0-9]+){0,2}\\.[0-9]+$|^\\[::1?\\]?$/.test(loc.hostname) || loc.protocol === "file:") return warn("localhost");
    if (window._phantom || window.__nightmare || window.navigator.webdriver || window.Cypress) return warn("automation");
    if (localStorage.plausible_ignore === "true") return warn("localStorage flag");

    var payload = { n: name, u: loc.href, d: domain, r: doc.referrer || null, w: window.innerWidth };
    if (hashMode) payload.h = 1;
    if (options && options.meta) payload.m = JSON.stringify(options.meta);
    if (options && options.props) payload.p = options.props;

    var req = new XMLHttpRequest();
    req.open("POST", endpoint, true);
    req.setRequestHeader("Content-Type", "text/plain");
    req.onreadystatechange = function(){
      if (req.readyState === 4 && options && options.callback) options.callback({ status: req.status });
    };
    req.send(JSON.stringify(payload));
  }

  var queue = (window.plausible && window.plausible.q) || (window.insights && window.insights.q) || [];
  window.plausible = function(name, options){ send(name, options); };
  window.insights = window.plausible; // native alias
  for (var i = 0; i < queue.length; i++) window.plausible.apply(this, queue[i]);

  var lastPath;
  function pageview(){
    if (!hashMode && lastPath === loc.pathname) return;
    lastPath = loc.pathname;
    send("pageview");
  }

  var history = window.history;
  if (history.pushState){
    var orig = history.pushState;
    history.pushState = function(){ orig.apply(this, arguments); pageview(); };
    window.addEventListener("popstate", pageview);
  }
  if (hashMode) window.addEventListener("hashchange", pageview);

  if (doc.visibilityState === "prerender"){
    doc.addEventListener("visibilitychange", function(){ if (!lastPath && doc.visibilityState === "visible") pageview(); });
  } else {
    pageview();
  }
})();`;

/**
 * The native Insights tracking script served at GET /insights.js.
 *
 * Same behaviour as the Plausible-compatible script, but it POSTs the clean,
 * self-describing payload ({ event, url, domain, referrer, viewport, props })
 * and exposes window.insights(...). The ingester accepts both formats, so this
 * is purely a nicer developer-facing surface.
 */
export const INSIGHTS_SCRIPT = `(function(){
  "use strict";
  var loc = window.location, doc = window.document;
  var script = doc.currentScript;
  var endpoint = (script && script.getAttribute("data-api")) || new URL(script.src).origin + "/api/event";
  var domain = script && script.getAttribute("data-domain");
  var hashMode = /hash/.test(script.src) || (script && script.getAttribute("data-hash") === "true");

  function send(name, options){
    if (/^localhost$|^127(\\.[0-9]+){0,2}\\.[0-9]+$|^\\[::1?\\]?$/.test(loc.hostname) || loc.protocol === "file:") return;
    if (window._phantom || window.__nightmare || window.navigator.webdriver || window.Cypress) return;
    if (localStorage.insights_ignore === "true") return;

    var payload = { event: name, url: loc.href, domain: domain, referrer: doc.referrer || null, viewport: window.innerWidth };
    if (hashMode) payload.hash = 1;
    if (options && options.props) payload.props = options.props;

    var req = new XMLHttpRequest();
    req.open("POST", endpoint, true);
    req.setRequestHeader("Content-Type", "text/plain");
    req.onreadystatechange = function(){
      if (req.readyState === 4 && options && options.callback) options.callback({ status: req.status });
    };
    req.send(JSON.stringify(payload));
  }

  var queue = (window.insights && window.insights.q) || [];
  window.insights = function(name, options){ send(name, options); };
  window.plausible = window.insights; // back-compat alias
  for (var i = 0; i < queue.length; i++) window.insights.apply(this, queue[i]);

  var lastPath;
  function pageview(){
    if (!hashMode && lastPath === loc.pathname) return;
    lastPath = loc.pathname;
    send("pageview");
  }

  var history = window.history;
  if (history.pushState){
    var orig = history.pushState;
    history.pushState = function(){ orig.apply(this, arguments); pageview(); };
    window.addEventListener("popstate", pageview);
  }
  if (hashMode) window.addEventListener("hashchange", pageview);

  if (doc.visibilityState === "prerender"){
    doc.addEventListener("visibilitychange", function(){ if (!lastPath && doc.visibilityState === "visible") pageview(); });
  } else {
    pageview();
  }
})();`;
