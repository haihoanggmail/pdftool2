// ===================== Công cụ PDF (tách, nén, ảnh, OCR, mật khẩu, watermark, số trang, mục lục, metadata) =====================
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    const P = () => window.PDFLib;

    const INFO = {
        split: { hint: 'Tách một file PDF thành nhiều file nhỏ theo khoảng trang, theo số trang hoặc từng trang.', accept: 'pdf' },
        margin: { hint: 'Canh chỉnh lề trái, phải, trên, dưới (chuẩn NĐ 30/2020 văn bản hành chính, đóng gáy sách in 2 mặt, luận văn hoặc tùy chỉnh).', accept: 'pdf' },
        blank: { hint: 'Tự động tìm và xóa các trang trắng (trang trống, trang chỉ có nhiễu scan) khỏi file PDF.', accept: 'pdf' },
        compress: { hint: 'Giảm dung lượng PDF bằng cách nén lại ảnh bên trong và lưu gọn cấu trúc file.', accept: 'pdf' },
        pdf2img: { hint: 'Xuất từng trang PDF thành ảnh PNG hoặc JPG.', accept: 'pdf' },
        img2pdf: { hint: 'Ghép nhiều ảnh (JPG, PNG, WebP...) thành một file PDF.', accept: 'img' },
        ocr: { hint: 'Nhận dạng chữ trên PDF scan, tạo PDF chọn / tìm / copy chữ được. Chạy hoàn toàn trên máy.', accept: 'pdf' },
        protect: { hint: 'Đặt mật khẩu mở file, giới hạn quyền in, copy, sửa; hoặc gỡ mật khẩu nếu bạn biết mật khẩu.', accept: 'pdf' },
        meta: { hint: 'Xóa hoặc sửa thông tin ẩn trong file: tác giả, phần mềm tạo, ngày tạo...', accept: 'pdf' },
        watermark: { hint: 'Chèn chữ hoặc ảnh mờ lên các trang (một chỗ hoặc lặp kín trang).', accept: 'pdf' },
        pagenum: { hint: 'Thêm số trang vào chân hoặc đầu mỗi trang.', accept: 'pdf' },
        bookmark: { hint: 'Tạo mục lục dạng bookmark (dùng ngăn điều hướng của trình đọc PDF), có thể nhiều cấp.', accept: 'pdf' }
    };

    let tool = 'split';
    const lists = { pdf: [], img: [] };
    let seq = 0, busy = false;
    const curList = () => lists[INFO[tool].accept === 'img' ? 'img' : 'pdf'];

    // ---------- Tiện ích ----------
    function loadScript(urls, errMsg) {
        return new Promise((resolve, reject) => {
            let i = 0;
            const next = () => {
                if (i >= urls.length) { reject(new Error(errMsg || 'Không tải được thư viện (cần kết nối mạng)')); return; }
                const s = document.createElement('script');
                s.src = urls[i++];
                s.onload = resolve;
                s.onerror = () => { s.remove(); next(); };
                document.head.appendChild(s);
            };
            next();
        });
    }
    async function ensureJSZip() {
        if (typeof JSZip !== 'undefined') return;
        await loadScript(['vendor/jszip.min.js', 'vendor/jszip.min.js'], 'Không tải được thư viện nén ZIP');
    }
    function parsePages(str, total) {
        str = (str || '').trim();
        if (!str) return null;
        const set = new Set();
        str.split(/[,;]/).forEach(part => {
            part = part.trim();
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
    const baseName = n => n.replace(/\.[^.]+$/, '');
    const pad = (i, n) => String(i).padStart(String(n).length, '0');
    function saveBlob(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    const toBlob = (d, name) => d instanceof Blob ? d : new Blob([d], { type: /\.pdf$/i.test(name) ? 'application/pdf' : /\.txt$/i.test(name) ? 'text/plain;charset=utf-8' : 'application/octet-stream' });
    function hexRgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        const v = m ? parseInt(m[1], 16) : 0;
        return P().rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
    }
    function setProgress(pct, msg) {
        $('tl-progress-wrap').style.display = 'block';
        if (pct !== null && pct !== undefined) $('tl-progress-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (msg !== undefined) $('tl-status').textContent = msg;
    }
    function toBytes(it) { return new Uint8Array(it.bytes.slice(0)); }
    async function loadLib(it, extra) {
        try {
            return await P().PDFDocument.load(toBytes(it), Object.assign({ updateMetadata: false }, extra || {}));
        } catch (e) {
            if (/encrypt/i.test(e && e.message)) throw new Error('File đang được mã hóa hoặc có hạn chế quyền. Hãy dùng "Đặt / gỡ mật khẩu" → Gỡ mật khẩu trước.');
            throw new Error('Không đọc được file PDF (' + ((e && e.message) || e) + ')');
        }
    }
    async function openPdfJs(it) {
        return await pdfjsLib.getDocument({ data: toBytes(it) }).promise;
    }
    const canvasBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
    async function getFontLib(pdf, bold) {
        pdf.registerFontkit(window.fontkit);
        const bytes = await getUnicodeFontBytes(bold ? 'bold' : 'regular');
        return await pdf.embedFont(bytes, { subset: true });
    }
    function safeText(font, s) {
        let set = null;
        try { set = new Set(font.getCharacterSet()); } catch (e) {}
        if (!set) return s;
        let out = '';
        for (const ch of s) { const cp = ch.codePointAt(0); if (cp === 32 || set.has(cp)) out += ch; }
        return out;
    }
    // Vẽ chữ tại toạ độ "hiển thị" (X từ trái, Y từ dưới của trang đã xoay), góc th (độ, ngược chiều kim đồng hồ)
    function pageGeo(page) {
        const mb = page.getMediaBox();
        const R = ((page.getRotation().angle % 360) + 360) % 360;
        const Wu = mb.width, Hu = mb.height;
        const swap = R === 90 || R === 270;
        return { mb, R, Wu, Hu, W: swap ? Hu : Wu, H: swap ? Wu : Hu };
    }
    function toUser(g, X, Y, th) {
        let x, y;
        if (g.R === 0) { x = X; y = Y; }
        else if (g.R === 90) { x = g.Wu - Y; y = X; }
        else if (g.R === 180) { x = g.Wu - X; y = g.Hu - Y; }
        else { x = Y; y = g.Hu - X; }
        return { x: x + g.mb.x, y: y + g.mb.y, ang: th + g.R };
    }
    const rotv = (a, b, deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [a * c - b * s, a * s + b * c]; };

    // ---------- Engine PyMuPDF (chỉ dùng cho mật khẩu) ----------
    const PY_PW = `
import pymupdf, json
def pw_apply(opts_json):
    o = json.loads(opts_json)
    doc = pymupdf.open('/pw_in.pdf')
    try:
        if doc.needs_pass:
            if not doc.authenticate(o.get('pw') or ''):
                return json.dumps({'ok': False, 'err': 'badpw'})
        if o['mode'] == 'remove':
            doc.save('/pw_out.pdf', encryption=pymupdf.PDF_ENCRYPT_NONE, garbage=3, deflate=True)
        else:
            perm = 0
            if o.get('print'): perm |= pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ
            if o.get('copy'): perm |= pymupdf.PDF_PERM_COPY | pymupdf.PDF_PERM_ACCESSIBILITY
            if o.get('edit'): perm |= pymupdf.PDF_PERM_MODIFY | pymupdf.PDF_PERM_ANNOTATE | pymupdf.PDF_PERM_FORM | pymupdf.PDF_PERM_ASSEMBLE
            doc.save('/pw_out.pdf', encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=o.get('user') or '', owner_pw=o.get('owner') or o.get('user') or 'owner', permissions=perm, garbage=3, deflate=True)
        return json.dumps({'ok': True})
    finally:
        doc.close()
`;
    const PW_WORKER = `
let inst = null, py = null;
self.onmessage = async (ev) => {
    const m = ev.data;
    try {
        if (m.type === 'load') {
            const mod = await import(m.base + 'dist/index.js');
            inst = new mod.PyMuPDF({ assetPath: m.base + 'assets/', ghostscriptUrl: '' });
            self.postMessage({ type: 'status', msg: 'Đang khởi động bộ xử lý PDF (lần đầu hơi lâu)...' });
            await inst.load();
            py = await inst.getPyodide();
            py.runPython(m.setup);
            self.postMessage({ type: 'loaded' });
        } else if (m.type === 'pw') {
            let out = '', bytes = null;
            try {
                py.FS.writeFile('/pw_in.pdf', new Uint8Array(m.bytes));
                out = py.globals.get('pw_apply')(JSON.stringify(m.opts));
                if (JSON.parse(out).ok) bytes = py.FS.readFile('/pw_out.pdf');
            } finally {
                try { py.FS.unlink('/pw_in.pdf'); } catch (e) {}
                try { py.FS.unlink('/pw_out.pdf'); } catch (e) {}
            }
            self.postMessage({ type: 'done', id: m.id, json: out, bytes: bytes }, bytes ? [bytes.buffer] : []);
        }
    } catch (e) {
        self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
    }
};`;
    let worker = null, workerLoad = null, workerBase = '';
    const listeners = new Set();
    function ensureWorker() {
        let base = ($('tl-base').value || '').trim() || 'https://cdn.jsdelivr.net/npm/@bentopdf/pymupdf-wasm@0.11.16/';
        if (!base.endsWith('/')) base += '/';
        if (workerLoad && workerBase === base) return workerLoad;
        if (worker) { try { worker.terminate(); } catch (e) {} }
        workerBase = base;
        worker = new Worker(URL.createObjectURL(new Blob([PW_WORKER], { type: 'application/javascript' })));
        worker.onmessage = ev => listeners.forEach(fn => fn(ev.data));
        workerLoad = new Promise((resolve, reject) => {
            const fn = m => {
                if (m.type === 'status') setProgress(null, m.msg);
                else if (m.type === 'loaded') { listeners.delete(fn); resolve(); }
                else if (m.type === 'error' && m.id === undefined) { listeners.delete(fn); reject(new Error(m.message)); }
            };
            listeners.add(fn);
            worker.onerror = e => { listeners.delete(fn); reject(new Error(e.message || 'Không khởi động được bộ xử lý PDF')); };
            worker.postMessage({ type: 'load', base: base, setup: PY_PW });
        });
        workerLoad.catch(() => { workerLoad = null; });
        return workerLoad;
    }
    function workerCall(bytes, opts) {
        return new Promise((resolve, reject) => {
            const id = ++seq;
            const fn = m => {
                if (m.id !== id) return;
                listeners.delete(fn);
                if (m.type === 'done') resolve(m); else reject(new Error(m.message));
            };
            listeners.add(fn);
            const buf = bytes.slice(0);
            worker.postMessage({ type: 'pw', id: id, bytes: buf, opts: opts }, [buf]);
        });
    }

    // ---------- Các công cụ ----------
    const TOOLS = {};

    TOOLS.split = {
        read() {
            const mode = $('tl-split-mode').value;
            const o = { mode, ranges: $('tl-split-ranges').value.trim(), n: Math.max(1, parseInt($('tl-split-n').value, 10) || 1) };
            if ((mode === 'ranges' || mode === 'extract') && !o.ranges) throw new Error('Hãy nhập trang hoặc khoảng trang cần tách.');
            return o;
        },
        async run(it, o) {
            const src = await loadLib(it);
            const n = src.getPageCount();
            const base = baseName(it.name);
            const groups = [];
            if (o.mode === 'ranges') {
                o.ranges.split(/[,;]/).forEach(part => {
                    const idx = parsePages(part, n);
                    if (idx && idx.length) groups.push({ idx, label: part.trim().replace(/\s+/g, '') });
                });
            } else if (o.mode === 'every') {
                for (let i = 0; i < n; i += o.n) {
                    const idx = []; for (let j = i; j < Math.min(n, i + o.n); j++) idx.push(j);
                    groups.push({ idx, label: 'trang' + (i + 1) + '-' + (i + idx.length) });
                }
            } else if (o.mode === 'each') {
                for (let i = 0; i < n; i++) groups.push({ idx: [i], label: 'trang' + pad(i + 1, n) });
            } else {
                const idx = parsePages(o.ranges, n);
                if (idx && idx.length) groups.push({ idx, label: 'trich' });
            }
            if (!groups.length) throw new Error('Không có trang hợp lệ (file có ' + n + ' trang).');
            const outs = [];
            for (let g = 0; g < groups.length; g++) {
                setProgress(((g + 1) / groups.length) * 100, 'Đang tách ' + (g + 1) + '/' + groups.length + '...');
                const out = await P().PDFDocument.create();
                const pgs = await out.copyPages(src, groups[g].idx);
                pgs.forEach(p => out.addPage(p));
                outs.push({ name: base + '_' + groups[g].label + '.pdf', data: await out.save() });
                await new Promise(r => setTimeout(r, 0));
            }
            return outs;
        }
    };

    // ----- Canh lề trang (Margin) -----
    function getOffsets(g, s, dX, dY) {
        if (g.R === 0) return { tx: dX, ty: dY };
        if (g.R === 90) return { tx: (1 - s) * g.Wu - dY, ty: dX };
        if (g.R === 180) return { tx: (1 - s) * g.Wu - dX, ty: (1 - s) * g.Hu - dY };
        if (g.R === 270) return { tx: dY, ty: (1 - s) * g.Hu - dX };
        return { tx: dX, ty: dY };
    }

    TOOLS.margin = {
        read() {
            const unit = $('tl-mg-unit').value;
            const toPt = val => {
                const num = Math.max(0, parseFloat(val) || 0);
                if (unit === 'mm') return num * 72 / 25.4;
                if (unit === 'cm') return num * 10 * 72 / 25.4;
                if (unit === 'inch') return num * 72;
                return num;
            };
            const left = toPt($('tl-mg-left').value);
            const right = toPt($('tl-mg-right').value);
            const top = toPt($('tl-mg-top').value);
            const bottom = toPt($('tl-mg-bottom').value);
            const mode = $('tl-mg-mode').value;
            const mirror = $('tl-mg-mirror').checked;
            const align = $('tl-mg-align').value;
            const scope = $('tl-mg-scope').value;
            const pagesStr = $('tl-mg-pages').value;

            return { left, right, top, bottom, mode, mirror, align, scope, pagesStr, unit };
        },
        async run(it, o) {
            setProgress(null, 'Đang mở file PDF...');
            const pdf = await loadLib(it);
            const pgs = pdf.getPages();
            const total = pgs.length;
            if (!total) throw new Error('File không có trang nào.');

            let targetIndices;
            if (o.scope === 'odd') {
                targetIndices = pgs.map((_, i) => i).filter(i => (i + 1) % 2 === 1);
            } else if (o.scope === 'even') {
                targetIndices = pgs.map((_, i) => i).filter(i => (i + 1) % 2 === 0);
            } else if (o.scope === 'custom') {
                targetIndices = parsePages(o.pagesStr, total) || pgs.map((_, i) => i);
            } else {
                targetIndices = pgs.map((_, i) => i);
            }
            if (!targetIndices.length) throw new Error('Không có trang nào phù hợp với phạm vi đã chọn.');
            const targetSet = new Set(targetIndices);

            for (let i = 0; i < total; i++) {
                setProgress(((i + 1) / total) * 100, 'Đang canh lề trang ' + (i + 1) + '/' + total + '...');
                if (!targetSet.has(i)) continue;

                const page = pgs[i];
                const g = pageGeo(page);
                const isEven = (i + 1) % 2 === 0;

                let mL = o.left, mR = o.right, mT = o.top, mB = o.bottom;
                if (o.mirror && isEven) {
                    mL = o.right;
                    mR = o.left;
                }

                if (o.mode === 'expand') {
                    const newW = g.W + mL + mR;
                    const newH = g.H + mT + mB;
                    const newWu = (g.R === 90 || g.R === 270) ? newH : newW;
                    const newHu = (g.R === 90 || g.R === 270) ? newW : newH;
                    page.setSize(newWu, newHu);

                    const dX = mL;
                    const dY = mB;
                    const offsets = getOffsets(g, 1, dX, dY);
                    page.translateContent(offsets.tx, offsets.ty);
                } else if (o.mode === 'a4') {
                    const isLand = g.W > g.H;
                    const targetW = isLand ? 841.89 : 595.28;
                    const targetH = isLand ? 595.28 : 841.89;
                    const availW = Math.max(10, targetW - mL - mR);
                    const availH = Math.max(10, targetH - mT - mB);
                    const s = Math.min(availW / g.W, availH / g.H);

                    const scaledW = g.W * s;
                    const scaledH = g.H * s;
                    let dX = mL + (availW - scaledW) / 2;
                    let dY = mB + (availH - scaledH) / 2;
                    if (o.align === 'top') dY = targetH - mT - scaledH;
                    else if (o.align === 'bottom') dY = mB;

                    const targetWu = (g.R === 90 || g.R === 270) ? targetH : targetW;
                    const targetHu = (g.R === 90 || g.R === 270) ? targetW : targetH;
                    page.setSize(targetWu, targetHu);
                    page.scaleContent(s, s);
                    const offsets = getOffsets(g, s, dX, dY);
                    page.translateContent(offsets.tx, offsets.ty);
                } else {
                    // mode === 'scale' (Mặc định: thu nhỏ vừa khổ gốc)
                    const availW = Math.max(10, g.W - mL - mR);
                    const availH = Math.max(10, g.H - mT - mB);
                    const s = Math.min(availW / g.W, availH / g.H);

                    const scaledW = g.W * s;
                    const scaledH = g.H * s;
                    let dX = mL + (availW - scaledW) / 2;
                    let dY = mB + (availH - scaledH) / 2;
                    if (o.align === 'top') dY = g.H - mT - scaledH;
                    else if (o.align === 'bottom') dY = mB;

                    page.scaleContent(s, s);
                    const offsets = getOffsets(g, s, dX, dY);
                    page.translateContent(offsets.tx, offsets.ty);
                }
                await new Promise(r => setTimeout(r, 0));
            }

            setProgress(95, 'Đang lưu file PDF...');
            const bytes = await pdf.save();
            it.note = 'Đã canh lề thành công ' + targetIndices.length + '/' + total + ' trang.';
            return [{ name: baseName(it.name) + '_canh_le.pdf', data: bytes }];
        }
    };

    // ----- Loại bỏ trang trắng -----
    const BLANK_LEVEL = { strict: 0.000005, normal: 0.0001, loose: 0.0008 };
    TOOLS.blank = {
        read() {
            return {
                level: BLANK_LEVEL[$('tl-blank-sens').value] !== undefined ? $('tl-blank-sens').value : 'normal',
                margin: Math.max(0, Math.min(40, +$('tl-blank-margin').value || 0))
            };
        },
        async run(it, o) {
            const src = await loadLib(it);
            const total = src.getPageCount();
            const doc = await openPdfJs(it);
            const blank = [];
            try {
                if (doc.numPages !== total) throw new Error('Không đọc được số trang nhất quán, hãy thử file khác.');
                const limit = BLANK_LEVEL[o.level];
                for (let i = 1; i <= total; i++) {
                    setProgress(((i - 1) / total) * 90, 'Đang kiểm tra trang ' + i + '/' + total + '...');
                    const page = await doc.getPage(i);
                    const v0 = page.getViewport({ scale: 1 });
                    const scale = Math.max(0.3, Math.min(1.5, 800 / Math.max(v0.width, v0.height)));
                    const vp = page.getViewport({ scale });
                    const cv = document.createElement('canvas');
                    cv.width = Math.max(1, Math.ceil(vp.width));
                    cv.height = Math.max(1, Math.ceil(vp.height));
                    const ctx = cv.getContext('2d', { willReadFrequently: true });
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, cv.width, cv.height);
                    await page.render({ canvasContext: ctx, viewport: vp }).promise;
                    const W = cv.width, H = cv.height;
                    let mx = Math.round(o.margin * 72 / 25.4 * scale), my = mx;
                    if (W - 2 * mx < 10 || H - 2 * my < 10) { mx = 0; my = 0; }
                    const data = ctx.getImageData(0, 0, W, H).data;
                    let dark = 0;
                    for (let y = my; y < H - my; y++) {
                        let k = (y * W + mx) * 4;
                        for (let x = mx; x < W - mx; x++, k += 4) {
                            if ((data[k] * 299 + data[k + 1] * 587 + data[k + 2] * 114) / 1000 < 225) dark++;
                        }
                    }
                    const area = (W - 2 * mx) * (H - 2 * my);
                    if (dark / area <= limit) blank.push(i - 1);
                    cv.width = 0; cv.height = 0;
                    page.cleanup();
                    await new Promise(r => setTimeout(r, 0));
                }
            } finally {
                try { await doc.destroy(); } catch (e) {}
            }
            if (!blank.length) {
                it.note = 'Không tìm thấy trang trắng nào (đã kiểm tra ' + total + ' trang). Nếu bạn chắc có, thử tăng độ nhạy.';
                return [];
            }
            if (blank.length >= total) throw new Error('Tất cả ' + total + ' trang đều bị coi là trắng. Hãy giảm độ nhạy hoặc đặt vùng bỏ qua mép trang.');
            setProgress(95, 'Đang xóa trang và lưu file...');
            for (let k = blank.length - 1; k >= 0; k--) src.removePage(blank[k]);
            const bytes = await src.save();
            it.note = 'Đã bỏ ' + blank.length + ' trang trắng (trang ' + blank.map(x => x + 1).join(', ') + '), còn ' + (total - blank.length) + '/' + total + ' trang.';
            return [{ name: baseName(it.name) + '_bo_trang_trang.pdf', data: bytes }];
        }
    };

    // ----- Nén -----
    const COMP = {
        light: { q: 0.85, side: 2600 },
        balanced: { q: 0.72, side: 1800 },
        strong: { q: 0.55, side: 1300 },
        raster: { dpi: 110, q: 0.6 }
    };
    function unpng(data, rowLen, bpp, rows) {
        const out = new Uint8Array(rowLen * rows);
        let ip = 0;
        for (let r = 0; r < rows; r++) {
            const ft = data[ip++], ro = r * rowLen, po = ro - rowLen;
            for (let i = 0; i < rowLen; i++) {
                const x = data[ip++];
                const a = i >= bpp ? out[ro + i - bpp] : 0;
                const b = r > 0 ? out[po + i] : 0;
                const c = (r > 0 && i >= bpp) ? out[po + i - bpp] : 0;
                let v;
                switch (ft) {
                    case 0: v = x; break;
                    case 1: v = x + a; break;
                    case 2: v = x + b; break;
                    case 3: v = x + ((a + b) >> 1); break;
                    case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)); break; }
                    default: v = x;
                }
                out[ro + i] = v & 255;
            }
        }
        return out;
    }
    async function inflate(u8) {
        const ds = new DecompressionStream('deflate');
        const w = ds.writable.getWriter();
        w.write(u8); w.close();
        return new Uint8Array(await new Response(ds.readable).arrayBuffer());
    }
    async function recompressImages(pdf, cfg, onProg) {
        const { PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict, PDFRef } = P();
        const ctx = pdf.context;
        const N = n => PDFName.of(n);
        const entries = [];
        for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
            if (obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image')) entries.push([ref, obj]);
        }
        let replaced = 0, saved = 0;
        for (let k = 0; k < entries.length; k++) {
            const [ref, st] = entries[k];
            onProg(k / Math.max(1, entries.length));
            try {
                const d = st.dict;
                const lk = key => d.lookup(N(key));
                if (lk('ImageMask') === P().PDFBool.True || d.has(N('Mask')) || d.has(N('Decode'))) continue;
                const w = lk('Width') && lk('Width').asNumber(), h = lk('Height') && lk('Height').asNumber();
                const bpc = lk('BitsPerComponent') && lk('BitsPerComponent').asNumber();
                if (!w || !h || bpc !== 8) continue;
                const smaskRef = d.get(N('SMask'));
                if (smaskRef) {
                    const sm = d.lookup(N('SMask'));
                    if (sm instanceof PDFRawStream && sm.dict.has(N('Matte'))) continue;
                }
                // Không gian màu
                let cs = lk('ColorSpace'), ncomp = 0;
                if (cs instanceof PDFName) {
                    ncomp = cs === N('DeviceRGB') ? 3 : cs === N('DeviceGray') ? 1 : 0;
                } else if (cs instanceof PDFArray) {
                    const nm = cs.lookup(0);
                    if (nm === N('ICCBased')) {
                        const prof = cs.lookup(1);
                        const nn = prof && prof.dict && prof.dict.lookup(N('N'));
                        ncomp = nn ? nn.asNumber() : 0;
                    } else if (nm === N('CalRGB')) ncomp = 3;
                    else if (nm === N('CalGray')) ncomp = 1;
                }
                if (ncomp !== 1 && ncomp !== 3) continue;
                // Bộ lọc
                let f = lk('Filter'), filters = [];
                if (f instanceof PDFName) filters = [f];
                else if (f instanceof PDFArray) for (let i = 0; i < f.size(); i++) filters.push(f.lookup(i));
                if (filters.length !== 1) continue;
                const raw = st.getContents();
                if (raw.length < 12000 || w * h < 40000) continue;
                let source; // ImageBitmap hoặc canvas
                if (filters[0] === N('DCTDecode')) {
                    source = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }));
                } else if (filters[0] === N('FlateDecode')) {
                    let data = await inflate(raw);
                    let dp = lk('DecodeParms');
                    if (dp instanceof PDFArray) dp = dp.lookup(0);
                    let pred = 1;
                    if (dp instanceof PDFDict) { const pv = dp.lookup(N('Predictor')); pred = pv ? pv.asNumber() : 1; }
                    const rowLen = w * ncomp;
                    if (pred >= 10) {
                        if (data.length < (rowLen + 1) * h) continue;
                        data = unpng(data, rowLen, ncomp, h);
                    } else if (pred > 1) continue;
                    if (data.length < rowLen * h) continue;
                    const cv0 = document.createElement('canvas');
                    cv0.width = w; cv0.height = h;
                    const c0 = cv0.getContext('2d');
                    const im = c0.createImageData(w, h);
                    const px = im.data;
                    if (ncomp === 3) { for (let i = 0, j = 0, e = w * h; i < e; i++, j += 4) { px[j] = data[i * 3]; px[j + 1] = data[i * 3 + 1]; px[j + 2] = data[i * 3 + 2]; px[j + 3] = 255; } }
                    else { for (let i = 0, j = 0, e = w * h; i < e; i++, j += 4) { px[j] = px[j + 1] = px[j + 2] = data[i]; px[j + 3] = 255; } }
                    c0.putImageData(im, 0, 0);
                    source = cv0;
                } else continue;
                const sw = source.width, sh = source.height;
                const sc = Math.min(1, cfg.side / Math.max(sw, sh));
                const tw = Math.max(1, Math.round(sw * sc)), th = Math.max(1, Math.round(sh * sc));
                const cv = document.createElement('canvas');
                cv.width = tw; cv.height = th;
                const c = cv.getContext('2d');
                c.fillStyle = '#fff'; c.fillRect(0, 0, tw, th);
                c.imageSmoothingQuality = 'high';
                c.drawImage(source, 0, 0, tw, th);
                if (source.close) source.close();
                const blob = await canvasBlob(cv, 'image/jpeg', cfg.q);
                cv.width = cv.height = 1;
                if (!blob) continue;
                const nb = new Uint8Array(await blob.arrayBuffer());
                if (nb.length > raw.length * 0.92) continue;
                const nd = { Type: 'XObject', Subtype: 'Image', Width: tw, Height: th, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' };
                if (smaskRef) nd.SMask = smaskRef;
                ctx.assign(ref, ctx.stream(nb, nd));
                replaced++; saved += raw.length - nb.length;
            } catch (e) { /* bỏ qua ảnh không xử lý được */ }
        }
        return { replaced, saved, total: entries.length };
    }
    TOOLS.compress = {
        read() { return { level: $('tl-comp-level').value }; },
        async run(it, o) {
            const orig = it.bytes.byteLength;
            const base = baseName(it.name);
            let outBytes, note;
            if (o.level === 'raster') {
                const cfg = COMP.raster;
                const doc = await openPdfJs(it);
                const out = await P().PDFDocument.create();
                for (let i = 1; i <= doc.numPages; i++) {
                    setProgress((i / doc.numPages) * 100, 'Đang nén trang ' + i + '/' + doc.numPages + '...');
                    const page = await doc.getPage(i);
                    const v1 = page.getViewport({ scale: 1 });
                    const vp = page.getViewport({ scale: cfg.dpi / 72 });
                    const cv = document.createElement('canvas');
                    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
                    const c = cv.getContext('2d');
                    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
                    await page.render({ canvasContext: c, viewport: vp }).promise;
                    const blob = await canvasBlob(cv, 'image/jpeg', cfg.q);
                    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
                    const pg = out.addPage([v1.width, v1.height]);
                    pg.drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
                    cv.width = cv.height = 1;
                    page.cleanup();
                }
                doc.destroy();
                outBytes = await out.save({ useObjectStreams: true });
                note = 'Đã chuyển trang thành ảnh';
            } else {
                const pdf = await loadLib(it);
                const r = await recompressImages(pdf, COMP[o.level], f => setProgress(f * 90, 'Đang nén ảnh trong file...'));
                outBytes = await pdf.save({ useObjectStreams: true });
                note = r.replaced + '/' + r.total + ' ảnh được nén lại';
            }
            if (outBytes.length >= orig) {
                it.note = 'Không giảm được dung lượng, giữ nguyên file gốc (' + fmtBytes(orig) + ').';
                return [{ name: base + '_goc.pdf', data: new Uint8Array(it.bytes.slice(0)), skipDownload: true }];
            }
            it.note = fmtBytes(orig) + ' → ' + fmtBytes(outBytes.length) + ' (giảm ' + Math.round((1 - outBytes.length / orig) * 100) + '%). ' + note + '.';
            return [{ name: base + '_nen.pdf', data: outBytes }];
        }
    };

    TOOLS.pdf2img = {
        read() { return { fmt: $('tl-p2i-fmt').value, dpi: +$('tl-p2i-dpi').value, pages: $('tl-p2i-pages').value }; },
        async run(it, o) {
            const doc = await openPdfJs(it);
            const n = doc.numPages;
            let pages = parsePages(o.pages, n);
            if (!pages) { pages = []; for (let i = 0; i < n; i++) pages.push(i); }
            if (!pages.length) throw new Error('Không có trang hợp lệ (file có ' + n + ' trang).');
            const ext = o.fmt === 'image/png' ? 'png' : 'jpg';
            const base = baseName(it.name), outs = [];
            for (let k = 0; k < pages.length; k++) {
                setProgress(((k + 1) / pages.length) * 100, 'Đang xuất trang ' + (pages[k] + 1) + '...');
                const page = await doc.getPage(pages[k] + 1);
                let sc = o.dpi / 72;
                const v0 = page.getViewport({ scale: sc });
                const maxSide = 12000;
                if (Math.max(v0.width, v0.height) > maxSide) sc *= maxSide / Math.max(v0.width, v0.height);
                const vp = page.getViewport({ scale: sc });
                const cv = document.createElement('canvas');
                cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
                const c = cv.getContext('2d');
                c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
                await page.render({ canvasContext: c, viewport: vp }).promise;
                const blob = await canvasBlob(cv, o.fmt, 0.92);
                cv.width = cv.height = 1;
                outs.push({ name: base + '_trang' + pad(pages[k] + 1, n) + '.' + ext, data: blob });
                page.cleanup();
            }
            doc.destroy();
            return outs;
        }
    };

    function exifOrientation(u8) {
        try {
            if (u8[0] !== 0xFF || u8[1] !== 0xD8) return 1;
            let p = 2;
            while (p < u8.length - 4) {
                if (u8[p] !== 0xFF) return 1;
                const mk = u8[p + 1], len = (u8[p + 2] << 8) | u8[p + 3];
                if (mk === 0xE1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78) {
                    const t = p + 10, le = u8[t] === 0x49;
                    const r16 = o => le ? (u8[t + o] | (u8[t + o + 1] << 8)) : ((u8[t + o] << 8) | u8[t + o + 1]);
                    const r32 = o => le ? (u8[t + o] | (u8[t + o + 1] << 8) | (u8[t + o + 2] << 16) | (u8[t + o + 3] << 24)) : ((u8[t + o] << 24) | (u8[t + o + 1] << 16) | (u8[t + o + 2] << 8) | u8[t + o + 3]);
                    const ifd = r32(4), cnt = r16(ifd);
                    for (let i = 0; i < cnt; i++) { const e = ifd + 2 + i * 12; if (r16(e) === 0x0112) return r16(e + 8); }
                    return 1;
                }
                if (mk === 0xDA) return 1;
                p += 2 + len;
            }
        } catch (e) {}
        return 1;
    }
    TOOLS.img2pdf = {
        all: true,
        read() { return { size: $('tl-i2p-size').value, margin: Math.max(0, +$('tl-i2p-margin').value || 0) * 72 / 25.4 }; },
        async run(items, o) {
            const out = await P().PDFDocument.create();
            for (let k = 0; k < items.length; k++) {
                const it = items[k];
                setProgress(((k + 1) / items.length) * 100, 'Đang thêm ảnh ' + (k + 1) + '/' + items.length + '...');
                const u8 = new Uint8Array(it.bytes.slice(0));
                const isJpg = u8[0] === 0xFF && u8[1] === 0xD8, isPng = u8[0] === 0x89 && u8[1] === 0x50;
                let img;
                if (isJpg && exifOrientation(u8) === 1) img = await out.embedJpg(u8);
                else if (isPng) img = await out.embedPng(u8);
                else {
                    const bmp = await createImageBitmap(new Blob([u8], { type: it.file.type || 'image/*' }));
                    const cv = document.createElement('canvas');
                    cv.width = bmp.width; cv.height = bmp.height;
                    const c = cv.getContext('2d');
                    if (isJpg) { c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); }
                    c.drawImage(bmp, 0, 0);
                    bmp.close && bmp.close();
                    if (isJpg) img = await out.embedJpg(new Uint8Array(await (await canvasBlob(cv, 'image/jpeg', 0.95)).arrayBuffer()));
                    else img = await out.embedPng(new Uint8Array(await (await canvasBlob(cv, 'image/png')).arrayBuffer()));
                    cv.width = cv.height = 1;
                }
                const iw = img.width, ih = img.height;
                let pw, ph;
                if (o.size === 'fit') { pw = iw * 0.75; ph = ih * 0.75; }
                else {
                    const base = o.size === 'letter' ? [612, 792] : [595.28, 841.89];
                    const land = o.size === 'a4l' ? true : o.size === 'a4p' ? false : iw > ih;
                    pw = land ? base[1] : base[0]; ph = land ? base[0] : base[1];
                }
                const m = o.size === 'fit' ? 0 : o.margin;
                const page = out.addPage([pw, ph]);
                const aw = pw - 2 * m, ah = ph - 2 * m;
                const sc = o.size === 'fit' ? 1 : Math.min(aw / iw, ah / ih);
                const w = o.size === 'fit' ? pw : iw * sc, h = o.size === 'fit' ? ph : ih * sc;
                page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
            }
            const nm = items.length === 1 ? baseName(items[0].name) : 'anh_gop';
            return [{ name: nm + '.pdf', data: await out.save() }];
        }
    };

    TOOLS.protect = {
        read() {
            const mode = $('tl-pw-mode').value;
            const o = { mode };
            if (mode === 'set') {
                o.user = $('tl-pw-user').value; o.owner = $('tl-pw-owner').value;
                o.print = $('tl-pw-print').checked; o.copy = $('tl-pw-copy').checked; o.edit = $('tl-pw-edit').checked;
                if (!o.user && !o.owner) throw new Error('Hãy nhập ít nhất một mật khẩu (mật khẩu mở file hoặc mật khẩu chủ).');
            } else o.pw = $('tl-pw-cur').value;
            return o;
        },
        async run(it, o) {
            setProgress(null, 'Đang khởi động bộ xử lý PDF...');
            await ensureWorker();
            setProgress(60, o.mode === 'set' ? 'Đang mã hóa...' : 'Đang gỡ mật khẩu...');
            const m = await workerCall(it.bytes, o);
            const r = JSON.parse(m.json);
            if (!r.ok) throw new Error(r.err === 'badpw' ? 'Sai mật khẩu.' : 'Không xử lý được file.');
            const base = baseName(it.name);
            return [{ name: base + (o.mode === 'set' ? '_baove.pdf' : '_mokhoa.pdf'), data: new Uint8Array(m.bytes) }];
        }
    };

    TOOLS.meta = {
        read() {
            const o = { mode: $('tl-meta-mode').value, xmp: $('tl-meta-xmp').checked };
            ['title', 'author', 'subject', 'keywords', 'creator', 'producer'].forEach(k => o[k] = $('tl-meta-' + k).value.trim());
            return o;
        },
        async run(it, o) {
            const pdf = await loadLib(it);
            const { PDFName, PDFHexString } = P();
            if (o.xmp) pdf.catalog.delete(PDFName.of('Metadata'));
            if (o.mode === 'clear') {
                pdf.context.trailerInfo.Info = undefined;
            } else {
                const info = pdf.getInfoDict();
                const map = { Title: o.title, Author: o.author, Subject: o.subject, Keywords: o.keywords, Creator: o.creator, Producer: o.producer };
                Object.keys(map).forEach(k => { if (map[k]) info.set(PDFName.of(k), PDFHexString.fromText(map[k])); else info.delete(PDFName.of(k)); });
            }
            return [{ name: baseName(it.name) + (o.mode === 'clear' ? '_sach.pdf' : '_sua.pdf'), data: await pdf.save() }];
        }
    };

    TOOLS.watermark = {
        read() {
            const o = {
                type: $('tl-wm-type').value, text: $('tl-wm-text').value, size: +$('tl-wm-size').value || 72, color: $('tl-wm-color').value,
                bold: $('tl-wm-bold').checked, op: Math.max(0.02, Math.min(1, (+$('tl-wm-op').value || 25) / 100)), rot: +$('tl-wm-rot').value || 0,
                pos: $('tl-wm-pos').value, pages: $('tl-wm-pages').value, imgw: Math.max(5, Math.min(100, +$('tl-wm-imgw').value || 40)), imgFile: null
            };
            if (o.type === 'text' && !o.text.trim()) throw new Error('Hãy nhập nội dung chữ watermark.');
            if (o.type === 'image') {
                o.imgFile = $('tl-wm-img').files[0];
                if (!o.imgFile) throw new Error('Hãy chọn ảnh watermark.');
            }
            return o;
        },
        async run(it, o) {
            const pdf = await loadLib(it);
            const L = P();
            let font = null, img = null, imgBytes = null;
            if (o.type === 'text') font = await getFontLib(pdf, o.bold);
            else {
                imgBytes = new Uint8Array(await o.imgFile.arrayBuffer());
                if (imgBytes[0] === 0xFF && imgBytes[1] === 0xD8 && exifOrientation(imgBytes) === 1) img = await pdf.embedJpg(imgBytes);
                else if (imgBytes[0] === 0x89 && imgBytes[1] === 0x50) img = await pdf.embedPng(imgBytes);
                else {
                    const bmp = await createImageBitmap(o.imgFile);
                    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
                    cv.getContext('2d').drawImage(bmp, 0, 0);
                    img = await pdf.embedPng(new Uint8Array(await (await canvasBlob(cv, 'image/png')).arrayBuffer()));
                }
            }
            const pgs = pdf.getPages();
            const idx = parsePages(o.pages, pgs.length) || pgs.map((_, i) => i);
            const text = o.type === 'text' ? safeText(font, o.text.trim()) : '';
            const color = hexRgb(o.color);
            idx.forEach((pi, k) => {
                const page = pgs[pi], g = pageGeo(page);
                let w, h;
                if (o.type === 'text') { w = font.widthOfTextAtSize(text, o.size); h = o.size; }
                else { w = g.W * o.imgw / 100; h = w * img.height / img.width; }
                const place = (cx, cy) => {
                    const off = o.type === 'text' ? [-w / 2, -h * 0.3] : [-w / 2, -h / 2];
                    const [dx, dy] = rotv(off[0], off[1], o.rot);
                    const u = toUser(g, cx + dx, cy + dy, o.rot);
                    if (o.type === 'text') page.drawText(text, { x: u.x, y: u.y, size: o.size, font, color, opacity: o.op, rotate: L.degrees(u.ang) });
                    else page.drawImage(img, { x: u.x, y: u.y, width: w, height: h, opacity: o.op, rotate: L.degrees(u.ang) });
                };
                if (o.pos === 'center') place(g.W / 2, g.H / 2);
                else {
                    const sx = w * 1.5 + 30, sy = h * (o.type === 'text' ? 4 : 1.6) + 20;
                    let cnt = 0, row = 0;
                    for (let y = sy / 2; y < g.H + sy && cnt < 500; y += sy, row++) {
                        for (let x = (row % 2 ? sx / 2 : 0); x < g.W + sx && cnt < 500; x += sx) { place(x, y); cnt++; }
                    }
                }
                setProgress(((k + 1) / idx.length) * 100, 'Đang chèn watermark ' + (k + 1) + '/' + idx.length + '...');
            });
            return [{ name: baseName(it.name) + '_watermark.pdf', data: await pdf.save() }];
        }
    };

    TOOLS.pagenum = {
        read() {
            return {
                fmt: $('tl-pn-fmt').value, pos: $('tl-pn-pos').value, size: +$('tl-pn-size').value || 11, color: $('tl-pn-color').value,
                from: Math.max(1, parseInt($('tl-pn-from').value, 10) || 1), start: parseInt($('tl-pn-start').value, 10) || 0,
                margin: Math.max(3, +$('tl-pn-margin').value || 10) * 72 / 25.4
            };
        },
        async run(it, o) {
            const pdf = await loadLib(it);
            const font = await getFontLib(pdf, false);
            const color = hexRgb(o.color);
            const pgs = pdf.getPages();
            const total = pgs.length;
            for (let i = o.from - 1; i < total; i++) {
                const num = o.start + (i - (o.from - 1));
                const txt = safeText(font, o.fmt.replace('{n}', num).replace('{N}', total));
                const page = pgs[i], g = pageGeo(page);
                const w = font.widthOfTextAtSize(txt, o.size);
                const hz = o.pos[1], vt = o.pos[0];
                const X = hz === 'l' ? o.margin : hz === 'r' ? g.W - o.margin - w : (g.W - w) / 2;
                const Y = vt === 'b' ? o.margin : g.H - o.margin - o.size * 0.75;
                const u = toUser(g, X, Y, 0);
                page.drawText(txt, { x: u.x, y: u.y, size: o.size, font, color, rotate: P().degrees(u.ang) });
            }
            setProgress(100, 'Đang lưu file...');
            return [{ name: baseName(it.name) + '_danhso.pdf', data: await pdf.save() }];
        }
    };

    function parseBookmarks(text) {
        const out = [];
        text.split(/\r?\n/).forEach((raw, ln) => {
            if (!raw.trim()) return;
            const m = raw.match(/^[\s]*([-–>]*)\s*(.*)$/);
            let level = m[1].length, rest = m[2].trim();
            let title, page;
            const bar = rest.lastIndexOf('|');
            if (bar >= 0) { title = rest.slice(0, bar).trim(); page = parseInt(rest.slice(bar + 1), 10); }
            else { const t = rest.match(/^(.*?)[\s.]+(\d+)$/); if (t) { title = t[1].trim(); page = parseInt(t[2], 10); } }
            if (!title || !page) throw new Error('Dòng ' + (ln + 1) + ' không đúng định dạng "Tiêu đề | số trang": ' + raw.trim());
            out.push({ title, page: page - 1, level });
        });
        return out;
    }
    TOOLS.bookmark = {
        read() {
            const e = parseBookmarks($('tl-bm-text').value);
            if (!e.length) throw new Error('Hãy nhập danh sách mục lục.');
            return { entries: e };
        },
        async run(it, o) {
            const pdf = await loadLib(it);
            const L = P();
            const ctx = pdf.context, N = n => L.PDFName.of(n);
            const pages = pdf.getPages();
            let prev = -1;
            const ents = o.entries.map(e => {
                let lv = Math.min(e.level, prev + 1); prev = lv;
                return { title: e.title, page: Math.max(0, Math.min(pages.length - 1, e.page)), level: lv };
            });
            const nodes = ents.map(e => Object.assign({}, e, { ref: ctx.nextRef(), kids: [] }));
            const top = [], stack = [];
            nodes.forEach(n => {
                while (stack.length && stack[stack.length - 1].level >= n.level) stack.pop();
                n.parent = stack.length ? stack[stack.length - 1] : null;
                (n.parent ? n.parent.kids : top).push(n);
                stack.push(n);
            });
            const countDesc = n => n.kids.reduce((s, k) => s + 1 + countDesc(k), 0);
            const rootRef = ctx.nextRef();
            const write = (list, parentRef) => {
                list.forEach((n, i) => {
                    const d = ctx.obj({});
                    d.set(N('Title'), L.PDFHexString.fromText(n.title));
                    d.set(N('Parent'), parentRef);
                    if (i > 0) d.set(N('Prev'), list[i - 1].ref);
                    if (i < list.length - 1) d.set(N('Next'), list[i + 1].ref);
                    if (n.kids.length) {
                        d.set(N('First'), n.kids[0].ref);
                        d.set(N('Last'), n.kids[n.kids.length - 1].ref);
                        d.set(N('Count'), L.PDFNumber.of(countDesc(n)));
                    }
                    d.set(N('Dest'), ctx.obj([pages[n.page].ref, N('XYZ'), null, null, null]));
                    ctx.assign(n.ref, d);
                    write(n.kids, n.ref);
                });
            };
            const root = ctx.obj({});
            root.set(N('Type'), N('Outlines'));
            root.set(N('First'), top[0].ref);
            root.set(N('Last'), top[top.length - 1].ref);
            root.set(N('Count'), L.PDFNumber.of(nodes.length));
            ctx.assign(rootRef, root);
            write(top, rootRef);
            pdf.catalog.set(N('Outlines'), rootRef);
            pdf.catalog.set(N('PageMode'), N('UseOutlines'));
            return [{ name: baseName(it.name) + '_mucluc.pdf', data: await pdf.save() }];
        }
    };

    // ----- OCR -----
    let tessWorker = null, tessLang = '';
    async function ensureTesseract(lang) {
        if (typeof Tesseract === 'undefined') {
            await loadScript(['vendor/tesseract.min.js', 'vendor/tesseract.min.js'], 'Không tải được thư viện OCR (cần kết nối mạng lần đầu)');
        }
        if (tessWorker && tessLang === lang) return tessWorker;
        if (tessWorker) { try { await tessWorker.terminate(); } catch (e) {} tessWorker = null; }
        tessWorker = await Tesseract.createWorker(lang.split('+'), 1, {
            logger: m => { if (m.status && m.status.indexOf('loading') === 0) setProgress(null, 'Đang tải dữ liệu nhận dạng (' + m.status.replace('loading ', '') + ')...'); }
        });
        tessLang = lang;
        return tessWorker;
    }
    TOOLS.ocr = {
        read() { return { lang: $('tl-ocr-lang').value, dpi: +$('tl-ocr-dpi').value, out: $('tl-ocr-out').value, pages: $('tl-ocr-pages').value }; },
        async run(it, o) {
            setProgress(0, 'Đang chuẩn bị bộ OCR...');
            const wk = await ensureTesseract(o.lang);
            const doc = await openPdfJs(it);
            const n = doc.numPages;
            let pages = parsePages(o.pages, n);
            if (!pages) { pages = []; for (let i = 0; i < n; i++) pages.push(i); }
            if (!pages.length) throw new Error('Không có trang hợp lệ (file có ' + n + ' trang).');
            const wantPdf = o.out !== 'txt';
            let pdf = null, font = null;
            if (wantPdf) { pdf = await loadLib(it); font = await getFontLib(pdf, false); }
            const L = P();
            const texts = [];
            for (let k = 0; k < pages.length; k++) {
                const pi = pages[k];
                setProgress((k / pages.length) * 100, 'OCR trang ' + (pi + 1) + ' (' + (k + 1) + '/' + pages.length + ')...');
                const page = await doc.getPage(pi + 1);
                const vp = page.getViewport({ scale: o.dpi / 72 });
                const cv = document.createElement('canvas');
                cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
                const c = cv.getContext('2d');
                c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
                await page.render({ canvasContext: c, viewport: vp }).promise;
                const res = await wk.recognize(cv, {}, { text: true, blocks: true });
                cv.width = cv.height = 1;
                texts.push('=== Trang ' + (pi + 1) + ' ===\n' + (res.data.text || '').trim());
                if (wantPdf) {
                    const lp = pdf.getPage(pi);
                    const rot = ((lp.getRotation().angle % 360) + 360) % 360;
                    (res.data.blocks || []).forEach(b => (b.paragraphs || []).forEach(pa => (pa.lines || []).forEach(ln => (ln.words || []).forEach(wd => {
                        const t = safeText(font, (wd.text || '').trim());
                        if (!t) return;
                        const bb = wd.bbox, wpx = bb.x1 - bb.x0, hpx = bb.y1 - bb.y0;
                        if (wpx <= 0 || hpx <= 0) return;
                        const wpt = wpx / vp.scale;
                        const w1 = font.widthOfTextAtSize(t, 1);
                        if (!w1) return;
                        let size = wpt / w1;
                        const hpt = hpx / vp.scale;
                        size = Math.max(hpt * 0.4, Math.min(hpt * 1.6, size));
                        const p0 = vp.convertToPdfPoint(bb.x0, bb.y1 - hpx * 0.2);
                        lp.pushOperators(L.pushGraphicsState(), L.setTextRenderingMode(L.TextRenderingMode.Invisible));
                        lp.drawText(t, { x: p0[0], y: p0[1], size, font, rotate: L.degrees(rot) });
                        lp.pushOperators(L.popGraphicsState());
                    }))));
                }
                page.cleanup();
                await new Promise(r => setTimeout(r, 0));
            }
            doc.destroy();
            const base = baseName(it.name), outs = [];
            if (wantPdf) outs.push({ name: base + '_ocr.pdf', data: await pdf.save() });
            if (o.out !== 'pdf') outs.push({ name: base + '_ocr.txt', data: new Blob(['﻿' + texts.join('\n\n')], { type: 'text/plain;charset=utf-8' }) });
            return outs;
        }
    };

    // ---------- Danh sách file ----------
    async function addFiles(files) {
        const kind = INFO[tool].accept;
        const arr = Array.from(files).filter(f => kind === 'img' ? /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name) : (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
        if (!arr.length) { alert(kind === 'img' ? 'Chỉ nhận file ảnh (JPG, PNG, WebP, GIF, BMP).' : 'Chỉ nhận file PDF.'); return; }
        const list = lists[kind === 'img' ? 'img' : 'pdf'];
        for (const f of arr) {
            const it = { id: ++seq, file: f, name: f.name, size: f.size, bytes: await f.arrayBuffer(), outs: [], err: null, note: '' };
            if (kind === 'pdf') {
                try {
                    const doc = await openPdfJs(it);
                    it.pages = doc.numPages;
                    try { const md = await doc.getMetadata(); it.meta = md && md.info; } catch (e) {}
                    if (!mgThumbCanvas) {
                        try {
                            const p1 = await doc.getPage(1);
                            const vp = p1.getViewport({ scale: 0.25 });
                            const cv = document.createElement('canvas');
                            cv.width = vp.width; cv.height = vp.height;
                            await p1.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
                            mgThumbCanvas = cv;
                        } catch (err) {}
                    }
                    doc.destroy();
                } catch (e) {
                    if (e && e.name === 'PasswordException') { it.enc = true; it.pages = '?'; }
                    else it.err = 'Không đọc được file PDF';
                }
            } else it.url = URL.createObjectURL(f);
            list.push(it);
        }
        if (kind === 'pdf' && tool === 'meta') fillMetaFromFirst();
        if (kind === 'pdf' && tool === 'margin') renderMarginPreview();
        render();
    }
    function fillMetaFromFirst() {
        const it = lists.pdf.find(x => x.meta);
        if (!it) return;
        const m = it.meta;
        [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords'], ['creator', 'Creator'], ['producer', 'Producer']].forEach(([k, f]) => { $('tl-meta-' + k).value = m[f] || ''; });
    }
    function render() {
        const list = curList(), kind = INFO[tool].accept;
        $('tl-list-title').textContent = kind === 'img' ? 'DANH SÁCH ẢNH' : 'DANH SÁCH FILE PDF';
        const box = $('tl-list');
        if (!list.length) {
            box.innerHTML = '<div style="color:gray; font-style:italic; text-align:center; padding-top:40px;">Chưa chọn file nào. Kéo thả ' + (kind === 'img' ? 'ảnh' : 'PDF') + ' vào đây hoặc bấm nút chọn file.</div>';
        } else {
            box.innerHTML = list.map((it, i) => {
                const outs = it.outs.filter(o => !o.skipDownload || true).map((o, j) => '<a href="#" data-dl="' + it.id + ':' + j + '" style="margin-right:10px; font-size:12px;">⬇ ' + esc(o.name) + ' (' + fmtBytes(o.data.size !== undefined ? o.data.size : o.data.length) + ')</a>').join('');
                const thumb = it.url ? '<img src="' + it.url + '" style="width:44px; height:44px; object-fit:cover; border-radius:4px; margin-right:10px;">' : '<span style="font-size:22px; margin-right:10px;">📄</span>';
                const mv = kind === 'img' ? '<button class="btn" data-mv="' + it.id + ':-1" style="width:auto; padding:2px 8px; margin:0 2px;" title="Lên">↑</button><button class="btn" data-mv="' + it.id + ':1" style="width:auto; padding:2px 8px; margin:0 2px;" title="Xuống">↓</button>' : '';
                const pw = it.enc && tool !== 'protect' ? '<div style="color:#c42b2b; font-size:12px; margin-top:2px;">File có mật khẩu: hãy dùng "Đặt / gỡ mật khẩu" → Gỡ mật khẩu trước.</div>' : '';
                return '<div class="tl-row">' + thumb +
                    '<div style="flex:1; min-width:0;"><div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(it.name) + '</div>' +
                    '<div style="font-size:12px; color:#666;">' + fmtBytes(it.size) + (kind === 'pdf' ? ' · ' + (it.pages || '?') + ' trang' : '') + (it.enc ? ' · 🔒 có mật khẩu' : '') + '</div>' +
                    pw + (it.err ? '<div style="color:#c42b2b; font-size:12px; margin-top:2px;">⚠ ' + esc(it.err) + '</div>' : '') +
                    (it.note ? '<div style="color:#178a4c; font-size:12px; margin-top:2px;">✔ ' + esc(it.note) + '</div>' : '') +
                    (outs ? '<div style="margin-top:3px;">' + outs + '</div>' : '') + '</div>' + mv +
                    '<button class="btn btn-danger" data-rm="' + it.id + '" style="width:auto; padding:2px 8px; margin:0 0 0 4px;" title="Bỏ khỏi danh sách">✕</button></div>';
            }).join('');
        }
        const hasOut = lists.pdf.concat(lists.img).some(it => it.outs.length);
        $('tl-run-btn').disabled = busy || !list.length;
        $('tl-clear-btn').style.display = list.length ? '' : 'none';
        $('tl-zip-btn').style.display = list.some(it => it.outs.length) && hasOut ? '' : 'none';
    }

    async function run() {
        if (busy) return;
        const list = curList();
        if (!list.length) return;
        let opts;
        try { opts = TOOLS[tool].read(); } catch (e) { alert(e.message); return; }
        const T = TOOLS[tool];
        busy = true; render();
        list.forEach(it => { it.outs = []; it.err = null; if (tool !== 'img2pdf') it.note = ''; });
        $('tl-run-btn').textContent = '⏳ Đang xử lý...';
        try {
            if (T.all) {
                try { list[0].outs = await T.run(list, opts); } catch (e) { list[0].err = e.message || String(e); console.error(e); }
            } else {
                for (let i = 0; i < list.length; i++) {
                    const it = list[i];
                    if (it.err && !it.pages) continue;
                    if (it.enc && tool !== 'protect') { it.err = 'File có mật khẩu.'; continue; }
                    setProgress((i / list.length) * 100, 'Đang xử lý ' + (i + 1) + '/' + list.length + ': ' + it.name);
                    try { it.outs = await T.run(it, opts); }
                    catch (e) { it.err = e.message || String(e); console.error(e); }
                }
            }
        } finally {
            busy = false;
            $('tl-run-btn').textContent = '▶ THỰC HIỆN';
        }
        const all = list.reduce((a, it) => a.concat(it.outs.map(o => ({ it, o }))), []);
        const ok = all.length, errs = list.filter(it => it.err).length;
        setProgress(100, ok ? 'Xong: tạo được ' + ok + ' file' + (errs ? ', ' + errs + ' file lỗi.' : '.') : 'Không tạo được file nào.');
        render();
        const real = all.filter(x => !x.o.skipDownload);
        if (real.length === 1) saveBlob(toBlob(real[0].o.data, real[0].o.name), real[0].o.name);
        else if (real.length > 1) zipAll();
    }

    async function zipAll() {
        const all = [];
        lists.pdf.concat(lists.img).forEach(it => it.outs.forEach(o => { if (!o.skipDownload) all.push(o); }));
        if (!all.length) return;
        try { await ensureJSZip(); } catch (e) { alert(e.message); return; }
        const zip = new JSZip(), used = {};
        all.forEach(o => {
            let nm = o.name; const m = nm.match(/^(.*?)(\.[^.]+)?$/);
            if (used[nm]) { let k = 2; while (used[m[1] + '_' + k + (m[2] || '')]) k++; nm = m[1] + '_' + k + (m[2] || ''); }
            used[nm] = 1;
            zip.file(nm, o.data);
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        saveBlob(blob, 'ket-qua-pdf-tools.zip');
    }

    // ---------- Canh lề Preview & Preset ----------
    let mgPreviewEven = false;
    let mgThumbCanvas = null;

    function toMm(val, unit) {
        const num = Math.max(0, parseFloat(val) || 0);
        if (unit === 'cm') return num * 10;
        if (unit === 'inch') return num * 25.4;
        if (unit === 'pt') return num * 25.4 / 72;
        return num;
    }

    function fromMm(mm, unit) {
        if (unit === 'cm') return +(mm / 10).toFixed(2);
        if (unit === 'inch') return +(mm / 25.4).toFixed(3);
        if (unit === 'pt') return +(mm * 72 / 25.4).toFixed(1);
        return +mm.toFixed(1);
    }

    function updateMarginPreset(presetKey) {
        const unit = $('tl-mg-unit').value;
        const setVals = (l, r, t, b, mirror) => {
            $('tl-mg-left').value = fromMm(l, unit);
            $('tl-mg-right').value = fromMm(r, unit);
            $('tl-mg-top').value = fromMm(t, unit);
            $('tl-mg-bottom').value = fromMm(b, unit);
            $('tl-mg-mirror').checked = mirror;
            onMirrorChange();
        };

        if (presetKey === 'nd30') {
            setVals(30, 15, 20, 20, false);
        } else if (presetKey === 'book') {
            setVals(30, 15, 20, 20, true);
        } else if (presetKey === 'thesis') {
            setVals(35, 20, 20, 20, false);
        } else if (presetKey === 'equal15') {
            setVals(15, 15, 15, 15, false);
        } else if (presetKey === 'equal20') {
            setVals(20, 20, 20, 20, false);
        } else if (presetKey === 'standard1in') {
            setVals(25.4, 25.4, 25.4, 25.4, false);
        } else if (presetKey === 'narrow') {
            setVals(12.7, 12.7, 12.7, 12.7, false);
        }
        renderMarginPreview();
    }

    function onMirrorChange() {
        const mirror = $('tl-mg-mirror').checked;
        const toggleBtn = $('tl-mg-toggle-page-btn');
        if (mirror) {
            $('tl-mg-lb-left').textContent = 'Lề Gáy / Trái (Odd):';
            $('tl-mg-lb-right').textContent = 'Lề Ngoài / Phải (Odd):';
            toggleBtn.style.display = '';
            toggleBtn.textContent = mgPreviewEven ? '📄 Xem trang lẻ (Gáy trái)' : '📄 Xem trang chẵn (Gáy phải)';
        } else {
            $('tl-mg-lb-left').textContent = 'Lề Trái (Left):';
            $('tl-mg-lb-right').textContent = 'Lề Phải (Right):';
            toggleBtn.style.display = 'none';
            mgPreviewEven = false;
        }
        renderMarginPreview();
    }

    function renderMarginPreview() {
        const cv = $('tl-mg-preview-cv');
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height;

        ctx.clearRect(0, 0, W, H);

        const unit = $('tl-mg-unit').value;
        const rawL = toMm($('tl-mg-left').value, unit);
        const rawR = toMm($('tl-mg-right').value, unit);
        const topMm = toMm($('tl-mg-top').value, unit);
        const botMm = toMm($('tl-mg-bottom').value, unit);
        const mirror = $('tl-mg-mirror').checked;

        let leftMm = rawL, rightMm = rawR;
        if (mirror && mgPreviewEven) {
            leftMm = rawR;
            rightMm = rawL;
        }

        const scaleX = (W - 8) / 210;
        const scaleY = (H - 8) / 297;
        const pageX = 4, pageY = 4, pageW = W - 8, pageH = H - 8;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(pageX + 2, pageY + 2, pageW, pageH);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(pageX, pageY, pageW, pageH);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(pageX, pageY, pageW, pageH);

        if (mgThumbCanvas) {
            ctx.save();
            ctx.globalAlpha = 0.22;
            ctx.drawImage(mgThumbCanvas, pageX, pageY, pageW, pageH);
            ctx.restore();
        }

        const marginL = Math.max(2, Math.min(pageW * 0.45, leftMm * scaleX));
        const marginR = Math.max(2, Math.min(pageW * 0.45, rightMm * scaleX));
        const marginT = Math.max(2, Math.min(pageH * 0.45, topMm * scaleY));
        const marginB = Math.max(2, Math.min(pageH * 0.45, botMm * scaleY));

        const contentX = pageX + marginL;
        const contentY = pageY + marginT;
        const contentW = Math.max(10, pageW - marginL - marginR);
        const contentH = Math.max(10, pageH - marginT - marginB);

        ctx.fillStyle = 'rgba(2, 132, 199, 0.06)';
        ctx.fillRect(pageX, pageY, pageW, marginT);
        ctx.fillRect(pageX, pageY + pageH - marginB, pageW, marginB);
        ctx.fillRect(pageX, pageY + marginT, marginL, contentH);
        ctx.fillRect(pageX + pageW - marginR, pageY + marginT, marginR, contentH);

        if (mirror) {
            const gutterX = (mgPreviewEven) ? (pageX + pageW - marginR) : pageX;
            const gutterW = (mgPreviewEven) ? marginR : marginL;
            ctx.fillStyle = 'rgba(234, 88, 12, 0.12)';
            ctx.fillRect(gutterX, pageY, gutterW, pageH);
            ctx.strokeStyle = '#ea580c';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(gutterX + (mgPreviewEven ? 0 : gutterW), pageY);
            ctx.lineTo(gutterX + (mgPreviewEven ? 0 : gutterW), pageY + pageH);
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(254, 240, 138, 0.35)';
        ctx.fillRect(contentX, contentY, contentW, contentH);
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(contentX, contentY, contentW, contentH);
        ctx.setLineDash([]);

        ctx.fillStyle = '#94a3b8';
        const lineCount = Math.floor((contentH - 12) / 6);
        for (let l = 0; l < lineCount; l++) {
            const ly = contentY + 8 + l * 6;
            const lw = (l % 4 === 3) ? contentW * 0.6 : contentW * 0.9;
            ctx.fillRect(contentX + 4, ly, Math.max(4, lw - 8), 2.5);
        }

        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#0369a1';
        ctx.textAlign = 'center';
        ctx.fillText((mirror && !mgPreviewEven ? 'Gáy: ' : 'T: ') + leftMm + 'mm', Math.max(14, marginL / 2 + pageX), pageY + pageH / 2);
        ctx.fillText((mirror && mgPreviewEven ? 'Gáy: ' : 'P: ') + rightMm + 'mm', pageX + pageW - marginR / 2, pageY + pageH / 2);
        ctx.fillText('Trên: ' + topMm + 'mm', pageX + pageW / 2, pageY + marginT / 2 + 3);
        ctx.fillText('Dưới: ' + botMm + 'mm', pageX + pageW / 2, pageY + pageH - marginB / 2 + 3);

        const availW_mm = Math.max(10, 210 - leftMm - rightMm);
        const availH_mm = Math.max(10, 297 - topMm - botMm);
        const s = Math.min(availW_mm / 210, availH_mm / 297);
        const mode = $('tl-mg-mode').value;
        const sub = $('tl-mg-preview-sub');
        if (sub) {
            if (mode === 'expand') {
                sub.textContent = 'Mở rộng khổ: ' + Math.round(210 + leftMm + rightMm) + 'x' + Math.round(297 + topMm + botMm) + ' mm';
            } else {
                sub.textContent = 'Tỉ lệ co: ' + Math.round(s * 100) + '% | Vùng in: ' + Math.round(availW_mm) + 'x' + Math.round(availH_mm) + ' mm';
            }
        }
        const info = $('tl-mg-preview-info');
        if (info) {
            info.textContent = mirror ? (mgPreviewEven ? 'Trang chẵn (2, 4...)' : 'Trang lẻ (1, 3...)') : 'Xem trước khổ A4';
        }
    }

    // ---------- Chọn công cụ ----------
    function selectTool(name) {
        if (!INFO[name]) return;
        tool = name;
        $('tl-tool').value = name;
        document.querySelectorAll('#tab-tools .tl-opts').forEach(d => d.style.display = d.dataset.tool === name ? 'block' : 'none');
        $('tl-hint').textContent = INFO[name].hint;
        const img = INFO[name].accept === 'img';
        $('tl-input').accept = img ? 'image/*' : 'application/pdf';
        $('tl-pick-btn').textContent = img ? '➕ Chọn ảnh' : '➕ Chọn file PDF';
        if (name === 'meta') fillMetaFromFirst();
        if (name === 'margin') renderMarginPreview();
        render();
    }
    window.toolsSelect = selectTool;
    window.warmOffline = async function (say) {
        say('Đang tải thư viện nén ZIP...');
        await ensureJSZip();
        say('Đang tải thư viện Excel...');
        if (typeof ExcelJS === 'undefined') await loadScript(['vendor/exceljs.min.js', 'vendor/exceljs.min.js'], 'Không tải được ExcelJS');
        try { await fetch(pdfjsLib.GlobalWorkerOptions.workerSrc, { mode: 'cors' }).then(r => r.arrayBuffer()); } catch (e) {}
        say('Đang tải bộ OCR và dữ liệu tiếng Việt, tiếng Anh...');
        await ensureTesseract('vie+eng');
        try { await tessWorker.terminate(); } catch (e) {}
        tessWorker = null; tessLang = '';
        say('Đang tải bộ xử lý PDF (~55 MB, có thể mất vài phút)...');
        setProgress(null, '');
        await ensureWorker();
        try { worker.terminate(); } catch (e) {}
        worker = null; workerLoad = null;
    };

    function init() {
        $('tl-tool').addEventListener('change', e => {
            selectTool(e.target.value);
            document.querySelectorAll('.menu-item').forEach(b => b.classList.toggle('active', (b.getAttribute('onclick') || '').indexOf("toolsSelect('" + e.target.value + "')") >= 0));
        });
        $('tl-pick-btn').addEventListener('click', () => $('tl-input').click());
        $('tl-input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
        $('tl-run-btn').addEventListener('click', run);
        $('tl-zip-btn').addEventListener('click', zipAll);
        $('tl-clear-btn').addEventListener('click', () => { curList().forEach(it => it.url && URL.revokeObjectURL(it.url)); curList().length = 0; $('tl-progress-wrap').style.display = 'none'; mgThumbCanvas = null; renderMarginPreview(); render(); });
        const drop = $('tl-drop');
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.outline = '2px dashed var(--primary)'; });
        drop.addEventListener('dragleave', () => { drop.style.outline = ''; });
        drop.addEventListener('drop', e => { e.preventDefault(); drop.style.outline = ''; if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
        $('tl-list').addEventListener('click', e => {
            const t = e.target.closest('[data-rm],[data-mv],[data-dl]');
            if (!t) return;
            e.preventDefault();
            const list = curList();
            if (t.dataset.rm) { const i = list.findIndex(x => x.id === +t.dataset.rm); if (i >= 0) { list[i].url && URL.revokeObjectURL(list[i].url); list.splice(i, 1); if (!list.length) { mgThumbCanvas = null; renderMarginPreview(); } render(); } }
            else if (t.dataset.mv) { const [id, d] = t.dataset.mv.split(':').map(Number); const i = list.findIndex(x => x.id === id), j = i + d; if (i >= 0 && j >= 0 && j < list.length) { const x = list[i]; list[i] = list[j]; list[j] = x; render(); } }
            else if (t.dataset.dl) { const [id, j] = t.dataset.dl.split(':').map(Number); const it = list.find(x => x.id === id); if (it && it.outs[j]) saveBlob(toBlob(it.outs[j].data, it.outs[j].name), it.outs[j].name); }
        });
        // Hiện/ẩn tuỳ chọn phụ
        $('tl-mg-preset').addEventListener('change', e => updateMarginPreset(e.target.value));
        $('tl-mg-unit').addEventListener('change', e => {
            const oldUnit = $('tl-mg-unit-badge').textContent;
            const newUnit = e.target.value;
            $('tl-mg-unit-badge').textContent = newUnit;
            ['left', 'right', 'top', 'bottom'].forEach(k => {
                const el = $('tl-mg-' + k);
                const mm = toMm(el.value, oldUnit);
                el.value = fromMm(mm, newUnit);
            });
            renderMarginPreview();
        });
        $('tl-mg-mode').addEventListener('change', renderMarginPreview);
        $('tl-mg-mirror').addEventListener('change', onMirrorChange);
        ['left', 'right', 'top', 'bottom'].forEach(k => {
            $('tl-mg-' + k).addEventListener('input', () => {
                $('tl-mg-preset').value = 'custom';
                renderMarginPreview();
            });
        });
        $('tl-mg-align').addEventListener('change', renderMarginPreview);
        $('tl-mg-toggle-page-btn').addEventListener('click', () => {
            mgPreviewEven = !mgPreviewEven;
            onMirrorChange();
        });
        $('tl-mg-scope').addEventListener('change', () => {
            $('tl-mg-pages-row').style.display = $('tl-mg-scope').value === 'custom' ? '' : 'none';
        });
        $('tl-split-mode').addEventListener('change', () => {
            const m = $('tl-split-mode').value;
            $('tl-split-ranges-row').style.display = (m === 'ranges' || m === 'extract') ? '' : 'none';
            $('tl-split-n-row').style.display = m === 'every' ? '' : 'none';
        });
        $('tl-pw-mode').addEventListener('change', () => {
            const s = $('tl-pw-mode').value === 'set';
            $('tl-pw-set').style.display = s ? '' : 'none'; $('tl-pw-rm').style.display = s ? 'none' : '';
        });
        $('tl-meta-mode').addEventListener('change', () => { $('tl-meta-edit').style.display = $('tl-meta-mode').value === 'edit' ? '' : 'none'; });
        $('tl-wm-type').addEventListener('change', () => {
            const t = $('tl-wm-type').value === 'text';
            $('tl-wm-text-row').style.display = t ? '' : 'none'; $('tl-wm-img-row').style.display = t ? 'none' : '';
            if (!t && $('tl-wm-rot').value === '45') $('tl-wm-rot').value = '0';
            if (t && $('tl-wm-rot').value === '0') $('tl-wm-rot').value = '45';
        });
        $('tl-bm-load').addEventListener('click', async () => {
            const it = lists.pdf[0];
            if (!it) { alert('Hãy chọn file PDF trước.'); return; }
            try {
                const doc = await openPdfJs(it);
                const outline = await doc.getOutline();
                if (!outline || !outline.length) { alert('File này chưa có mục lục.'); doc.destroy(); return; }
                const lines = [];
                const walk = async (items, lv) => {
                    for (const o of items) {
                        let dest = o.dest;
                        try {
                            if (typeof dest === 'string') dest = await doc.getDestination(dest);
                            if (Array.isArray(dest)) {
                                const pi = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0];
                                lines.push('-'.repeat(lv) + o.title.replace(/\|/g, '/') + ' | ' + (pi + 1));
                            }
                        } catch (e) {}
                        if (o.items && o.items.length) await walk(o.items, lv + 1);
                    }
                };
                await walk(outline, 0);
                doc.destroy();
                $('tl-bm-text').value = lines.join('\n');
            } catch (e) { alert('Không đọc được mục lục: ' + e.message); }
        });
        $('tl-bm-pages').addEventListener('click', () => {
            const it = lists.pdf[0];
            if (!it || !it.pages || it.pages === '?') { alert('Hãy chọn file PDF trước.'); return; }
            const a = []; for (let i = 1; i <= it.pages; i++) a.push('Trang ' + i + ' | ' + i);
            $('tl-bm-text').value = a.join('\n');
        });
        selectTool('split');
    }
    init();
    window._tl = { TOOLS, lists, addFiles, run, selectTool, parseBookmarks };
})();
