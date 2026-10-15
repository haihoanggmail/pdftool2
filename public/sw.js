// Service worker cho PDF Tool (GitHub Pages).
// - Trang chính: ưu tiên mạng (luôn nhận bản mới sau khi bạn cập nhật), mất mạng thì dùng bản đã lưu.
// - Thư viện CDN, wasm, dữ liệu OCR...: lưu lại ở lần dùng đầu, các lần sau (và khi offline) lấy từ bộ nhớ.
// Khi sửa file này hoặc muốn ép mọi người tải lại toàn bộ, hãy tăng số phiên bản bên dưới.
const VERSION = 'pdftool-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './logo.png',
  './vendor/pdf-lib.min.js', './vendor/fontkit.umd.min.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !/^https?:/.test(req.url)) return;
  if (req.headers.has('range')) return; // để trình duyệt tự xử lý

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isPage = req.mode === 'navigate' || (sameOrigin && /\/(index\.html)?$/.test(url.pathname));

  if (isPage || sameOrigin) {  // cùng origin: ưu tiên mạng (file JS legacy không có hash)
    // Network-first
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first cho thư viện/CDN và các tài nguyên khác
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
