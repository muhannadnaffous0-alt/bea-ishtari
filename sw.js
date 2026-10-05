// Service worker: بيخزّن واجهة التطبيق ليفتح بسرعة وحتى بدون نت.
// البيانات نفسها (الإعلانات) بيخزّنها Firebase لحاله.
const CACHE = "bea-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "shared.js", "firebase.js", "firebase-config.js", "manifest.json", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Firebase والخطوط: مباشرة
  // الشبكة أولاً (لتوصل التحديثات فوراً)، والكاش إذا ما في نت
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match("index.html")))
  );
});
