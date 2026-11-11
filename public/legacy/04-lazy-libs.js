// ===================== Tải trễ thư viện/dữ liệu nặng =====================
// fonts-data.js (1,4 MB) và fontkit (0,75 MB) trước đây tải ngay khi mở trang dù nhiều người không dùng tới.
// Nay chỉ tải khi cần:
//   - PDFLazy.fonts() / PDFLazy.fontkit() : tải bất đồng bộ (gọi trước khi dùng, hoặc tự gọi khi chuyển sang tab cần font)
//   - Nếu mã cũ (đồng bộ) đọc window.EMBEDDED_ROBOTO / EMBEDDED_FONTS / fontkit khi chưa tải xong thì tự tải đồng bộ một lần
//     (hiếm khi xảy ra vì đã tải trước), nên không có đường nào bị thiếu dữ liệu.
(function (global) {
    'use strict';
    const FONTS_URL = 'legacy/fonts-data.js';
    const FONTKIT_URL = 'vendor/fontkit.umd.min.js';
    const promises = {};
    const done = {};

    function runText(text, url) {
        const s = document.createElement('script');
        s.text = text + '\n//# sourceURL=' + url;
        document.head.appendChild(s);
        document.head.removeChild(s);
    }

    function syncLoad(url) {
        if (done[url]) return;
        done[url] = true;                                  // đặt trước để không lặp vô hạn nếu lỗi
        const x = new XMLHttpRequest();
        x.open('GET', url, false);
        x.send(null);
        if (x.status >= 200 && x.status < 300) runText(x.responseText, url);
        else throw new Error('Không tải được ' + url + ' (HTTP ' + x.status + ')');
    }

    // Tải bất đồng bộ có timeout + thử lại (2 lần, chờ tăng dần) + thông báo khi thất bại hẳn.
    const TIMEOUT_MS = 30000, RETRIES = 2;
    function loadOnce(url) {
        return new Promise(function (res, rej) {
            const s = document.createElement('script');
            let timer = setTimeout(function () { cleanup(); rej(new Error('Hết thời gian tải ' + url)); }, TIMEOUT_MS);
            function cleanup() { clearTimeout(timer); s.onload = s.onerror = null; if (s.parentNode) s.parentNode.removeChild(s); }
            s.src = url;
            s.async = true;
            s.onload = function () { clearTimeout(timer); s.onload = s.onerror = null; res(); };
            s.onerror = function () { cleanup(); rej(new Error('Không tải được ' + url)); };
            document.head.appendChild(s);
        });
    }
    function notifyFail(url) {
        const msg = 'Không tải được thư viện cần thiết (' + url.replace(/^.*\//, '') + '). Kiểm tra mạng rồi thử lại.';
        try { if (global.toast) global.toast(msg, 'error', 6000); } catch (e) { }
    }
    function asyncLoad(url) {
        if (done[url]) return Promise.resolve();
        if (promises[url]) return promises[url];
        promises[url] = (async function () {
            let lastErr;
            for (let a = 0; a <= RETRIES; a++) {
                if (done[url]) return;                       // đã được nạp bằng đường khác trong lúc chờ
                try { await loadOnce(url); done[url] = true; return; }
                catch (e) { lastErr = e; if (a < RETRIES) await new Promise(function (r) { setTimeout(r, 800 * (a + 1)); }); }
            }
            delete promises[url];
            notifyFail(url);
            throw lastErr;
        })();
        return promises[url];
    }

    // Tạo thuộc tính toàn cục "tự tải khi đọc lần đầu"; script khi chạy sẽ gán giá trị qua setter
    function lazyGlobal(names, url) {
        const vals = {};
        names.forEach(function (n) {
            Object.defineProperty(global, n, {
                configurable: true,
                enumerable: true,
                get: function () {
                    if (!(n in vals)) {
                        try { syncLoad(url); } catch (e) { if (global.console) console.warn(e); }
                        if (!(n in vals)) vals[n] = undefined;       // tải lỗi: không thử lại liên tục
                    }
                    return vals[n];
                },
                set: function (v) { vals[n] = v; }
            });
        });
    }
    lazyGlobal(['EMBEDDED_ROBOTO', 'EMBEDDED_FONTS'], FONTS_URL);
    lazyGlobal(['fontkit'], FONTKIT_URL);

    global.PDFLazy = {
        fonts: function () { return asyncLoad(FONTS_URL); },
        fontkit: function () { return asyncLoad(FONTKIT_URL); },
        // tab nào cần font nhúng thì tải sẵn lúc chuyển tab (chạy ngầm, không chặn giao diện)
        prefetchForTab: function (tabId) {
            if (/^tab-(main|merge|compare|about|w2d|w2x)$/.test(tabId || '')) return;
            asyncLoad(FONTS_URL).catch(function () { });
            asyncLoad(FONTKIT_URL).catch(function () { });
        }
    };
    // Tải sẵn khi trình duyệt rảnh -> mã cũ đọc đồng bộ gần như luôn thấy dữ liệu đã có, không phải khóa giao diện.
    function idlePrefetch() {
        const run = function () { asyncLoad(FONTS_URL).catch(function () { }); asyncLoad(FONTKIT_URL).catch(function () { }); };
        if (global.requestIdleCallback) global.requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 3000);
    }
    if (typeof global.addEventListener === 'function') {
        if (document.readyState === 'complete') idlePrefetch(); else global.addEventListener('load', idlePrefetch);
    }
})(window);
