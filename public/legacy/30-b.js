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
            w2d_progress(record.getMessage())
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
            py.globals.set('w2d_progress', (s) => self.postMessage({ type: 'progress', msg: String(s) }));
            py.runPython(m.setup);
            self.postMessage({ type: 'loaded' });
        } else if (m.type === 'convert') {
            let out = null, note = '';
            try {
                py.FS.writeFile('/w2d_in.pdf', new Uint8Array(m.bytes));
                py.globals.get('w2d_convert')(JSON.stringify(m.opts));
                out = py.FS.readFile('/w2d_out.docx');
            } catch (e1) {
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
            self.postMessage({ type: 'done', id: m.id, bytes: copy.buffer, note: note }, [copy.buffer]);
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
                    (it.warn ? '<div style="font-size:11px; color:#b45309; margin-top:2px;">⚠ ' + esc(it.warn) + '</div>' : '') + '</div>';
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
                let chars = 0;
                for (let p = 1; p <= Math.min(3, pdf.numPages); p++) {
                    const pg = await pdf.getPage(p);
                    const tc = await pg.getTextContent();
                    tc.items.forEach(x => { chars += (x.str || '').trim().length; });
                    pg.cleanup();
                }
                if (!chars) {
                    it.warn = 'PDF này là bản scan (không có lớp chữ). Chữ sẽ ở dạng hình ảnh. Hãy chạy Chuyển đổi → OCR trước nếu muốn chữ có thể chỉnh sửa.';
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
            const fn = m => {
                if (m.type === 'progress') {
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
