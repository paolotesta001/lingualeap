// ===== LinguaLeap service worker =====
// Cache-first for the app shell + bundled data so it works offline and installs
// to the home screen. Cross-origin calls (Gemini, MyMemory, Google Fonts) are
// left untouched so they always hit the live network.
const CACHE_NAME = "lingualeap-v4";

const ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./api-shim.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/apple-touch-icon.png",
    "./data/languages.json",
    "./data/lessons.json",
    "./data/dictionary/dictionary.json",
    "./data/english.json",
    "./data/spanish.json",
    "./data/italian.json",
    "./data/french.json",
    "./data/german.json",
    "./data/favourites.csv",
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            // Don't let one missing file abort the whole install
            Promise.all(ASSETS.map((url) =>
                cache.add(url).catch((err) => console.warn("SW cache miss:", url, err))
            ))
        )
    );
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    const url = new URL(req.url);

    // Only manage same-origin GETs. Everything else (Gemini POST, MyMemory,
    // fonts) bypasses the SW and hits the network directly.
    if (req.method !== "GET" || url.origin !== location.origin) return;

    e.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                    }
                    return res;
                })
                .catch(() => cached);
            // Serve cache immediately when present, refresh in background.
            return cached || network;
        })
    );
});
