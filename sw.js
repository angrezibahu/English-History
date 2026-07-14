/* ---------------------------------------------------------------------------
   Service worker — offline support for the history course PWA.

   Strategy:
     - App shell (html/css/js/manifest/icons/course index): precached on install,
       served cache-first, refreshed in the background.
     - Navigations: serve the cached app shell (SPA fallback) so the app opens
       with no network.
     - Markdown notes & the course index: stale-while-revalidate.
     - Audio: cache-first, with Range-request support so seeking works offline.
   Bump CACHE_VERSION to roll all caches.
--------------------------------------------------------------------------- */
"use strict";

var CACHE_VERSION = "v1";
var SHELL_CACHE = "eh-shell-" + CACHE_VERSION;
var CONTENT_CACHE = "eh-content-" + CACHE_VERSION;
var AUDIO_CACHE = "eh-audio-" + CACHE_VERSION;

// Directory the SW controls (works whether hosted at domain root or /repo/).
var SCOPE = self.registration.scope; // e.g. https://user.github.io/English-History/
var rel = function (p) {
  return new URL(p, SCOPE).toString();
};

var SHELL_ASSETS = [
  "",
  "index.html",
  "manifest.webmanifest",
  "assets/css/app.css",
  "assets/js/app.js",
  "assets/js/markdown.js",
  "assets/icons/favicon-32.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "course/index.json",
].map(rel);

var AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;
var MD_RE = /\.md($|\?)/i;

// --- install / activate ----------------------------------------------------
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll is atomic; if one asset 404s the whole install fails, so add
      // individually and tolerate a miss (e.g. an icon not yet generated).
      return Promise.all(
        SHELL_ASSETS.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  var keep = [SHELL_CACHE, CONTENT_CACHE, AUDIO_CACHE];
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k.indexOf("eh-") === 0 && keep.indexOf(k) === -1) return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// --- messaging: explicit "save for offline" --------------------------------
self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type === "cache-audio" && data.url) {
    var reply = event.ports && event.ports[0];
    fetch(data.url)
      .then(function (resp) {
        if (!resp.ok) throw new Error("status " + resp.status);
        return caches.open(AUDIO_CACHE).then(function (c) {
          return c.put(data.url, resp.clone());
        });
      })
      .then(function () {
        if (reply) reply.postMessage({ ok: true });
      })
      .catch(function (err) {
        if (reply) reply.postMessage({ ok: false, error: String(err) });
      });
  }
});

// --- fetch -----------------------------------------------------------------
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  // Navigations -> app shell (SPA).
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(rel("index.html")).then(function (cached) {
        return (
          cached ||
          fetch(req).catch(function () {
            return caches.match(rel(""));
          })
        );
      })
    );
    return;
  }

  if (!sameOrigin) return; // let cross-origin requests pass through

  // Audio: cache-first with range support.
  if (AUDIO_RE.test(url.pathname)) {
    event.respondWith(handleAudio(req, url));
    return;
  }

  // Course index & markdown notes: stale-while-revalidate.
  if (MD_RE.test(url.pathname) || url.pathname.endsWith("/course/index.json") || url.pathname.endsWith("index.json")) {
    event.respondWith(staleWhileRevalidate(req, CONTENT_CACHE));
    return;
  }

  // Everything else same-origin (shell assets): cache-first, revalidate.
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (cached) {
      var network = fetch(req)
        .then(function (resp) {
          if (resp && resp.ok && resp.type === "basic") cache.put(req, resp.clone());
          return resp;
        })
        .catch(function () {
          return cached;
        });
      return cached || network;
    });
  });
}

// Serve audio from cache, satisfying Range requests by slicing the cached body.
function handleAudio(req, url) {
  var range = req.headers.get("range");
  return caches.open(AUDIO_CACHE).then(function (cache) {
    return cache.match(url.toString(), { ignoreSearch: false }).then(function (cached) {
      if (cached) {
        return range ? sliceResponse(cached, range) : cached;
      }
      // Not cached: fetch, cache the full body, then answer (with range if asked).
      return fetch(new Request(url.toString(), { cache: "reload" }))
        .then(function (resp) {
          if (!resp.ok) return resp;
          cache.put(url.toString(), resp.clone());
          return range ? sliceResponse(resp, range) : resp;
        })
        .catch(function () {
          // Offline and uncached — fall back to a plain network attempt.
          return fetch(req);
        });
    });
  });
}

function sliceResponse(response, rangeHeader) {
  return response.clone().arrayBuffer().then(function (buffer) {
    var total = buffer.byteLength;
    var m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || "");
    var start = m && m[1] ? parseInt(m[1], 10) : 0;
    var end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      return new Response(null, {
        status: 416,
        statusText: "Range Not Satisfiable",
        headers: { "Content-Range": "bytes */" + total },
      });
    }
    var chunk = buffer.slice(start, end + 1);
    var headers = new Headers(response.headers);
    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + total);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Length", String(chunk.byteLength));
    return new Response(chunk, { status: 206, statusText: "Partial Content", headers: headers });
  });
}
