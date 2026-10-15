/* =========================================================================
   Chữ ký trong tab "Chỉnh sửa PDF": là ĐỐI TƯỢNG ĐỘC LẬP (không in vào PDF
   ngay). Kéo / đổi cỡ / xoá thoải mái, không cuốn theo chữ hay hình bên dưới.
   Chỉ khi xuất PDF mới được ghép vào trang (xem editorExportPDF).
   ========================================================================= */
(function () {
    'use strict';
    var SIG_DEFAULT_W = 130;               // pt (≈ 4,6 cm) – vừa phải, không quá to

    function trimPng(bytes) {
        return createImageBitmap(new Blob([bytes], { type: 'image/png' })).then(function (bmp) {
            var c = document.createElement('canvas');
            c.width = bmp.width; c.height = bmp.height;
            var g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(bmp, 0, 0);
            var w = c.width, h = c.height, d = g.getImageData(0, 0, w, h).data;
            var x0 = w, y0 = h, x1 = -1, y1 = -1, x, y;
            for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
                if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            }
            if (x1 < 0) return null;
            var pad = 3, cw = x1 - x0 + 1 + pad * 2, ch = y1 - y0 + 1 + pad * 2;
            var o = document.createElement('canvas');
            o.width = cw; o.height = ch;
            o.getContext('2d').drawImage(c, x0 - pad, y0 - pad, cw, ch, 0, 0, cw, ch);
            return { url: o.toDataURL('image/png'), w: cw, h: ch };
        });
    }

    // Thêm chữ ký vào trang đang sửa (gọi từ cửa sổ "Ký tên")
    window.editorAddSignature = async function (pngBytes) {
        if (!editorPdfJsDoc || !editorViewport) { alert('Hãy mở file PDF trước.'); return false; }
        var t = await trimPng(pngBytes);
        if (!t) { if (window.toast) window.toast('Chữ ký đang trống', 'warning'); return false; }
        var pageW = editorViewport.width / editorScale;
        var w = Math.min(SIG_DEFAULT_W, pageW * 0.4), h = w * t.h / t.w;
        // đặt ở giữa phần trang đang nhìn thấy để người dùng thấy ngay và kéo tới chỗ cần
        var shell = document.getElementById('editor-page-shell');
        var sc = document.querySelector('.editor-stage-scroll');
        var vx = editorViewport.width / 2, vy = editorViewport.height * 0.75;
        if (shell && sc) {
            var sr = shell.getBoundingClientRect(), cr = sc.getBoundingClientRect();
            var midY = (Math.max(sr.top, cr.top) + Math.min(sr.bottom, cr.bottom)) / 2 - sr.top;
            if (isFinite(midY)) vy = Math.min(editorViewport.height - h * editorScale, Math.max(0, midY - h * editorScale / 2)) + h * editorScale;
        }
        var p = editorViewport.convertToPdfPoint(vx - w * editorScale / 2, vy);
        var sig = { id: 'g' + (++editorSigSeq) + '_' + Date.now().toString(36), page: editorPage, x: p[0], y: p[1], w: w, h: h, url: t.url };
        editorSigs.push(sig);
        editorSigSel = sig.id;
        recordHistory();
        await editorRenderPage();
        return true;
    };

    window.buildSigBoxes = function (layer) {
        layer.querySelectorAll('.editor-sig-box').forEach(function (n) { n.remove(); });
        editorSigs.filter(function (g) { return g.page === editorPage; }).forEach(function (g) {
            var box = document.createElement('div');
            box.className = 'editor-sig-box' + (editorSigSel === g.id ? ' sel' : '');
            box.dataset.sigId = g.id;
            var img = document.createElement('img');
            img.src = g.url; img.draggable = false; img.alt = 'Chữ ký';
            var del = document.createElement('span'); del.className = 'sig-del'; del.textContent = '✕'; del.title = 'Xoá chữ ký';
            var rs = document.createElement('span'); rs.className = 'sig-rs'; rs.title = 'Kéo để đổi kích thước';
            box.appendChild(img); box.appendChild(del); box.appendChild(rs);
            layer.appendChild(box);

            function place() {
                var b = editorViewport.convertToViewportPoint(g.x, g.y);
                box.style.left = b[0] + 'px';
                box.style.top = (b[1] - g.h * editorScale) + 'px';
                box.style.width = (g.w * editorScale) + 'px';
                box.style.height = (g.h * editorScale) + 'px';
            }
            place();

            // không để lớp chữ / công cụ khác nhận sự kiện của chữ ký
            ['click', 'dblclick', 'mouseup', 'contextmenu'].forEach(function (ev) {
                box.addEventListener(ev, function (e) { e.stopPropagation(); });
            });
            box.addEventListener('pointerdown', function (e) {
                if (e.button !== 0) return;
                e.stopPropagation(); e.preventDefault();
                if (e.target === del) { removeSig(g.id); return; }
                editorSigSel = g.id;
                layer.querySelectorAll('.editor-sig-box').forEach(function (n) { n.classList.toggle('sel', n === box); });
                var resize = e.target === rs, sx = e.clientX, sy = e.clientY;
                var ox = g.x, oy = g.y, ow = g.w, moved = false;
                box.setPointerCapture(e.pointerId);
                var move = function (ev) {
                    var dx = (ev.clientX - sx) / editorScale, dy = (ev.clientY - sy) / editorScale;
                    if (!moved && Math.abs(ev.clientX - sx) < 2 && Math.abs(ev.clientY - sy) < 2) return;
                    moved = true;
                    var ar = g.h / g.w;
                    if (resize) {
                        g.w = Math.max(20, ow + dx); g.h = g.w * ar;
                    } else {
                        // pdf y hướng lên, màn hình hướng xuống
                        g.x = ox + dx; g.y = oy - dy;
                    }
                    place();
                };
                var up = function () {
                    box.removeEventListener('pointermove', move);
                    box.removeEventListener('pointerup', up);
                    box.removeEventListener('pointercancel', up);
                    if (moved) recordHistory();
                };
                box.addEventListener('pointermove', move);
                box.addEventListener('pointerup', up);
                box.addEventListener('pointercancel', up);
            });
        });
    };

    function removeSig(id) {
        var i = editorSigs.findIndex(function (s) { return s.id === id; });
        if (i === -1) return;
        editorSigs.splice(i, 1);
        if (editorSigSel === id) editorSigSel = null;
        recordHistory();
        editorRenderPage();
    }

    // nhấn Delete khi đang chọn chữ ký → xoá
    document.addEventListener('keydown', function (e) {
        if ((e.key !== 'Delete' && e.key !== 'Backspace') || !editorSigSel) return;
        var tab = document.getElementById('tab-editor');
        if (!tab || !tab.classList.contains('active')) return;
        var a = document.activeElement;
        if (a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)) return;
        e.preventDefault();
        removeSig(editorSigSel);
    });

    // bấm ra ngoài thì bỏ chọn
    document.addEventListener('pointerdown', function (e) {
        if (!editorSigSel || e.target.closest('.editor-sig-box')) return;
        editorSigSel = null;
        document.querySelectorAll('.editor-sig-box.sel').forEach(function (n) { n.classList.remove('sel'); });
    }, true);

    // ghép chữ ký vào PDF khi xuất
    window.editorDrawSigsOnPdf = async function (pdfDoc, pages) {
        var cache = {}, failed = 0;
        for (var i = 0; i < editorSigs.length; i++) {
            var g = editorSigs[i];
            try {
                var pg = pages[g.page - 1];
                if (!pg) throw new Error('Không tìm thấy trang ' + g.page);
                if (!cache[g.id]) cache[g.id] = await pdfDoc.embedPng(g.url);
                pg.drawImage(cache[g.id], { x: g.x, y: g.y, width: g.w, height: g.h });
            } catch (e) { failed++; console.error('Lỗi ghép chữ ký:', e); }
        }
        return failed;
    };
})();
