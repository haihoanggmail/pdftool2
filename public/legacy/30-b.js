// ===================== Phân tích PDF trước/sau khi chuyển đổi (dùng chung cho Word + Excel) =====================
// - Phân loại TỪNG trang: chữ thật / bản scan / scan đã OCR / chữ vector / chữ loạn mã / font cũ / trống.
// - Tạo cảnh báo rõ ràng trước khi chuyển và báo cáo chất lượng sau khi chuyển.
(function () {
    const CLS = {
        text:     { label: 'Chữ thật',                        color: '#107c41', bg: '#e6f4ea' },
        scan:     { label: 'Bản scan (chỉ có ảnh)',           color: '#b45309', bg: '#fef3c7' },
        ocrlayer: { label: 'Scan đã có lớp chữ OCR ẩn',       color: '#b45309', bg: '#fef3c7' },
        vector:   { label: 'Hình / chữ dạng vector',          color: '#b45309', bg: '#fef3c7' },
        garbled:  { label: 'Chữ bị loạn mã',                  color: '#a80000', bg: '#fde8e8' },
        legacy:   { label: 'Nghi dùng font cũ (TCVN3/VNI)',   color: '#a80000', bg: '#fde8e8' },
        empty:    { label: 'Trang trống',                     color: '#605e5c', bg: '#f1f1f1' }
    };
    const ORDER = ['text', 'ocrlayer', 'scan', 'vector', 'garbled', 'legacy', 'empty'];
    // Ký tự chỉ có trong tiếng Việt Unicode chuẩn (không trùng bảng Latin-1 mà font cũ hay dùng)
    const VIET_STRONG = /[ăđơưĂĐƠƯ\u1EA0-\u1EF9]/g;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function ranges(nums) {
        const a = Array.from(new Set(nums)).sort((x, y) => x - y);
        const out = [];
        for (let i = 0; i < a.length;) {
            let j = i;
            while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
            out.push(j > i ? a[i] + '–' + a[j] : String(a[i]));
            i = j + 1;
        }
        const s = out.join(', ');
        return s.length > 70 ? s.slice(0, 67) + '…' : s;
    }

    // Đánh giá chất lượng lớp chữ của một trang (trả về null nếu quá ít chữ để kết luận)
    function classifyText(str) {
        const t = str.replace(/\s+/g, '');
        const n = t.length;
        if (n < 15) return null;
        const bad = (t.match(/[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
        if (bad / n > 0.15) return 'garbled';
        const viet = (t.match(VIET_STRONG) || []).length;
        const sym = (t.match(/[\u00A1-\u00BF\u00D0-\u00D7\u00F7-\u00FF]/g) || []).length;
        if (n >= 30 && viet === 0 && sym / n > 0.12) return 'legacy';
        let alnum = 0;
        try { alnum = (t.match(/[\p{L}\p{N}]/gu) || []).length; } catch (e) { alnum = n; }
        if (n >= 30 && alnum / n < 0.5) return 'garbled';
        return 'text';
    }

    // Duyệt danh sách lệnh vẽ của trang: tính phần diện tích lớn nhất bị ảnh phủ + có chữ ẩn (render mode 3) không
    async function pageObjects(page) {
        const OPS = pdfjsLib.OPS;
        const imgOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
            OPS.paintJpegXObject, OPS.paintImageXObjectRepeat].filter(x => x !== undefined));
        const view = page.view || [0, 0, 595, 842];
        const pageArea = Math.max(1, (view[2] - view[0]) * (view[3] - view[1]));
        const ol = await page.getOperatorList();
        let ctm = [1, 0, 0, 1, 0, 0];
        const stack = [];
        let img = 0, paths = 0, cover = 0, invisible = false;
        const mul = (m, n) => [
            m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
            m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
        ];
        for (let i = 0; i < ol.fnArray.length; i++) {
            const f = ol.fnArray[i];
            if (f === OPS.save) stack.push(ctm.slice());
            else if (f === OPS.restore) { if (stack.length) ctm = stack.pop(); }
            else if (f === OPS.transform) { const a = ol.argsArray[i]; if (a && a.length >= 6) ctm = mul(a, ctm); }
            else if (imgOps.has(f)) {
                img++;
                const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
                cover = Math.max(cover, Math.min(1, area / pageArea));
            }
            else if (f === OPS.constructPath) paths++;
            else if (f === OPS.setTextRenderingMode) { const a = ol.argsArray[i]; if (a && a[0] === 3) invisible = true; }
        }
        return { img, paths, cover, invisible };
    }

    async function analyze(pdf, opt) {
        opt = opt || {};
        const total = pdf.numPages;
        const t0 = performance.now();
        const pages = [];
        let sampled = false;
        for (let p = 1; p <= total; p++) {
            let cls = null, chars = 0, info = { img: 0, paths: 0, cover: 0, invisible: false };
            let page = null;
            try {
                page = await pdf.getPage(p);
                const tc = await page.getTextContent();
                const str = tc.items.map(x => x.str || '').join(' ');
                chars = str.replace(/\s+/g, '').length;
                const textCls = chars >= 15 ? classifyText(str) : null;
                const needOps = chars < 150 || p <= 40 || p % 5 === 0;
                const timeOk = performance.now() - t0 < 20000;
                if (needOps && timeOk) {
                    try { info = await pageObjects(page); } catch (e) { /* bỏ qua, dùng kết quả theo chữ */ }
                } else if (!needOps || !timeOk) sampled = true;
                if (info.cover >= 0.5 && info.invisible && chars >= 15) cls = 'ocrlayer';
                else if (info.cover >= 0.5 && chars < 150) cls = 'scan';
                else if (textCls && textCls !== 'text') cls = textCls;
                else if (chars >= 15) cls = 'text';
                else if (info.img > 0) cls = 'scan';
                else if (info.paths >= 30) cls = 'vector';
                else cls = 'empty';
            } catch (e) {
                cls = 'empty';
            } finally {
                try { if (page && page.cleanup) page.cleanup(); } catch (e) {}
            }
            pages.push({ n: p, cls: cls, chars: chars });
            if (p % 4 === 0) await new Promise(r => setTimeout(r, 0));   // nhường giao diện
            if (opt.onProgress) opt.onProgress(p, total);
        }
        const byCls = {};
        pages.forEach(pg => { (byCls[pg.cls] = byCls[pg.cls] || []).push(pg.n); });
        return { total: total, pages: pages, byCls: byCls, sampled: sampled };
    }

    // Nhận xét trước khi chuyển. kind: 'word' | 'excel'
    function verdict(a, kind) {
        const lines = [];
        let level = 'ok';
        const bump = l => { if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l; };
        const b = a.byCls, tot = a.total;
        const cnt = k => (b[k] || []).length;
        const where = k => 'trang ' + ranges(b[k]);
        const target = kind === 'excel' ? 'Excel' : 'Word';
        let needOcr = false;

        if (cnt('scan')) {
            needOcr = true;
            if (cnt('scan') === tot) { bump('bad'); lines.push('Toàn bộ ' + tot + ' trang là bản scan (không có chữ thật). ' + (kind === 'excel' ? 'Sẽ không dựng được bảng nào.' : 'Kết quả Word sẽ chỉ là hình.')); }
            else { bump('warn'); lines.push('Có ' + cnt('scan') + ' trang là bản scan (' + where('scan') + '): ' + (kind === 'excel' ? 'sẽ không có bảng/chữ cho các trang này.' : 'sẽ ra hình trong Word.')); }
        }
        if (cnt('ocrlayer')) {
            needOcr = true; bump('warn');
            lines.push(cnt('ocrlayer') + ' trang là bản scan đã OCR (' + where('ocrlayer') + '): chữ nằm ẩn dưới ảnh scan nên ' + target + ' vẫn có thể hiện ra hình/ảnh nền kèm chữ.');
        }
        if (cnt('vector')) {
            bump('warn');
            lines.push(cnt('vector') + ' trang (' + where('vector') + ') không có chữ thật, nhiều khả năng chữ đã bị chuyển thành đường vector (PDF in từ CAD/Canva/Illustrator) nên sẽ ra hình.');
        }
        if (cnt('garbled')) {
            bump('bad');
            lines.push(cnt('garbled') + ' trang (' + where('garbled') + ') có chữ bị loạn mã: sau khi chuyển, chữ có thể thành ký tự vô nghĩa.');
        }
        if (cnt('legacy')) {
            bump('bad');
            lines.push(cnt('legacy') + ' trang (' + where('legacy') + ') nghi dùng font tiếng Việt cũ (TCVN3/VNI): chữ có thể sai dấu sau khi chuyển.');
        }
        if (cnt('empty') && cnt('empty') < tot) lines.push(cnt('empty') + ' trang trống (' + where('empty') + ').');
        if (a.sampled) lines.push('File dài nên các trang sau chỉ được kiểm tra nhanh theo lớp chữ.');
        if (!lines.length || (level === 'ok')) {
            if (cnt('text') === tot) lines.unshift('Tất cả ' + tot + ' trang đều có chữ thật: chuyển sang ' + target + ' sẽ cho chữ chỉnh sửa được.');
        }
        return { level: level, lines: lines, needOcr: needOcr };
    }

    function chips(a) {
        return ORDER.filter(k => a.byCls[k]).map(k =>
            '<span style="display:inline-block; margin:2px 4px 0 0; padding:2px 8px; border-radius:10px; font-size:11px; background:' + CLS[k].bg + '; color:' + CLS[k].color + ';">' +
            esc(CLS[k].label) + ': ' + esc(ranges(a.byCls[k])) + '</span>').join('');
    }

    const LEVEL = {
        ok:   { color: '#107c41', bar: '#107c41', icon: '✔' },
        warn: { color: '#b45309', bar: '#f59e0b', icon: '⚠' },
        bad:  { color: '#a80000', bar: '#dc2626', icon: '✖' }
    };
    function block(title, level, lines, extraHtml) {
        const L = LEVEL[level] || LEVEL.ok;
        return '<div style="margin-top:6px; padding:6px 8px; border-left:3px solid ' + L.bar + '; background:rgba(127,127,127,.08); border-radius:4px; font-size:11px; line-height:1.45;">' +
            '<div style="font-weight:600; color:' + L.color + ';">' + L.icon + ' ' + esc(title) + '</div>' +
            (extraHtml || '') +
            lines.map(t => '<div style="margin-top:2px;">• ' + esc(t) + '</div>').join('') + '</div>';
    }

    // HTML hiển thị dưới mỗi file trong danh sách
    function rowHtml(it) {
        let h = '';
        if (it.analysis && it.pre) {
            const t = it.pre.level === 'ok' ? 'Kiểm tra trước khi chuyển: ổn' : (it.pre.level === 'warn' ? 'Kiểm tra trước khi chuyển: cần lưu ý' : 'Kiểm tra trước khi chuyển: có vấn đề');
            h += block(t, it.pre.level, it.pre.lines, '<div>' + chips(it.analysis) + '</div>');
        }
        if (it.report) {
            const t = it.report.level === 'ok' ? 'Báo cáo chất lượng: tốt' : (it.report.level === 'warn' ? 'Báo cáo chất lượng: cần kiểm tra' : 'Báo cáo chất lượng: có vấn đề');
            h += block(t, it.report.level, it.report.lines);
        }
        return h;
    }

    window.PdfConvertAnalysis = { analyze: analyze, verdict: verdict, rowHtml: rowHtml, ranges: ranges, CLS: CLS, block: block };
})();

// ===================== PDF → Word (pdf2docx + PyMuPDF chạy bằng WebAssembly, trong Web Worker) =====================
(function () {
    const PY_SETUP = `
import pymupdf, json, logging, re
from pdf2docx import Converter
from pdf2docx.image.ImagesExtractor import ImagesExtractor

if not hasattr(ImagesExtractor, '_w2d_orig'):
    ImagesExtractor._w2d_orig = ImagesExtractor._to_raw_dict
    def _w2d_patched(image, bbox):
        pix = image
        need = False
        try:
            if hasattr(pix, 'colorspace') and pix.colorspace:
                n = (pix.colorspace.name or '').upper()
                if 'CMYK' in n: need = True
                elif n not in ('DEVICEGRAY', 'GRAY', 'DEVICERGB', 'RGB', 'SRGB', ''): need = True
            if not need and hasattr(pix, 'n') and hasattr(pix, 'alpha'):
                if (pix.n == 4 and not pix.alpha) or pix.n > 4: need = True
            if need:
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        except Exception:
            pix = image
        return ImagesExtractor._w2d_orig(pix, bbox)
    ImagesExtractor._to_raw_dict = staticmethod(_w2d_patched)

class _W2DHandler(logging.Handler):
    def emit(self, record):
        try:
            w2d_progress(record.getMessage(), record.levelno)
        except Exception:
            pass
_h = _W2DHandler()
_h.setLevel(logging.INFO)
logging.getLogger().addHandler(_h)
logging.getLogger().setLevel(logging.INFO)

def w2d_convert(opts_json):
    opts = json.loads(opts_json)
    cv = Converter("/w2d_in.pdf")
    try:
        cv.convert("/w2d_out.docx", pages=opts.get("pages"), **opts["settings"])
    finally:
        cv.close()
        try:
            import gc
            gc.collect()
        except Exception:
            pass
`;
    const WORKER_SRC = `
let inst = null, py = null;
self.onmessage = async (ev) => {
    const m = ev.data;
    try {
        if (m.type === 'load') {
            const mod = await import(m.base + 'dist/index.js');
            inst = new mod.PyMuPDF({ assetPath: m.base + 'assets/', ghostscriptUrl: '' });
            self.postMessage({ type: 'status', msg: 'Đang khởi động bộ chuyển đổi...' });
            await inst.load();
            py = await inst.getPyodide();
            py.globals.set('w2d_progress', (s, lvl) => self.postMessage({ type: 'progress', msg: String(s), level: Number(lvl) || 0 }));
            py.runPython(m.setup);
            self.postMessage({ type: 'loaded' });
        } else if (m.type === 'convert') {
            let out = null, note = '', fallback = false, reason = '';
            try {
                py.FS.writeFile('/w2d_in.pdf', new Uint8Array(m.bytes));
                py.globals.get('w2d_convert')(JSON.stringify(m.opts));
                out = py.FS.readFile('/w2d_out.docx');
            } catch (e1) {
                fallback = true;
                const ls = String((e1 && e1.message) || e1).split(String.fromCharCode(10)).map(x => x.trim()).filter(Boolean);
                reason = (ls[ls.length - 1] || '').slice(0, 240);
                self.postMessage({ type: 'status', msg: 'Thử lại bằng chế độ dự phòng...' });
                const blob = new Blob([m.bytes], { type: 'application/pdf' });
                const b = await inst.pdfToDocx(blob);
                out = new Uint8Array(await b.arrayBuffer());
                note = 'Dùng chế độ dự phòng (tùy chọn bảng không áp dụng).';
            } finally {
                try { py.FS.unlink('/w2d_in.pdf'); } catch (e) {}
                try { py.FS.unlink('/w2d_out.docx'); } catch (e) {}
            }
            const copy = new Uint8Array(out);
            self.postMessage({ type: 'done', id: m.id, bytes: copy.buffer, note: note, fallback: fallback, reason: reason }, [copy.buffer]);
        }
    } catch (e) {
        self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
    }
};`;

    let worker = null, loadPromise = null, loadedBase = '';
    let listeners = new Set();
    let items = []; // {id, file, pages, status, text, blob, name, note}
    let seq = 0, busy = false;
    let cancelled = false, activeReject = null, tickTimer = null, progressBase = '';
    const IDLE_MS = 3 * 60 * 1000;                 // sau 3 phút không dùng: giải phóng bộ chuyển đổi (vài trăm MB RAM)
    const BIG_BYTES = 40 * 1048576;                // file >= 40 MB: giải phóng ngay sau khi xong

    const $ = id => document.getElementById(id);
    const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function setProgress(pct, msg) {
        $('w2d-progress-wrap').style.display = 'block';
        if (pct !== null && pct !== undefined) $('w2d-progress-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (msg !== undefined) { progressBase = msg; $('w2d-status').textContent = msg; }
    }

    // Đồng hồ thời gian đã chạy: cho người dùng thấy tác vụ vẫn đang làm việc (kể cả khi file lớn, ít thông báo)
    function startTicker() {
        stopTicker();
        const t0 = performance.now();
        tickTimer = setInterval(() => {
            const el = $('w2d-status');
            if (!el || !busy) return;
            el.setAttribute('data-elapsed', PDFJob.fmtTime(performance.now() - t0));
            el.textContent = (progressBase ? progressBase + ' • ' : '') + 'đã chạy ' + PDFJob.fmtTime(performance.now() - t0);
        }, 1000);
    }
    function stopTicker() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

    // Giải phóng bộ chuyển đổi (WebAssembly chiếm vài trăm MB RAM và không tự co lại): tắt hẳn tiến trình nền
    function releaseEngine() {
        if (worker) { try { worker.terminate(); } catch (e) {} }
        worker = null; loadPromise = null; loadedBase = '';
        listeners.clear();
    }
    const idleRelease = PDFJob.idle(() => { if (!busy) releaseEngine(); }, IDLE_MS);

    function cancelRun() {
        if (!busy || cancelled) return;
        cancelled = true;
        stopTicker();
        setProgress(null, 'Đang hủy...');
        releaseEngine();
        if (activeReject) { const r = activeReject; activeReject = null; r(PDFJob.cancelError()); }
    }

    function ensureEngine() {
        let base = ($('w2d-base').value || '').trim();
        if (!base) base = 'https://cdn.jsdelivr.net/npm/@bentopdf/pymupdf-wasm@0.11.16/';
        if (!base.endsWith('/')) base += '/';
        if (loadPromise && loadedBase === base) return loadPromise;
        if (worker) { try { worker.terminate(); } catch (e) {} }
        loadedBase = base;
        const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
        worker = new Worker(url);
        setTimeout(() => URL.revokeObjectURL(url), 10000);      // đã nạp xong mã worker, trả URL lại cho trình duyệt
        worker.onmessage = ev => listeners.forEach(fn => fn(ev.data));
        loadPromise = new Promise((resolve, reject) => {
            const fn = m => {
                if (m.type === 'status') setProgress(null, m.msg);
                else if (m.type === 'loaded') { listeners.delete(fn); resolve(); }
                else if (m.type === 'error' && m.id === undefined) { listeners.delete(fn); reject(new Error(m.message)); }
            };
            listeners.add(fn);
            worker.onerror = e => { listeners.delete(fn); reject(new Error(e.message || 'Không khởi động được bộ chuyển đổi')); };
            worker.postMessage({ type: 'load', base: base, setup: PY_SETUP });
        });
        loadPromise.catch(() => { loadPromise = null; });
        return loadPromise;
    }

    function parsePages(str, total) {
        str = (str || '').trim();
        if (!str) return null;
        const set = new Set();
        str.split(',').forEach(part => {
            part = part.trim();
            if (!part) return;
            const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) {
                let a = +m[1], b = +m[2];
                if (a > b) { const t = a; a = b; b = t; }
                for (let i = a; i <= b; i++) if (i >= 1 && (!total || i <= total)) set.add(i - 1);
            } else if (/^\d+$/.test(part)) {
                const n = +part;
                if (n >= 1 && (!total || n <= total)) set.add(n - 1);
            }
        });
        return Array.from(set).sort((a, b) => a - b);
    }

    function render() {
        const list = $('w2d-list');
        window.__hvItems_w2d = items;
        if (!items.length) {
            list.innerHTML = '<div style="color:gray; font-style:italic; text-align:center; padding-top:40px;">Chưa chọn file nào. Kéo thả PDF vào đây hoặc bấm "Chọn file PDF".</div>';
        } else {
            list.innerHTML = '';
            items.forEach(it => {
                const row = document.createElement('div');
                row.style.cssText = 'background:#fff; border:1px solid #d2d0ce; border-radius:6px; padding:10px; display:flex; align-items:center; gap:10px;';
                const colors = { wait: '#605e5c', run: '#005a9e', ok: '#107c41', err: '#a80000' };
                row.innerHTML = '<div style="flex:1; min-width:0;"><div style="font-weight:600; font-size:13px; word-break:break-all;">' + esc(it.file.name) + '</div>' +
                    '<div style="font-size:11px; color:#605e5c;">' + fmtBytes(it.file.size) + (it.numPages ? ' • ' + it.numPages + ' trang' : '') + '</div>' +
                    '<div style="font-size:12px; margin-top:3px; color:' + colors[it.status] + ';">' + esc(it.text || '') + '</div>' +
                    (it.warn ? '<div style="font-size:11px; color:#b45309; margin-top:2px;">⚠ ' + esc(it.warn) + '</div>' : '') + (window.PdfConvertAnalysis ? window.PdfConvertAnalysis.rowHtml(it) : '') + '</div>';
                const act = document.createElement('div');
                act.style.cssText = 'display:flex; gap:6px; flex-shrink:0;';
                if (it.blob) {
                    const b = document.createElement('button');
                    b.className = 'btn btn-small btn-success';
                    b.textContent = '⬇ Tải .docx';
                    b.onclick = () => w2dDownload(it);
                    act.appendChild(b);
                }
                if (!busy) {
                    const d = document.createElement('button');
                    d.className = 'btn btn-small btn-danger';
                    d.textContent = '✕';
                    d.title = 'Bỏ file này';
                    d.onclick = () => { items = items.filter(x => x !== it); render(); };
                    act.appendChild(d);
                }
                row.appendChild(act);
                list.appendChild(row);
            });
        }
        const anyOk = items.some(i => i.blob);
        $('w2d-run-btn').disabled = busy || !items.length;
        const cb = $('w2d-cancel-btn'); if (cb) cb.style.display = busy ? 'inline-flex' : 'none';
        $('w2d-zip-btn').style.display = items.filter(i => i.blob).length > 1 ? 'flex' : 'none';
        $('w2d-clear-btn').style.display = items.length && !busy ? 'flex' : 'none';
    }

    function w2dDownload(it) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(it.blob);
        a.download = it.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }

    async function addFiles(fileList) {
        const files = Array.from(fileList || []).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
        for (const f of files) {
            const it = { id: ++seq, file: f, status: 'wait', text: 'Chờ chuyển đổi' };
            items.push(it);
            let pdf = null;
            try {
                // một bản sao duy nhất cho pdf.js; đọc xong là đóng tài liệu để trả bộ nhớ
                pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
                it.numPages = pdf.numPages;
                if (f.size >= BIG_BYTES || pdf.numPages > 150) {
                    it.big = true;
                    it.bigNote = 'File lớn (' + fmtBytes(f.size) + ', ' + pdf.numPages + ' trang): có thể mất vài phút. Nên nhập khoảng trang (ví dụ 1-50) để chuyển từng phần; bấm Hủy bất cứ lúc nào.';
                }
                it.text = 'Đang kiểm tra các trang...'; render();
                it.analysis = await window.PdfConvertAnalysis.analyze(pdf, {
                    onProgress: (p, n) => { if (p % 10 === 0) { it.text = 'Đang kiểm tra trang ' + p + '/' + n + '...'; render(); } }
                });
                it.pre = window.PdfConvertAnalysis.verdict(it.analysis, 'word');
                it.text = 'Chờ chuyển đổi';
                if (it.pre.needOcr) {
                    const ocrHint = $('w2d-ocr-hint');
                    if (ocrHint) ocrHint.style.display = 'block';
                }
            } catch (e) {
                it.warn = 'Không đọc được thông tin file (có thể bị đặt mật khẩu).';
            } finally {
                if (pdf) { try { await pdf.destroy(); } catch (e) {} }
            }
            if (it.big && !it.warn) it.warn = it.bigNote;
            render();
        }
    }

    function convertOne(it) {
        return new Promise((resolve, reject) => {
            it._logs = [];
            const fn = m => {
                if (m.type === 'progress') {
                    if (typeof m.level === 'number' && m.level >= 30 && it._logs.length < 30 && it._logs.indexOf(m.msg) < 0) it._logs.push(String(m.msg));
                    const mm = /\((\d+)\/(\d+)\)/.exec(m.msg);
                    if (mm) {
                        const pct = (+mm[1] - 1 + (/Page/i.test(m.msg) ? 0.5 : 0)) / +mm[2] * 100;
                        setProgress(pct, it.file.name + ': ' + m.msg.replace(/^\s+/, ''));
                    }
                } else if (m.type === 'status') setProgress(null, m.msg);
                else if (m.type === 'done' && m.id === it.id) { listeners.delete(fn); resolve(m); }
                else if (m.type === 'error' && m.id === it.id) { listeners.delete(fn); reject(new Error(m.message)); }
            };
            listeners.add(fn);
            it.file.arrayBuffer().then(buf => {
                if (!worker) { listeners.delete(fn); reject(PDFJob.cancelError()); return; }
                const pages = parsePages($('w2d-pages').value, it.numPages);
                if (pages && !pages.length) { listeners.delete(fn); reject(new Error('Khoảng trang không hợp lệ.')); return; }
                // "Chế độ ưu tiên chuyển đổi": layout = bám sát bố cục gốc, flow = đoạn văn liền mạch, dễ gõ tiếp
                const mode = $('w2d-mode') ? $('w2d-mode').value : 'layout';
                const settings = {
                    parse_lattice_table: $('w2d-lattice') ? $('w2d-lattice').checked : true,
                    parse_stream_table: $('w2d-stream') ? $('w2d-stream').checked : true,
                    delete_end_line_hyphen: $('w2d-hyphen') ? $('w2d-hyphen').checked : true,
                    ignore_page_error: true,
                    multi_processing: false,
                    clip_image_res_ratio: 4.0                       // ảnh/hình vector cắt ra nét hơn (mặc định 3)
                };
                if (mode === 'flow') {
                    settings.line_break_free_space_ratio = 0.3;     // coi các dòng ngắt tự nhiên là cùng một đoạn
                    settings.new_paragraph_free_space_ratio = 0.85;
                }
                const opts = { pages: pages, settings: settings };
                worker.postMessage({ type: 'convert', id: it.id, bytes: buf, opts: opts }, [buf]);
            }).catch(e => { listeners.delete(fn); reject(e); });
        });
    }

    // ---------- Báo cáo chất lượng sau khi chuyển ----------
    async function ensureJSZip() {
        if (typeof JSZip !== 'undefined') return true;
        await new Promise((res, rej) => {
            const sc = document.createElement('script');
            sc.src = 'vendor/jszip.min.js';
            sc.onload = res; sc.onerror = () => rej(new Error('Không tải được thư viện JSZip'));
            document.head.appendChild(sc);
        });
        return typeof JSZip !== 'undefined';
    }

    async function inspectDocx(u8) {
        const zip = await JSZip.loadAsync(u8);
        const f = zip.file('word/document.xml');
        if (!f) return null;
        const xml = await f.async('string');
        let textChars = 0;
        xml.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, (m, t) => { textChars += t.replace(/\s+/g, '').length; return m; });
        return {
            textChars: textChars,
            tables: (xml.match(/<w:tbl>/g) || []).length,
            paragraphs: (xml.match(/<w:p[\s>]/g) || []).length,
            drawings: (xml.match(/<w:drawing>/g) || []).length + (xml.match(/<w:pict>/g) || []).length,
            media: Object.keys(zip.files).filter(n => /^word\/media\//i.test(n) && !zip.files[n].dir).length
        };
    }

    async function buildWordReport(it, u8, res) {
        const A = window.PdfConvertAnalysis;
        const lines = [];
        let level = 'ok';
        const bump = l => { if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l; };
        const selArr = parsePages($('w2d-pages').value, it.numPages);
        const sel = selArr ? new Set(selArr) : null;
        const pgs = it.analysis ? it.analysis.pages.filter(p => !sel || sel.has(p.n - 1)) : [];
        const nPages = pgs.length || it.numPages || 1;

        let st = null;
        try { if (await ensureJSZip()) st = await inspectDocx(u8); } catch (e) { st = null; }
        if (st) {
            lines.push('Trong file Word: ' + st.textChars.toLocaleString('vi-VN') + ' ký tự chữ • ' + st.tables + ' bảng • ' + st.paragraphs + ' đoạn • ' + st.media + ' ảnh.');
        }

        if (res.fallback) {
            bump('warn');
            lines.push('Bộ chuyển đổi chính gặp lỗi nên đã chuyển sang chế độ dự phòng (chất lượng thấp hơn, bỏ qua tùy chọn bảng).' + (res.reason ? ' Lý do: ' + res.reason : ''));
        }
        const logs = it._logs || [];
        if (logs.length) {
            const ignored = logs.filter(m => /ignore page/i.test(m));
            bump(ignored.length ? 'bad' : 'warn');
            if (ignored.length) lines.push('Bộ chuyển đổi đã BỎ QUA ' + ignored.length + ' trang do lỗi, các trang này sẽ thiếu hoặc trống trong file Word.');
            logs.slice(0, 5).forEach(m => lines.push('Bộ chuyển đổi báo: ' + (m.length > 160 ? m.slice(0, 157) + '…' : m)));
            if (logs.length > 5) lines.push('(và ' + (logs.length - 5) + ' cảnh báo khác)');
        }

        const byC = {};
        pgs.forEach(p => { (byC[p.cls] = byC[p.cls] || []).push(p.n); });
        if (byC.scan) { bump('warn'); lines.push('Trang ' + A.ranges(byC.scan) + ' là bản scan nên chỉ là hình trong Word (chữ không chỉnh sửa được).'); }
        if (byC.ocrlayer) { bump('warn'); lines.push('Trang ' + A.ranges(byC.ocrlayer) + ' là bản scan đã OCR: ảnh scan vẫn làm nền, chữ OCR nằm vô hình bên dưới nên Word có thể hiện hình kèm chữ lệch.'); }
        if (byC.vector) { bump('warn'); lines.push('Trang ' + A.ranges(byC.vector) + ' không có chữ thật (chữ dạng vector) nên ra hình.'); }
        if (byC.garbled || byC.legacy) { bump('bad'); lines.push('Trang ' + A.ranges([].concat(byC.garbled || [], byC.legacy || [])) + ' có chữ loạn mã hoặc font cũ: hãy kiểm tra kỹ nội dung chữ trong Word.'); }

        if (st) {
            const expected = pgs.filter(p => p.cls === 'text').reduce((n, p) => n + p.chars, 0);
            if (expected >= 200) {
                const r = st.textChars / expected;
                if (r < 0.6) { bump('bad'); lines.push('Chỉ giữ lại khoảng ' + Math.round(r * 100) + '% lượng chữ so với PDF gốc: có thể mất chữ hoặc chữ đã bị chuyển thành hình (so sánh gần đúng).'); }
                else if (r < 0.85) { bump('warn'); lines.push('Giữ lại khoảng ' + Math.round(r * 100) + '% lượng chữ so với PDF gốc, nên đối chiếu lại các đoạn quan trọng (so sánh gần đúng).'); }
            }
            if ((st.drawings > 0 || st.media > 0) && st.textChars < 30 * nPages) {
                bump('bad');
                lines.push('File Word gần như chỉ chứa hình, hầu như không có chữ chỉnh sửa được.');
            }
        }
        if (level === 'ok') lines.push('Chữ được giữ ở dạng chỉnh sửa được. Vẫn nên mở file kiểm tra bố cục các trang có bảng.');
        else if ((byC.scan || byC.ocrlayer) ) lines.push('Gợi ý: với bản scan, chữ chỉ chỉnh sửa được nếu dựng lại từ kết quả OCR; hiện tool chưa tách được chữ khỏi ảnh nền.');
        return { level: level, lines: lines, stats: st };
    }

    async function run() {
        if (busy || !items.length) return;
        busy = true; cancelled = false;
        idleRelease.disarm();
        render();
        let ok = 0, bigSeen = false;
        const gate = new Promise((_, rej) => { activeReject = rej; });
        gate.catch(() => {});
        startTicker();
        try {
            setProgress(0, 'Đang tải bộ chuyển đổi (lần đầu ~55 MB, các lần sau nhanh hơn)...');
            await Promise.race([ensureEngine(), gate]);
            for (let i = 0; i < items.length; i++) {
                if (cancelled) break;
                const it = items[i];
                if (it.blob) continue;
                if (it.big) bigSeen = true;
                it.status = 'run'; it.text = 'Đang chuyển đổi...';
                render();
                const t0 = performance.now();
                setProgress(0, 'Đang chuyển ' + it.file.name + ' (' + (i + 1) + '/' + items.length + ')...');
                try {
                    const res = await Promise.race([convertOne(it), gate]);
                    let u8 = new Uint8Array(res.bytes);
                    if (u8.length < 2048 || u8[0] !== 0x50 || u8[1] !== 0x4B) {
                        throw new Error('Kết quả chuyển đổi không phải tệp DOCX hợp lệ hoặc bị rỗng (' + u8.length + ' bytes).');
                    }
                    // Chuẩn hóa font (bỏ tiền tố ABCDEF+, đổi tên PostScript -> tên Word, bổ sung đậm/nghiêng, font thay thế)
                    let fontNote = '';
                    try { const fixed = await PDFFonts.fixDocx(u8); if (fixed && fixed !== u8) { u8 = fixed; fontNote = ' • Đã chuẩn hóa font'; } } catch (e) {}
                    it.blob = new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
                    it.name = it.file.name.replace(/\.pdf$/i, '') + '.docx';
                    const duration = ((performance.now() - t0) / 1000).toFixed(1);
                    try { it.report = await buildWordReport(it, u8, res); } catch (e) { console.warn('Không tạo được báo cáo chất lượng:', e); it.report = null; }
                    it.status = 'ok';
                    it.text = 'Hoàn tất • ' + fmtBytes(it.blob.size) + ' • ' + duration + 's • Đã xác thực DOCX' + fontNote + (res.note ? ' • ' + res.note : '');
                    ok++;
                    if (typeof logAction === 'function') logAction('pdf_to_word');
                    if (items.length === 1) w2dDownload(it);
                } catch (e) {
                    if (cancelled || PDFJob.isCancel(e)) { it.status = 'wait'; it.text = 'Đã hủy — bấm Chuyển đổi để chạy lại'; break; }
                    it.status = 'err'; it.text = 'Lỗi: ' + (e.message || e);
                }
                render();
            }
            if (cancelled) setProgress(0, 'Đã hủy. Bộ nhớ đã được giải phóng.');
            else setProgress(100, ok ? 'Hoàn tất: đã chuyển ' + ok + ' file.' : 'Không chuyển được file nào.');
        } catch (e) {
            if (cancelled || PDFJob.isCancel(e)) {
                setProgress(0, 'Đã hủy. Bộ nhớ đã được giải phóng.');
            } else {
                setProgress(0, 'Không tải được bộ chuyển đổi: ' + (e.message || e) + '. Kiểm tra kết nối mạng hoặc địa chỉ nguồn ở mục Nâng cao.');
            }
            items.forEach(it => { if (it.status === 'run') { it.status = cancelled ? 'wait' : 'err'; it.text = cancelled ? 'Đã hủy — bấm Chuyển đổi để chạy lại' : 'Chưa chuyển được'; } });
        } finally {
            stopTicker();
            activeReject = null;
            busy = false;
            // file lớn hoặc đã hủy: trả lại RAM ngay; còn lại giữ tạm để lần sau chạy nhanh rồi tự giải phóng khi rảnh
            if (cancelled || bigSeen) releaseEngine(); else idleRelease.arm();
            render();
        }
    }

    async function zipAll() {
        const done = items.filter(i => i.blob);
        if (!done.length) return;
        if (typeof JSZip === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'vendor/jszip.min.js';
                s.onload = res; s.onerror = () => rej(new Error('Không tải được thư viện nén ZIP'));
                document.head.appendChild(s);
            }).catch(e => { alert(e.message); });
        }
        if (typeof JSZip === 'undefined') return;
        const zip = new JSZip(), used = {};
        for (const it of done) {
            let n = it.name; if (used[n]) { used[n]++; n = n.replace(/\.docx$/, '') + ' (' + used[n] + ').docx'; } else used[n] = 1;
            zip.file(n, it.blob);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        w2dDownload({ blob: blob, name: 'pdf-to-word.zip' });
    }

    function init() {
        const inp = $('w2d-input');
        if (!inp) return;
        inp.addEventListener('change', () => { addFiles(inp.files); inp.value = ''; });
        $('w2d-run-btn').addEventListener('click', run);
        if ($('w2d-cancel-btn')) $('w2d-cancel-btn').addEventListener('click', cancelRun);
        $('w2d-zip-btn').addEventListener('click', zipAll);
        $('w2d-clear-btn').addEventListener('click', () => { items = []; idleRelease.arm(); $('w2d-progress-wrap').style.display = 'none'; if ($('w2d-ocr-hint')) $('w2d-ocr-hint').style.display = 'none'; render(); });
        const drop = $('w2d-drop');
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.outline = '2px dashed var(--primary)'; });
        drop.addEventListener('dragleave', () => { drop.style.outline = ''; });
        drop.addEventListener('drop', e => { e.preventDefault(); drop.style.outline = ''; addFiles(e.dataTransfer.files); });
        render();
    }
    window.w2dDownload = w2dDownload;
    window._w2d = { get items() { return items; }, run: run, addFiles: addFiles, ensureEngine: ensureEngine };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
