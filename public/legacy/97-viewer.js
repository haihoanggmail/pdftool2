// ===================== Bộ xem trước PDF dùng chung =====================
// - Hiển thị nhiều trang liên tục, dựng ảnh trang theo nhu cầu (chỉ trang đang thấy)
// - Ctrl + cuộn chuột (hoặc chụm 2 ngón trên touchpad) để phóng to / thu nhỏ
// - "Vừa chiều rộng": 1 cột vừa chiều rộng khung | "Vừa trang": cả trang nằm gọn trong khung | "100%": kích thước thật
// - "Nhiều trang": tự chia cột để cả tài liệu vừa khung
// - Mọi con số phần trăm dùng chung quy ước của PDFZoom (05-core-utils.js): 100% = kích thước thật 96 dpi
(function () {
    const Z = window.PDFZoom;
    const PX_PER_PT = Z.PX_PER_PT;
    const GAP = 12, PAD = 14, MIN_MULTI_W = 96;

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    function create(area, opts) {
        opts = opts || {};
        const S = {
            doc: null, key: null, mode: opts.mode || 'width', zoom: 1.2, scale: 1,
            pages: [], cur: 1, vis: new Set(), pending: null, relayoutT: null, scrollRaf: 0
        };
        area.classList.add('hv-area');
        area.innerHTML = '';
        const box = el('div', 'hv-pages');
        const empty = el('div', 'hv-empty', opts.emptyText || 'Chưa có tài liệu để xem trước.');
        area.appendChild(box);
        area.appendChild(empty);

        // ---- thanh công cụ ----
        let bar = null, label = null;
        if (opts.toolbar !== false) {
            bar = el('div', 'hv-bar');
            bar.innerHTML =
                '<button type="button" class="btn btn-small" data-a="out" title="Thu nhỏ (Ctrl + cuộn xuống)">➖</button>' +
                '<span class="hv-zl" title="Mức thu phóng">100%</span>' +
                '<button type="button" class="btn btn-small" data-a="in" title="Phóng to (Ctrl + cuộn lên)">➕</button>' +
                '<button type="button" class="btn btn-small" data-a="width" title="Vừa chiều rộng khung">↔ Vừa chiều rộng</button>' +
                '<button type="button" class="btn btn-small" data-a="page" title="Cả trang nằm gọn trong khung">⛶ Vừa trang</button>' +
                '<button type="button" class="btn btn-small" data-a="actual" title="Kích thước thật (100%)">100%</button>' +
                '<button type="button" class="btn btn-small" data-a="multi" title="Hiện nhiều trang, tự co cho vừa khung">▦ Nhiều trang</button>';
            label = bar.querySelector('.hv-zl');
            bar.addEventListener('click', e => {
                const b = e.target.closest('button[data-a]');
                if (!b) return;
                const a = b.dataset.a;
                if (a === 'in') api.zoomStep(1);
                else if (a === 'out') api.zoomStep(-1);
                else api.setMode(a);
            });
            (opts.barParent || area.parentNode).insertBefore(bar, opts.barParent ? null : area);
        }

        // ---- bố cục ----
        function availSize() {
            return { w: Math.max(60, area.clientWidth - PAD * 2), h: Math.max(60, area.clientHeight - PAD * 2) };
        }
        function computeScale() {
            const n = S.pages.length;
            if (!n) return 1;
            const av = availSize();
            let maxW = 0, maxH = 0;
            S.pages.forEach(p => { maxW = Math.max(maxW, p.w); maxH = Math.max(maxH, p.h); });
            if (S.mode === 'width') return Z.fitWidth(maxW, av.w);
            if (S.mode === 'page') return Z.fitPage(maxW, maxH, av.w, av.h);
            if (S.mode === 'actual') return Z.actual();
            if (S.mode === 'multi') {
                let best = null;
                for (let c = 1; c <= n; c++) {
                    const s = (av.w - (c - 1) * GAP) / (c * maxW);
                    if (s * maxW < MIN_MULTI_W && c > 1) break;
                    const rows = Math.ceil(n / c);
                    best = Math.min(1.6, s);
                    if (rows * (maxH * best + GAP) - GAP <= av.h) return best;     // vừa cả khung
                }
                return best || 1;                                                  // quá nhiều trang: giữ cỡ nhỏ nhất, cho cuộn
            }
            return S.zoom;
        }
        function layout() {
            if (!S.pages.length) return;
            const ratio = area.scrollHeight > 0 ? (area.scrollTop + area.clientHeight / 2) / area.scrollHeight : 0;
            S.scale = Z.clamp(computeScale());
            S.pages.forEach(p => {
                p.el.style.width = Math.floor(p.w * S.scale) + 'px';
                p.el.style.height = Math.floor(p.h * S.scale) + 'px';
            });
            if (label) label.textContent = Z.label(S.scale);
            if (bar) {
                ['width', 'page', 'actual', 'multi'].forEach(m => {
                    const b = bar.querySelector('[data-a="' + m + '"]');
                    if (b) b.classList.toggle('hv-on', S.mode === m);
                });
            }
            area.classList.toggle('hv-multi', S.mode === 'multi');
            if (area.scrollHeight > area.clientHeight) area.scrollTop = Math.max(0, ratio * area.scrollHeight - area.clientHeight / 2);
            renderVisible();
        }
        function relayoutSoon() {
            clearTimeout(S.relayoutT);
            S.relayoutT = setTimeout(layout, 60);
        }

        // ---- dựng ảnh từng trang ----
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                const i = +en.target.dataset.i;
                if (en.isIntersecting) S.vis.add(i); else S.vis.delete(i);
            });
            renderVisible();
        }, { root: area, rootMargin: '700px 0px' });

        function renderVisible() {
            S.vis.forEach(i => renderPage(i));
        }
        async function renderPage(i) {
            const p = S.pages[i];
            if (!p || !S.doc) return;
            const want = Math.round(S.scale * 1000);
            if (p.drawn === want || p.drawing === want) return;
            p.drawing = want;
            const myDoc = S.doc;
            try {
                const page = await myDoc.getPage(i + 1);
                if (myDoc !== S.doc) return;
                const base = page.getViewport({ scale: 1 });
                if (!p.real || Math.abs(base.width - p.w) > 1 || Math.abs(base.height - p.h) > 1) {
                    p.real = true; p.w = base.width; p.h = base.height;
                    p.drawing = 0; relayoutSoon();
                    if (Math.abs(base.width - p.w) > 1) return;
                }
                if (p.drawing !== want) return;
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                let sc = S.scale * dpr;
                const maxPix = 28e6;
                if (base.width * base.height * sc * sc > maxPix) sc = Math.sqrt(maxPix / (base.width * base.height));
                const vp = page.getViewport({ scale: sc });
                const cv = document.createElement('canvas');
                cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
                cv.style.width = '100%'; cv.style.height = '100%';
                if (p.task) { try { p.task.cancel(); } catch (e) {} }
                p.task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
                await p.task.promise;
                if (myDoc !== S.doc || p.drawing !== want) return;
                if (p.cv) p.cv.remove();
                p.el.appendChild(cv); p.cv = cv; p.drawn = want;
                p.el.classList.add('hv-ready');
            } catch (e) {
                if (e && e.name === 'RenderingCancelledException') return;
                p.drawing = 0;
            }
        }

        // ---- trang hiện tại ----
        function updateCur() {
            S.scrollRaf = 0;
            if (!S.pages.length) return;
            const mid = area.scrollTop + area.clientHeight * 0.35;
            let best = 0, bd = 1e12;
            for (let i = 0; i < S.pages.length; i++) {
                const e = S.pages[i].el;
                const d = Math.abs(e.offsetTop + e.offsetHeight / 2 - mid);
                if (d < bd) { bd = d; best = i; }
                else if (e.offsetTop > mid + area.clientHeight) break;
            }
            if (S.cur !== best + 1) {
                S.cur = best + 1;
                if (opts.onPage) opts.onPage(S.cur, S.pages.length);
            }
        }
        area.addEventListener('scroll', () => { if (!S.scrollRaf) S.scrollRaf = requestAnimationFrame(updateCur); }, { passive: true });

        // ---- Ctrl + cuộn chuột ----
        area.addEventListener('wheel', e => {
            if (!(e.ctrlKey || e.metaKey) || !S.pages.length) return;
            e.preventDefault();
            if (S.mode !== 'zoom') { S.zoom = S.scale; S.mode = 'zoom'; }
            S.zoom = Z.wheel(S.zoom, e.deltaY);
            layout();
        }, { passive: false });
        if (typeof ResizeObserver !== 'undefined') {
            let first = true;
            new ResizeObserver(() => { if (first) { first = false; return; } if (S.mode !== 'zoom') relayoutSoon(); }).observe(area);
        }

        const api = {
            el: area, bar,
            hasDoc() { return !!S.doc; },
            getKey() { return S.key; },
            getPage() { return S.cur; },
            getMode() { return S.mode; },
            setDoc(doc, key, o) {
                o = o || {};
                if (S.doc === doc && S.key === key) return;
                io.disconnect();
                S.pages.forEach(p => { if (p.task) { try { p.task.cancel(); } catch (e) {} } });
                S.doc = doc; S.key = key; S.pages = []; S.vis.clear(); S.cur = 1;
                box.innerHTML = '';
                if (!doc) { empty.style.display = 'block'; if (opts.onPage) opts.onPage(0, 0); return; }
                empty.style.display = 'none';
                if (o.mode) S.mode = o.mode;
                const n = doc.numPages;
                const w0 = o.w || 595, h0 = o.h || 842;
                const frag = document.createDocumentFragment();
                for (let i = 0; i < n; i++) {
                    const pe = el('div', 'hv-page');
                    pe.dataset.i = i;
                    pe.appendChild(el('span', 'hv-num', String(i + 1)));
                    frag.appendChild(pe);
                    S.pages.push({ el: pe, w: w0, h: h0, real: false, drawn: 0, drawing: 0, cv: null, task: null });
                }
                box.appendChild(frag);
                // lấy kích thước thật của trang đầu để bố cục đúng ngay từ đầu
                doc.getPage(1).then(pg => {
                    if (doc !== S.doc) return;
                    const v = pg.getViewport({ scale: 1 });
                    S.pages.forEach(p => { if (!p.real) { p.w = v.width; p.h = v.height; } });
                    S.pages[0].real = true;
                    layout();
                    S.pages.forEach(p => io.observe(p.el));
                    area.scrollTop = 0;
                    if (opts.onPage) opts.onPage(1, n);
                }).catch(() => {});
            },
            clear() { api.setDoc(null, null); },
            setMode(m) { S.mode = m; layout(); },
            zoomBy(f) {
                if (S.mode !== 'zoom') { S.zoom = S.scale; S.mode = 'zoom'; }
                S.zoom = Z.clamp(S.zoom * f);
                layout();
            },
            zoomStep(dir) {
                if (S.mode !== 'zoom') { S.zoom = S.scale; S.mode = 'zoom'; }
                S.zoom = Z.step(S.zoom, dir);
                layout();
            },
            goto(n) {
                const p = S.pages[Math.max(1, Math.min(S.pages.length, n)) - 1];
                if (!p) return;
                area.scrollTo({ top: Math.max(0, p.el.offsetTop - PAD), behavior: 'smooth' });
            },
            relayout: layout
        };
        return api;
    }

    // ---------- Ctrl + cuộn cho khung đối chiếu (so sánh 2 file) ----------
    function bindCompareZoom() {
        const box = document.getElementById('compare-view-container');
        if (!box || box._hvZoom) return;
        box._hvZoom = true;
        let t = null;
        const apply = () => {
            clearTimeout(t);
            t = setTimeout(() => { if (typeof renderCompare === 'function') renderCompare(); }, 140);
        };
        const set = v => {
            if (typeof CMP === 'undefined') return;
            CMP.scale = Z.clamp(v);
            const l = document.getElementById('cmp-zoom-label');
            if (l) l.textContent = Z.label(CMP.scale);
            apply();
        };
        // lấy trang đầu + khung chứa để tính "vừa chiều rộng / vừa trang"
        const firstPage = () => {
            const d = (typeof compareDoc1 !== 'undefined' && compareDoc1) || (typeof compareDoc2 !== 'undefined' && compareDoc2);
            if (!d) return Promise.resolve(null);
            const ov = document.getElementById('overlay-mode');
            const overlayOn = !!(ov && ov.checked);
            const pane = overlayOn ? document.getElementById('compare-overlay-container') : document.getElementById('compare-pane-1');
            return d.getPage(1).then(pg => {
                const v = pg.getViewport({ scale: 1 });
                const wide = overlayOn ? 1 : 2;                 // 2 khung cạnh nhau: tính theo 1 khung
                const w = (pane && pane.clientWidth || box.clientWidth / wide) - 36;
                const h = (pane && pane.clientHeight || box.clientHeight) - 36;
                return { pw: v.width, ph: v.height, w: w, h: h };
            });
        };
        box.addEventListener('wheel', e => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            set(Z.wheel(CMP.scale, e.deltaY));
        }, { passive: false });
        window.cmpZoomBy = f => set(CMP.scale * f);
        window.cmpZoomStep = dir => set(Z.step(CMP.scale, dir));
        window.cmpZoomFit = () => { firstPage().then(g => { if (g) set(Z.fitWidth(g.pw, g.w)); }); };
        window.cmpZoomPage = () => { firstPage().then(g => { if (g) set(Z.fitPage(g.pw, g.ph, g.w, g.h)); }); };
        window.cmpZoom100 = () => set(Z.actual());
        // nhãn ban đầu phải khớp tỉ lệ thật
        const l0 = document.getElementById('cmp-zoom-label');
        if (l0 && typeof CMP !== 'undefined') l0.textContent = Z.label(CMP.scale);
    }

    // ---------- Khung xem trước nhiều trang đặt ngay dưới danh sách file (tab Word / Excel) ----------
    // items: mảng {id, file} do trang đặt vào window[key] mỗi lần vẽ lại danh sách
    function attachListPreview(listId, key) {
        const list = document.getElementById(listId);
        if (!list || list._hvLP) return;
        list._hvLP = true;
        const card = el('div', 'hv-lp');
        card.style.cssText = 'display:none; flex-direction:column; height:400px; min-height:260px; margin-top:10px;';
        card.innerHTML = '<div class="preview-header"><span class="merge-preview-title">XEM TRƯỚC</span><span class="hv-pg" style="font-weight:bold;font-size:13px;"></span></div><div class="merge-preview-area"></div>';
        list.parentNode.insertBefore(card, list.nextSibling);
        const head = card.firstChild, area = card.lastChild;
        let viewer = null, doc = null, selId = null, task = 0;
        async function update() {
            const items = window[key] || [];
            if (!items.length) { card.style.display = 'none'; if (viewer) viewer.clear(); selId = null; return; }
            if (typeof pdfjsLib === 'undefined') return;
            card.style.display = 'flex';
            if (!viewer) viewer = create(area, {
                emptyText: 'Bấm vào một file ở danh sách để xem trước.', barParent: head, mode: 'multi',
                onPage: (n, t) => { head.querySelector('.hv-pg').textContent = t ? n + ' / ' + t : ''; }
            });
            const it = items.find(x => x.id === selId) || items[0];
            selId = it.id;
            head.querySelector('.merge-preview-title').textContent = 'XEM TRƯỚC: ' + it.file.name;
            const k = it.id + ':' + it.file.size;
            if (viewer.getKey() === k) return;
            const my = ++task;
            try {
                const d = await pdfjsLib.getDocument({ data: new Uint8Array(await it.file.arrayBuffer()) }).promise;
                if (my !== task) { d.destroy(); return; }
                viewer.setDoc(d, k);
                if (doc) { const o = doc; setTimeout(() => o.destroy().catch(() => {}), 500); }
                doc = d;
            } catch (e) { viewer.clear(); }
        }
        new MutationObserver(update).observe(list, { childList: true });
        list.addEventListener('click', e => {
            if (e.target.closest('button,a,input,label')) return;
            const row = e.target.closest('#' + listId + ' > div');
            const idx = row ? Array.prototype.indexOf.call(list.children, row) : -1;
            const it = (window[key] || [])[idx];
            if (it && it.id !== selId) { selId = it.id; update(); }
        });
    }
    function bindListPreviews() {
        attachListPreview('w2d-list', '__hvItems_w2d');
        attachListPreview('w2x-list', '__hvItems_w2x');
    }

    window.HViewer = { create, bindCompareZoom, attachListPreview };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bindCompareZoom(); bindListPreviews(); });
    else { bindCompareZoom(); bindListPreviews(); }
})();
