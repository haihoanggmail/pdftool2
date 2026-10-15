/* =========================================================================
   Chế độ xem NHIỀU TRANG liên tục (giống Word) cho tab "Chỉnh sửa PDF".

   - Tất cả trang được xếp trong một lưới; số cột tự tính theo độ rộng khung
     và mức zoom: đủ chỗ 2 trang thì hiện 2 trang, đủ chỗ nhiều trang thì hiện
     nhiều trang trên một hàng (Ctrl + cuộn chuột để phóng to / thu nhỏ).
   - Trang đang chỉnh sửa (editorPage) vẫn là "trang sống" đầy đủ chức năng
     (#editor-page-shell được dời vào đúng ô của trang đó).
   - Các trang còn lại là bản xem trước, chỉ vẽ khi cuộn tới (lazy), có hiển
     thị phần chữ/hình đã sửa. Bấm vào trang nào thì trang đó thành trang đang sửa.
   ========================================================================= */
(function () {
    'use strict';

    var GAP_X = 18, GAP_Y = 30, MAX_COLS = 12;

    var grid = null, stage = null, shell = null;
    var slots = [];            // slots[i] ứng với trang i+1
    var sizes = [];            // sizes[i] = { w, h } ở scale 1
    var boundDoc = null;       // PDFDocument đang được dựng lưới
    var lastActive = 0;
    var lastScale = 0;
    var io = null;
    var visible = new Set();   // các ô đang gần khung nhìn
    var layoutSeq = 0;

    function $(id) { return document.getElementById(id); }

    /* ---------- kích thước các trang ---------- */
    async function loadSizes(doc) {
        var n = doc.numPages, out = new Array(n), i, j;
        for (i = 0; i < n; i += 24) {
            var batch = [];
            for (j = i; j < Math.min(n, i + 24); j++) {
                batch.push((function (k) {
                    return doc.getPage(k + 1).then(function (p) {
                        var vp = p.getViewport({ scale: 1 });
                        out[k] = { w: vp.width, h: vp.height };
                    }).catch(function () { out[k] = null; });
                })(j));
            }
            await Promise.all(batch);
        }
        var fb = out.find(Boolean) || { w: 595, h: 842 };
        return out.map(function (s) { return s || fb; });
    }

    /* ---------- dựng khung lưới ---------- */
    function ensureGrid() {
        stage = document.querySelector('.editor-stage-scroll');
        shell = $('editor-page-shell');
        if (!stage || !shell) return false;
        if (!grid) {
            grid = document.createElement('div');
            grid.id = 'mp-grid';
            stage.appendChild(grid);
            stage.classList.add('mp-on');
            stage.addEventListener('scroll', onScroll, { passive: true });
            window.addEventListener('resize', function () { schedule(); });
        }
        return true;
    }

    function buildSlots(doc) {
        // đưa shell ra khỏi lưới trước khi xoá ô cũ
        if (shell && shell.parentNode !== stage) stage.appendChild(shell);
        grid.innerHTML = '';
        slots = [];
        visible.clear();
        if (io) io.disconnect();
        io = new IntersectionObserver(onIntersect, { root: stage, rootMargin: '900px 0px 900px 0px' });
        for (var i = 0; i < doc.numPages; i++) {
            var s = document.createElement('div');
            s.className = 'mp-slot';
            s.dataset.p = String(i + 1);
            s._tok = 0;
            s._scale = 0;
            s.addEventListener('mousedown', onSlotDown, true);
            grid.appendChild(s);
            slots.push(s);
            io.observe(s);
        }
    }

    function onIntersect(entries) {
        entries.forEach(function (en) {
            var s = en.target;
            if (en.isIntersecting) {
                visible.add(s);
                renderPreview(s);
            } else {
                visible.delete(s);
                releasePreview(s);
            }
        });
    }

    function onSlotDown(e) {
        var s = e.currentTarget;
        var p = parseInt(s.dataset.p, 10);
        if (p === editorPage || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        // kết thúc ô nhập chữ đang mở (nếu có) để lưu thay đổi
        var ae = document.activeElement;
        if (ae && ae.blur && ae.closest && ae.closest('#editor-text-layer')) ae.blur();
        editorPage = p;
        editorRenderPage();
    }

    /* ---------- bố cục ---------- */
    function layout() {
        if (!editorPdfJsDoc || !ensureGrid()) return;
        var doc = editorPdfJsDoc;
        var seq = ++layoutSeq;
        var go = function () {
            if (seq !== layoutSeq || doc !== editorPdfJsDoc) return;
            applyLayout(doc);
        };
        if (boundDoc !== doc) {
            boundDoc = doc;
            sizes = [];
            lastActive = 0;
            var base = editorViewport ? { w: editorViewport.width / editorScale, h: editorViewport.height / editorScale } : { w: 595, h: 842 };
            for (var i = 0; i < doc.numPages; i++) sizes.push(base);
            buildSlots(doc);
            applyLayout(doc);
            loadSizes(doc).then(function (sz) {
                if (doc !== editorPdfJsDoc) return;
                sizes = sz;
                go();
            });
        } else {
            go();
        }
    }

    function applyLayout(doc) {
        var cs = getComputedStyle(stage);
        var avail = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        var scale = editorScale;
        var maxW = 1;
        for (var i = 0; i < sizes.length; i++) maxW = Math.max(maxW, sizes[i].w * scale);
        var cols = Math.floor((avail + GAP_X) / (maxW + GAP_X));
        cols = Math.max(1, Math.min(MAX_COLS, cols, sizes.length));
        grid.style.gridTemplateColumns = 'repeat(' + cols + ', max-content)';
        grid.style.columnGap = GAP_X + 'px';
        grid.style.rowGap = GAP_Y + 'px';
        grid.dataset.cols = String(cols);

        var scaleChanged = Math.abs(scale - lastScale) > 1e-6;
        slots.forEach(function (s, idx) {
            var sz = sizes[idx] || sizes[0];
            var w = Math.round(sz.w * scale), h = Math.round(sz.h * scale);
            s.style.width = w + 'px';
            s.style.height = h + 'px';
            if (scaleChanged) s._scale = 0;     // bản xem trước cũ đã sai tỉ lệ
        });
        lastScale = scale;

        // đưa trang sống vào đúng ô
        var active = slots[editorPage - 1];
        slots.forEach(function (s) { s.classList.toggle('mp-active', s === active); });
        if (active) {
            if (shell.parentNode !== active) {
                // ô trang trước đó cần vẽ lại bản xem trước (đã có thể có chỉnh sửa)
                var prev = lastActive ? slots[lastActive - 1] : null;
                if (prev && prev !== active) { prev._scale = 0; clearPreview(prev); }
                clearPreview(active);
                active.appendChild(shell);
            }
            shell.style.display = 'inline-block';
        }

        // vẽ lại các ô đang nhìn thấy
        visible.forEach(function (s) { if (s !== active) renderPreview(s); });
        // trang trước đó vừa chuyển thành xem trước → vẽ lại nếu đang hiển thị
        updateIndicator();

        // chuyển trang bằng nút Trước/Sau / điều hướng: cuộn tới trang đó
        if (active && lastActive !== editorPage) {
            var first = lastActive === 0;
            lastActive = editorPage;
            scrollToSlot(active, first);
        }
        syncStatusBar();
        document.dispatchEvent(new CustomEvent('mp-layout', { detail: { cols: cols } }));
    }

    function scrollToSlot(slot, first) {
        var r = slot.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        var outside = r.top < sr.top || r.bottom > sr.bottom || first;
        if (!outside) return;
        var top = stage.scrollTop + (r.top - sr.top) - 16;
        var h = r.height, vh = stage.clientHeight;
        if (h < vh) top = stage.scrollTop + (r.top - sr.top) - (vh - h) / 2;
        stage.scrollTop = Math.max(0, top);
    }

    /* ---------- bản xem trước các trang không hoạt động ---------- */
    function clearPreview(slot) {
        var c = slot.querySelector('canvas.mp-prev');
        if (c) { c.width = 0; c.height = 0; c.remove(); }
    }
    function releasePreview(slot) {
        slot._tok++;
        if (slot.dataset.p === String(editorPage)) return;
        clearPreview(slot);
        slot._scale = 0;
    }

    async function renderPreview(slot) {
        var n = parseInt(slot.dataset.p, 10);
        var doc = editorPdfJsDoc;
        if (!doc || n === editorPage) return;
        var scale = editorScale;
        if (slot._scale === scale && slot.querySelector('canvas.mp-prev')) return;
        var tok = ++slot._tok;
        try {
            var page = await doc.getPage(n);
            if (tok !== slot._tok || doc !== editorPdfJsDoc) return;
            var vp = page.getViewport({ scale: scale });
            var cv = document.createElement('canvas');
            cv.className = 'mp-prev';
            cv.width = Math.max(1, Math.round(vp.width));
            cv.height = Math.max(1, Math.round(vp.height));
            await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
            if (tok !== slot._tok || doc !== editorPdfJsDoc) return;
            try { overlayEdits(cv, vp, n, scale); } catch (e) { console.warn('mp overlay', e); }
            if (tok !== slot._tok || n === editorPage) return;
            clearPreview(slot);
            slot.insertBefore(cv, slot.firstChild);
            slot._scale = scale;
        } catch (e) {
            if (e && e.name !== 'RenderingCancelledException') console.warn('mp preview', e);
        }
    }

    // Vẽ gần đúng phần đã sửa lên bản xem trước (trang đang sửa luôn chính xác)
    function overlayEdits(cv, vp, n, scale) {
        var ctx = cv.getContext('2d');
        var pre = n + '_';

        modifiedTexts.forEach(function (m) {
            if (!m || m.page !== n && String(m.key).indexOf(pre) !== 0) return;
            var o = vp.convertToViewportPoint(m.origX, m.origY);
            var oh = m.origHeight * scale, ow = m.origWidth * scale, pad = Math.max(2, oh * 0.15);
            ctx.fillStyle = m.bgColor || '#ffffff';
            ctx.fillRect(o[0] - pad, o[1] - oh - 2, ow + pad * 2, oh * 1.28 + 4);
            drawText(ctx, vp, m.text, m.x, m.y, m.fontSize || m.origHeight, scale, m, 1);
        });

        addedTexts.forEach(function (a) {
            if (a.page !== n) return;
            var k = 0.842;
            try { k = fontInfo(fontKeyOf(a)).k; } catch (e) {}
            drawText(ctx, vp, a.text, a.x, a.y, a.fontSize, scale, a, k);
        });

        editorShapes.forEach(function (sh) {
            if (sh.page !== n) return;
            ctx.beginPath();
            ctx.strokeStyle = sh.color;
            ctx.lineWidth = sh.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            drawSingleShape(ctx, sh);
        });
    }

    function drawText(ctx, vp, text, px, py, fontPt, scale, o, k) {
        if (!text) return;
        var p = vp.convertToViewportPoint(px, py);
        var fs = fontPt * scale;
        var fam = 'Arial';
        try { fam = fontCss(fontKeyOf(o)); } catch (e) {}
        ctx.save();
        ctx.fillStyle = o.color || '#000000';
        ctx.font = (o.isItalic ? 'italic ' : '') + (o.isBold ? '700 ' : '400 ') + fs + 'px ' + fam;
        ctx.textBaseline = 'top';
        var top = (k === 1) ? p[1] - fs : p[1] - k * fs;
        String(text).split('\n').forEach(function (line, i) {
            ctx.fillText(line, p[0], top + i * fs * 1.2);
        });
        ctx.restore();
    }

    // đồng bộ thanh trạng thái kiểu Word (zoom + số trang)
    function syncStatusBar() {
        var z = $('ws-zoom-text'), zl = $('editor-zoom-label'), pt = $('ws-page-text');
        if (z && zl) z.textContent = zl.textContent;
        if (pt && editorPdfJsDoc) pt.textContent = 'Trang ' + editorPage + ' / ' + editorPdfJsDoc.numPages;
    }

    /* ---------- trang hiện tại theo vị trí cuộn ---------- */
    function updateIndicator() {
        var el = $('editor-page-indicator');
        if (!el || !editorPdfJsDoc) return;
        var cur = pageInView();
        el.innerText = cur + ' / ' + editorPdfJsDoc.numPages;
    }
    function pageInView() {
        if (!slots.length) return editorPage;
        var sr = stage.getBoundingClientRect(), mid = sr.top + stage.clientHeight * 0.4, best = editorPage, bd = Infinity;
        for (var i = 0; i < slots.length; i++) {
            var r = slots[i].getBoundingClientRect();
            if (r.bottom < sr.top - 50) continue;
            if (r.top > sr.bottom + 50) break;
            var d = (mid >= r.top && mid <= r.bottom) ? 0 : Math.min(Math.abs(mid - r.top), Math.abs(mid - r.bottom));
            if (d < bd) { bd = d; best = i + 1; if (d === 0) break; }
        }
        return best;
    }
    var scrollTimer = 0;
    function onScroll() {
        if (scrollTimer) return;
        scrollTimer = setTimeout(function () { scrollTimer = 0; updateIndicator(); }, 80);
    }

    var layoutTimer = 0;
    function schedule() {
        clearTimeout(layoutTimer);
        layoutTimer = setTimeout(layout, 120);
    }

    /* ---------- móc vào các hàm có sẵn ---------- */
    var origRender = window.editorRenderPage;
    window.editorRenderPage = async function () {
        await origRender.apply(this, arguments);
        try { layout(); } catch (e) { console.warn('mp layout', e); }
    };

    // nút Trước / Sau: dựa trên trang đang sửa, vẫn giữ nguyên hành vi cũ
    window.mpLayout = layout;
    window.mpGetCols = function () { return grid ? parseInt(grid.dataset.cols || '1', 10) : 1; };
})();
