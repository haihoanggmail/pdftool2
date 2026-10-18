/* Web Worker xử lý PDF bằng pdf-lib (chạy ngoài luồng giao diện nên file lớn không làm treo tab).
   Giao thức:  main -> worker : { id, op, payload }
               worker -> main : { id, type:'progress', pct, msg }  |  { id, type:'done', bytes }  |  { id, type:'error', message }
   Hủy: bên main gọi worker.terminate() (dừng ngay lập tức, trả lại toàn bộ bộ nhớ). */
'use strict';

function ensureLib(needFontkit) {
    if (!self.PDFLib) importScripts('../vendor/pdf-lib.min.js');
    if (needFontkit && !self.fontkit) importScripts('../vendor/fontkit.umd.min.js');
}

function toU8(b) {
    if (b instanceof Uint8Array) return b;
    return new Uint8Array(b);
}

// Lật nội dung trang theo chiều ngang (dùng cho "đối xứng 2 mặt")
function mirrorPageContent(page) {
    const mb = page.getMediaBox();
    page.node.normalize();
    page.getContentStream();
    const start = page.createContentStream(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(-1, 0, 0, 1, 2 * mb.x + mb.width, 0));
    const end = page.createContentStream(PDFLib.popGraphicsState());
    page.node.wrapContentStreams(page.doc.context.register(start), page.doc.context.register(end));
    page.getContentStream(false);
}

// ---------- Gộp nhiều file ----------
async function opMerge(p, progress) {
    ensureLib(false);
    const PDFDocument = PDFLib.PDFDocument;
    const out = await PDFDocument.create();
    const files = p.files, n = files.length;
    const BATCH = 40;                         // sao chép từng lô trang để có tiến trình và không giữ quá nhiều trang trung gian
    for (let i = 0; i < n; i++) {
        const base = (i / n) * 92, span = 92 / n;
        progress(base, 'Đang đọc ' + (files[i].name || ('file ' + (i + 1))) + ' (' + (i + 1) + '/' + n + ')...');
        const src = await PDFDocument.load(toU8(files[i].bytes));
        const total = src.getPageCount();
        for (let s = 0; s < total; s += BATCH) {
            const idx = [];
            for (let k = s; k < Math.min(total, s + BATCH); k++) idx.push(k);
            const pages = await out.copyPages(src, idx);
            pages.forEach(function (pg) { out.addPage(pg); });
            progress(base + span * Math.min(1, (s + BATCH) / total), 'Đang gộp ' + (files[i].name || ('file ' + (i + 1))) + ': trang ' + Math.min(total, s + BATCH) + '/' + total);
        }
        files[i].bytes = null;                // giải phóng sớm
    }
    progress(94, 'Đang ghi file kết quả...');
    return await out.save();
}

// ---------- Dựng lại PDF: sắp xếp / xoay / lật / watermark ----------
async function opRebuild(p, progress) {
    ensureLib(!!(p.wm && p.fontBytes));
    const PDFDocument = PDFLib.PDFDocument;
    progress(2, 'Đang đọc tài liệu...');
    const src = await PDFDocument.load(toU8(p.bytes));
    const out = await PDFDocument.create();
    let font = null;
    if (p.wm && p.fontBytes) {
        out.registerFontkit(self.fontkit);
        font = await out.embedFont(toU8(p.fontBytes), { subset: true });
    }
    const order = p.pageOrder, n = order.length, BATCH = 40;
    const pages = [];
    for (let s = 0; s < n; s += BATCH) {
        const idx = order.slice(s, s + BATCH);
        const part = await out.copyPages(src, idx);
        part.forEach(function (pg) { pages.push(pg); });
        progress(5 + 45 * Math.min(1, (s + BATCH) / n), 'Đang sao chép trang ' + Math.min(n, s + BATCH) + '/' + n + '...');
    }
    for (let i = 0; i < n; i++) {
        const page = pages[i];
        const rot = (p.rotations && p.rotations[i]) || 0;
        if (p.mirrors && p.mirrors[i]) mirrorPageContent(page);
        page.setRotation(PDFLib.degrees(0));
        if (font && p.wm) {
            const wm = p.wm, sz = page.getSize();
            let x = wm.relLeft / 100 * sz.width;
            let y = sz.height - wm.relTop / 100 * sz.height;
            if (rot === 90 || rot === 270) { x = wm.relTop / 100 * sz.width; y = sz.height - wm.relLeft / 100 * sz.height; }
            page.drawText(wm.text, {
                x: x, y: y, size: wm.size, font: font,
                color: PDFLib.rgb(wm.color.r, wm.color.g, wm.color.b),
                rotate: PDFLib.degrees(-wm.rotation),
                opacity: wm.opacity
            });
        }
        page.setRotation(PDFLib.degrees(rot));
        out.addPage(page);
        if (i % 10 === 0 || i === n - 1) progress(50 + 42 * ((i + 1) / n), 'Đang xử lý trang ' + (i + 1) + '/' + n + '...');
    }
    p.bytes = null;
    progress(94, 'Đang ghi file kết quả...');
    return await out.save();
}

const OPS = { merge: opMerge, rebuild: opRebuild };

self.onmessage = async function (ev) {
    const m = ev.data || {};
    const progress = function (pct, msg) { self.postMessage({ id: m.id, type: 'progress', pct: Math.max(0, Math.min(100, pct)), msg: msg }); };
    try {
        const fn = OPS[m.op];
        if (!fn) throw new Error('Thao tác không hỗ trợ: ' + m.op);
        const bytes = await fn(m.payload, progress);
        const copy = bytes.buffer.byteLength === bytes.length ? bytes : bytes.slice();   // bảo đảm buffer chỉ chứa đúng dữ liệu
        self.postMessage({ id: m.id, type: 'done', bytes: copy.buffer }, [copy.buffer]);
    } catch (e) {
        self.postMessage({ id: m.id, type: 'error', message: String((e && e.message) || e) });
    }
};
