// Service worker cho PDF Tool.
// Chiến lược:
//  - Trang chính (HTML/điều hướng): ưu tiên mạng (có hạn chờ 4 giây), lỗi/offline thì dùng bản đã lưu -> luôn nhận bản mới sau khi cập nhật.
//  - /vendor/*, /assets/* (bundle có hash), /fonts/*: lấy từ bộ nhớ trước (cache-first) vì nội dung không đổi (khớp header "immutable").
//    Các thư viện này nằm trong bộ nhớ riêng, KHÔNG bị xóa khi ra bản mới -> mỗi lần cập nhật không phải tải lại vài MB.
//  - /legacy/*, /src/*, các file cùng nguồn khác (không có hash): ưu tiên mạng, mất mạng thì dùng bản đã lưu.
//  - Nguồn ngoài (CDN, dữ liệu OCR...): lưu ở lần đầu, các lần sau lấy từ bộ nhớ.
// Khi cài đặt: tải sẵn trang + toàn bộ file build (đọc từ index.html) + các file legacy, nên mở offline lần đầu vẫn chạy.
// __BUILD__ được thay bằng mã bản dựng mỗi lần `npm run build` (xem vite.config.js) -> mỗi bản mới là một phiên bản bộ nhớ mới.
const BUILD = '__BUILD__';
const APP_CACHE = 'pdftool-app-' + BUILD;
const VENDOR_CACHE = 'pdftool-vendor-v1';      // tăng số này khi đổi nội dung file trong /vendor

// Luôn tải sẵn (nhỏ, cần để mở được app khi offline)
const CORE = [
  './', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './logo.png',
  './legacy/00-fonts-meta.js', './legacy/04-lazy-libs.js', './legacy/05-core-utils.js', './legacy/06-pdf-ops.js',
  './legacy/10-core.js', './legacy/20-a.js', './legacy/30-b.js', './legacy/40-c.js', './legacy/50-d.js', './legacy/60-e.js',
  './legacy/80-g.js', './legacy/95-multipage.js', './legacy/96-editor-sig.js', './legacy/97-viewer.js', './legacy/08-a11y.js',
  './legacy/pdf-ops.worker.js',
  './legacy/90-i18n-a.js', './legacy/91-i18n-b.js', './legacy/92-i18n-ribbon.js', './legacy/93-i18n-ui.js', './legacy/94-i18n-v2.js'
];
// Tải sẵn vào bộ nhớ riêng (không đổi theo bản dựng)
const VENDOR_CORE = ['./vendor/pdf-lib.min.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js'];

const isVendorLike = (p) => /\/(vendor|assets|fonts)\//.test(p);

async function addAll(cacheName, urls) {
  const c = await caches.open(cacheName);
  await Promise.all(urls.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
}

// Đọc index.html để biết tên file build có hash (assets/index-xxxx.js, .css...) rồi tải sẵn, kể cả các chunk import động
async function discoverBuildAssets() {
  try {
    const res = await fetch('./index.html', { cache: 'reload' });
    if (!res.ok) return [];
    const html = await res.text();
    const base = new URL('./', self.location.href);
    const found = new Set();
    const re = /(?:src|href)=["']([^"']+\.(?:js|css|mjs))["']/g;
    let m;
    while ((m = re.exec(html))) {
      const u = new URL(m[1], base);
      if (u.origin === base.origin && !/\/legacy\//.test(u.pathname) && !/\/vendor\//.test(u.pathname)) found.add(u.href);
    }
    // chunk phụ mà bundle chính nhập động: "./ten-abc123.js" hoặc "assets/ten-abc123.js"
    for (const entry of Array.from(found)) {
      if (!/\.m?js$/.test(entry)) continue;
      try {
        const txt = await (await fetch(entry, { cache: 'reload' })).text();
        const re2 = /["'](?:\.\/|assets\/)([\w.-]+\.(?:js|css))["']/g;
        let k;
        while ((k = re2.exec(txt))) found.add(new URL(k[1], entry).href);
      } catch (e) { /* bỏ qua */ }
    }
    return Array.from(found);
  } catch (e) { return []; }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await addAll(APP_CACHE, CORE);
    await addAll(APP_CACHE, await discoverBuildAssets());
    // vendor đã có thì không tải lại
    const vc = await caches.open(VENDOR_CACHE);
    await Promise.all(VENDOR_CORE.map(async (u) => { if (!(await vc.match(u))) await vc.add(u).catch(() => {}); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // xóa bộ nhớ ứng dụng của các bản cũ + tên cũ kiểu "pdftool-v7"; giữ bộ nhớ vendor
    await Promise.all(keys.filter((k) => k !== APP_CACHE && k !== VENDOR_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(req), timeoutMs);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
    if (req.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
  if (req.headers.has('range')) return;                      // để trình duyệt tự xử lý

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {                 // CDN, dữ liệu OCR...
    event.respondWith(cacheFirst(req, VENDOR_CACHE));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;              // API luôn đi thẳng ra mạng
  if (req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname)) {
    event.respondWith(networkFirst(req, APP_CACHE, 4000));
    return;
  }
  if (isVendorLike(url.pathname)) {
    // file có hash / thư viện cố định: bộ nhớ vendor cho /vendor, bộ nhớ ứng dụng cho /assets
    event.respondWith(cacheFirst(req, /\/vendor\//.test(url.pathname) ? VENDOR_CACHE : APP_CACHE));
    return;
  }
  event.respondWith(networkFirst(req, APP_CACHE, 6000));     // legacy/*.js, css, manifest...
});
