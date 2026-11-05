// Keeps the app working offline and supplies the policy headers that static hosts
// cannot configure. Scoped to the app's base path. Recordings stay in OPFS and speech
// models in their own caches; this only holds the app and files it fetches on first use.
const APP_CACHE = "word-trail-app-v1";
const FILES_CACHE = "word-trail-files-v1";
const TILES_CACHE = "word-trail-tiles-v1";
const MAX_CACHED_TILES = 3000;
// Hosts may send Vary: Origin, which must not hide a file fetched by a different kind of request.
const MATCH_OPTIONS = { ignoreVary: true };
// Fetched on first use, then needed offline: the video encoder and the optional local voices.
const CACHED_FILES = [/^https:\/\/unpkg\.com\/@ffmpeg\//, /^https:\/\/huggingface\.co\/Supertone\//];
const TILES = /^https:\/\/tile\.openstreetmap\.org\//;

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const current = [APP_CACHE, FILES_CACHE, TILES_CACHE];
  await Promise.all((await caches.keys()).filter((key) => key.startsWith("word-trail-") && !current.includes(key)).map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

// Requested by the page once it is running, so a slow download can never delay startup.
self.addEventListener("message", (event) => {
  if (event.data === "precache") event.waitUntil(precache());
});

async function precache() {
  const response = await fetch(new URL("precache.json", self.registration.scope), { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return;
  const files = (await response.json()).map((file) => new URL(file, self.registration.scope).href);
  const wanted = new Set([...files, self.registration.scope]);
  const cache = await caches.open(APP_CACHE);
  // Remove files from older builds, whose hashed names are no longer referenced.
  await Promise.all((await cache.keys()).filter((request) => !wanted.has(request.url)).map((request) => cache.delete(request)));
  // The code that starts the app first, so offline use works as early as possible.
  const isLarge = (file) => /\.(wasm|onnx|ttf|woff2?|data)$/.test(file);
  const queue = [self.registration.scope, ...files.filter((file) => !isLarge(file)), ...files.filter(isLarge)];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      if (!await cache.match(url, MATCH_OPTIONS)) await cache.add(url).catch(() => {});
    }
  }));
}

function isolate(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fromNetworkThenCache(request, key = request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key, MATCH_OPTIONS);
    if (cached) return cached;
    throw error;
  }
}

async function fromCacheThenNetwork(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, MATCH_OPTIONS);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function tile(request) {
  const cache = await caches.open(TILES_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_CACHED_TILES)).map((key) => cache.delete(key)));
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, MATCH_OPTIONS);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    if (request.method !== "GET" || request.mode !== "cors") return;
    if (TILES.test(request.url)) event.respondWith(tile(request));
    else if (CACHED_FILES.some((pattern) => pattern.test(request.url))) event.respondWith(fromCacheThenNetwork(request, FILES_CACHE));
    return;
  }
  // Leave browser cache probes untouched.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  // The file list must stay fresh so that updates are noticed.
  if (request.method !== "GET" || request.headers.has("range") || url.pathname.endsWith("/precache.json")) {
    event.respondWith(fetch(request).then(isolate));
  }
  else if (request.mode === "navigate") {
    event.respondWith(fromNetworkThenCache(request, self.registration.scope).then(isolate));
  }
  else {
    event.respondWith(fromCacheThenNetwork(request, APP_CACHE).then(isolate));
  }
});
