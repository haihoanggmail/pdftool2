// ===================== Chạy tác vụ PDF nặng trong Web Worker =====================
// PDFOps.run(op, payload, { transfer, title }) -> Promise<Uint8Array>
//  - chạy ngoài luồng giao diện (tab không đơ), có thanh tiến trình thật + đồng hồ + nút Hủy
//  - Hủy = tắt hẳn worker, trả lại toàn bộ bộ nhớ; Promise bị từ chối bằng PDFJob.cancelError()
//  - Nếu không dùng được Worker (trình duyệt cũ, tải script lỗi) thì lỗi có cờ workerUnavailable = true
//    để nơi gọi tự chạy lại trên luồng chính như trước.
(function (global) {
    'use strict';
    const Ops = { supported: typeof Worker !== 'undefined' };
    let seq = 0, styled = false;

    function addStyle() {
        if (styled) return; styled = true;
        const st = document.createElement('style');
        st.textContent =
            '.pops-card{position:fixed;right:16px;bottom:16px;z-index:100000;width:min(360px,calc(100vw - 32px));box-sizing:border-box;' +
            'background:var(--card-bg,#fff);color:var(--text-color,#1f2937);border:1px solid rgba(128,128,128,.4);border-radius:10px;' +
            'box-shadow:0 8px 28px rgba(0,0,0,.25);padding:12px 14px;font-size:13px}' +
            '.pops-title{font-weight:700;margin-bottom:8px}' +
            '.pops-bar{height:8px;border-radius:4px;background:rgba(128,128,128,.25);overflow:hidden}' +
            '.pops-fill{height:100%;width:0;background:var(--primary,#0078d4);transition:width .15s}' +
            '.pops-msg{margin-top:6px;opacity:.85;word-break:break-word}' +
            '.pops-row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px}' +
            '.pops-cancel{border:1px solid #dc2626;background:#dc2626;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px}' +
            '.pops-cancel:focus-visible{outline:2px solid #fff;outline-offset:2px;box-shadow:0 0 0 4px #dc2626}';
        document.head.appendChild(st);
    }

    function card(title, onCancel) {
        addStyle();
        const el = document.createElement('div');
        el.className = 'pops-card';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML =
            '<div class="pops-title"></div>' +
            '<div class="pops-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="pops-fill"></div></div>' +
            '<div class="pops-msg"></div>' +
            '<div class="pops-row"><span class="pops-time"></span><button type="button" class="pops-cancel" title="Dừng tác vụ và giải phóng bộ nhớ">⏹ Hủy</button></div>';
        el.querySelector('.pops-title').textContent = title;
        el.querySelector('.pops-cancel').addEventListener('click', onCancel);
        document.body.appendChild(el);
        const fill = el.querySelector('.pops-fill'), bar = el.querySelector('.pops-bar'),
            msg = el.querySelector('.pops-msg'), time = el.querySelector('.pops-time');
        const t0 = performance.now();
        const tm = setInterval(function () { time.textContent = 'Đã chạy ' + global.PDFJob.fmtTime(performance.now() - t0); }, 1000);
        return {
            update: function (pct, m) {
                const p = Math.max(0, Math.min(100, Math.round(pct)));
                fill.style.width = p + '%'; bar.setAttribute('aria-valuenow', String(p));
                if (m) msg.textContent = m + ' (' + p + '%)';
            },
            close: function () { clearInterval(tm); if (el.parentNode) el.parentNode.removeChild(el); }
        };
    }

    Ops.run = function (op, payload, opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
            const id = ++seq;
            let worker = null, started = false, ui = null;
            function cleanup() {
                if (ui) { ui.close(); ui = null; }
                if (worker) { try { worker.terminate(); } catch (e) { } worker = null; }
            }
            function cancel() {
                if (!worker) return;
                cleanup();
                reject(global.PDFJob.cancelError());
            }
            ui = card(opts.title || 'Đang xử lý...', cancel);
            try {
                worker = new Worker('legacy/pdf-ops.worker.js');
            } catch (e) {
                cleanup();
                const err = new Error('Không tạo được Web Worker'); err.workerUnavailable = true;
                reject(err); return;
            }
            worker.onmessage = function (ev) {
                const m = ev.data || {};
                if (m.id !== id) return;
                started = true;
                if (m.type === 'progress') { if (ui) ui.update(m.pct, m.msg); }
                else if (m.type === 'done') { cleanup(); resolve(new Uint8Array(m.bytes)); }
                else if (m.type === 'error') { cleanup(); reject(new Error(m.message)); }
            };
            worker.onerror = function (ev) {
                const notStarted = !started;
                cleanup();
                const err = new Error('Worker lỗi: ' + ((ev && ev.message) || 'không rõ'));
                err.workerUnavailable = notStarted;
                reject(err);
                if (ev && ev.preventDefault) ev.preventDefault();
            };
            worker.postMessage({ id: id, op: op, payload: payload }, opts.transfer || []);
        });
    };

    global.PDFOps = Ops;
})(window);
