// 土日和 Service Worker
// 画面のファイル(HTML/CSS/JS/JSON)を変えたら CACHE_NAME の数字を上げる(CLAUDE.md 参照)。
const CACHE_NAME = 'tsuchibiyori-v1';
const SHELL = [
  './',
  'index.html',
  'css/style.css?v=1',
  'js/app.js?v=1',
  'js/logic.js?v=1',
  'data/tasks.json?v=1',
  'data/crops.json?v=1',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 同じサイトのファイルだけ扱う。ネットを先に見て、つながらない時だけ保存分を返す。
// 天気・住所検索(外部API)には手を出さない。
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
