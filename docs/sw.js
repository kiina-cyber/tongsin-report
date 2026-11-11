/* 離線快取：沒有網路時也能打開 App
   更新 App 檔案後，把 VERSION 的數字加 1，手機下次開啟就會換成新版。 */
const VERSION = 'tongsin-v2';
const APP_FILES = ['./', './index.html', './shared.js', './config.js', './manifest.webmanifest',
                   './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const RUNTIME = 'tongsin-runtime';     // 字體、Excel 套件：第一次用到時存起來

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== RUNTIME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET') return;                                   // 同步資料（POST）一律走網路
  if(url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;
  if(url.origin === location.origin){
    // App 本體：先用網路拿最新版，沒網路就用快取
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch:true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  if(/fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/.test(url.hostname)){
    // 字體與 Excel 套件：先用快取，背景更新
    e.respondWith(caches.open(RUNTIME).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if(res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});
