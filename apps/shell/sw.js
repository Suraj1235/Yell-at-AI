// Offline app shell.
//
// Precaches the shell and the vendored engine so the app opens and reads your
// delivery with no network at all — which is the honest shape of this product,
// because the analysis never needed a server. The one thing that does not work
// offline is the browser's own speech recogniser, and the engine badge already
// says who that talks to.
//
// Cache-first for the precached shell, network-first for everything else, and
// a version bump drops the old cache wholesale rather than leaving a half-old
// mix of modules behind.

const VERSION = "yell-shell-v2";

const SHELL = [
  "./",
  "./index.html",
  "./shell.css",
  "./manifest.webmanifest",
  "./icons/mark.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./core/app.js",
  "./core/badge.js",
  "./core/capture-worklet.js",
  "./core/chips.js",
  "./core/engine.js",
  "./core/evidence.js",
  "./core/history.js",
  "./core/hotkey.js",
  "./core/live.js",
  "./core/onboarding.js",
  "./core/pill.js",
  "./core/settings.js",
  "./core/state.js",
  "./core/waveform.js",
  "./platform/platform.web.js",
  // The engine itself, vendored beside the landing page and shared with it.
  "../web/vendor/index.browser.js",
  "../web/vendor/alignment/proportional.js",
  "../web/vendor/alignment/word-timings.js",
  "../web/vendor/calibration/baseline.js",
  "../web/vendor/contract/analyzer.js",
  "../web/vendor/dsp/features.js",
  "../web/vendor/dsp/mel.js",
  "../web/vendor/dsp/pitch.js",
  "../web/vendor/dsp/stats.js",
  "../web/vendor/render/text.js",
  "../web/vendor/text/syllables.js",
  "../web/vendor/text/tokenize.js",
  "../web/vendor/transcribe/engines.js",
  "../web/vendor/transcript/envelope.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        // One missing file must not sink the whole install; the app still runs
        // online, and the next version fixes the list.
        Promise.all(SHELL.map((path) => cache.add(new Request(path, { cache: "reload" })).catch(() => null)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
