// ===================== Lưu tự động phiên làm việc (IndexedDB) =====================
// Mục tiêu: nhấn F5 không bị mất file PDF và các thao tác đang làm.
// Nội dung file chỉ nằm trong trình duyệt của người dùng, không gửi đi đâu.
// (Chỉ tên thao tác ẩn danh, ví dụ "save_pdf", được ghi thống kê; người dùng có thể tắt ở tab Giới Thiệu.)
(function () {
    'use strict';

    var DB_NAME = 'pdftool-session';
    var STORE = 'kv';
    var POLL_MS = 600;           // chu kỳ kiểm tra thay đổi (tương đương debounce ~0.5s)

    var db = null;
    var ready = false;           // chỉ ghi dữ liệu sau khi khôi phục xong
    var disabled = false;        // true khi đang xóa dữ liệu đã lưu
    var queue = Promise.resolve();
    var last = { main: null, editor: null, merge: null, state: null, cmp1: null, cmp2: null };

    if (!window.indexedDB) return;

    // ---------- Thông báo nhỏ ở góc màn hình ----------
    function notify(msg) {
        try {
            var el = document.getElementById('session-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'session-toast';
                el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10000;padding:10px 14px;' +
                    'background:#323130;color:#fff;border-radius:6px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.3);' +
                    'max-width:340px;transition:opacity .3s;';
                document.body.appendChild(el);
            }
            el.textContent = msg;
            el.style.opacity = '1';
            clearTimeout(el._t);
            el._t = setTimeout(function () { el.style.opacity = '0'; }, 5000);
        } catch (e) {}
    }

    // ---------- Các hàm IndexedDB cơ bản ----------
    function openDb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
            req.onblocked = function () { reject(new Error('IndexedDB bị chặn')); };
        });
    }

    function idbGet(key) {
        return new Promise(function (resolve, reject) {
            var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function idbPut(key, value) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
            tx.onabort = function () { reject(tx.error); };
        });
    }

    function idbClear() {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
            tx.onabort = function () { reject(tx.error); };
        });
    }

    // Ghi tuần tự để không bị lẫn thứ tự
    function enqueue(key, value) {
        queue = queue.then(function () { return idbPut(key, value); }).catch(function (err) {
            console.warn('Không lưu được "' + key + '":', err);
            if (err && err.name === 'QuotaExceededError') {
                notify('Không đủ dung lượng để lưu tự động. Hãy xuất file kết quả sớm.');
            }
        });
    }

    // ---------- Đọc/ghi giá trị trên giao diện ----------
    function elv(id) { var e = document.getElementById(id); return e ? e.value : null; }
    function elc(id) { var e = document.getElementById(id); return e ? !!e.checked : false; }
    function elt(id) { var e = document.getElementById(id); return e ? e.innerText : ''; }
    function setv(id, v) { var e = document.getElementById(id); if (e && v !== null && v !== undefined) e.value = v; }
    function setc(id, v) { var e = document.getElementById(id); if (e) e.checked = !!v; }
    function setStatus(id, text) {
        var e = document.getElementById(id);
        if (!e || !text) return;
        e.innerText = text;
        e.style.color = 'var(--success)';
    }

    function activeTabId() {
        var t = document.querySelector('.tab-content.active');
        return t ? t.id : 'tab-main';
    }

    // ---------- Gom trạng thái nhỏ (không gồm dữ liệu file) ----------
    function collectState() {
        return {
            tab: activeTabId(),
            main: {
                name: mainFileName,
                label: elt('file-status'),
                rotations: pageRotations,
                mirrors: pageMirrors,
                order: pageOrder,
                start: currentPageStartIndex,
                viewMode: elv('view-mode'),
                pages: elv('pages-input')
            },
            wm: {
                enable: elc('wm-enable'), text: elv('wm-text'), size: elv('wm-size'),
                color: elv('wm-color'), rotation: elv('wm-rotation'), opacity: elv('wm-opacity'),
                bold: elc('wm-bold'), italic: elc('wm-italic'),
                left: wmRelativeLeft, top: wmRelativeTop
            },
            editor: {
                name: editorFileName,
                label: elt('editor-file-status'),
                page: editorPage,
                scale: editorScale,
                texts: modifiedTexts,
                images: modifiedImages,
                added: addedTexts,
                // Bỏ "vp" (đối tượng viewport của pdf.js), sẽ dựng lại khi khôi phục
                shapes: editorShapes.map(function (s) {
                    var c = Object.assign({}, s);
                    delete c.vp;
                    return c;
                }),
                seq: editorSeq,
                addedSeq: addedIdSeq
            },
            compare: {
                page: currentComparePage,
                max: maxComparePages,
                l1: elt('compare-status-1'),
                l2: elt('compare-status-2')
            }
        };
    }

    function mergeSig() {
        return mergeFilesArray.map(function (f) {
            return f.name + ':' + f.pageCount + ':' + f.bytes.length;
        }).join('|');
    }

    // ---------- Kiểm tra thay đổi và lưu ----------
    function tick() {
        if (!ready || disabled || !db) return;
        try {
            if (originalPdfBytes && originalPdfBytes !== last.main) {
                last.main = originalPdfBytes;
                enqueue('main-bytes', originalPdfBytes);
            }
            if (editorPdfDataBytes && editorPdfDataBytes !== last.editor) {
                last.editor = editorPdfDataBytes;
                enqueue('editor-bytes', editorPdfDataBytes);
            }
            var ms = mergeSig();
            if (ms !== last.merge) {
                last.merge = ms;
                enqueue('merge', mergeFilesArray.map(function (f) {
                    return { name: f.name, pageCount: f.pageCount, bytes: f.bytes };
                }));
            }
            // Tab So sánh: lấy lại dữ liệu gốc từ đối tượng pdf.js
            if (compareDoc1 && compareDoc1 !== last.cmp1) {
                last.cmp1 = compareDoc1;
                compareDoc1.getData().then(function (b) { enqueue('compare-1', b); }).catch(function () {});
            }
            if (compareDoc2 && compareDoc2 !== last.cmp2) {
                last.cmp2 = compareDoc2;
                compareDoc2.getData().then(function (b) { enqueue('compare-2', b); }).catch(function () {});
            }
            var st = collectState();
            var sig = JSON.stringify(st);
            if (sig !== last.state) {
                last.state = sig;
                enqueue('state', st);
            }
        } catch (e) {
            console.warn('Lỗi khi lưu phiên:', e);
        }
    }

    // ---------- Khôi phục từng phần ----------
    async function restoreMain(state) {
        var m = state.main;
        var bytes = await idbGet('main-bytes');
        if (!bytes || !m) return;

        // Khôi phục cài đặt đóng dấu bản quyền trước khi vẽ lưới trang
        var w = state.wm;
        if (w) {
            setv('wm-text', w.text); setv('wm-size', w.size); setv('wm-color', w.color);
            setv('wm-rotation', w.rotation); setv('wm-opacity', w.opacity);
            setc('wm-bold', w.bold); setc('wm-italic', w.italic); setc('wm-enable', w.enable);
            if (typeof w.left === 'number') wmRelativeLeft = w.left;
            if (typeof w.top === 'number') wmRelativeTop = w.top;
            toggleWatermarkMockup();
        }
        setv('pages-input', m.pages);

        originalPdfBytes = bytes;
        mainFileName = m.name || '';
        setStatus('file-status', m.label);

        // Đối chiếu số trang để tránh lệch nếu lần trước đang tải dở file
        var doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        var n = doc.numPages;
        var okLen = m.order && m.rotations && m.mirrors &&
            m.order.length === n && m.rotations.length === n && m.mirrors.length === n;
        if (okLen) {
            pageOrder = m.order; pageRotations = m.rotations; pageMirrors = m.mirrors;
        } else {
            var lib = await PDFLib.PDFDocument.load(bytes.slice(0));
            pageOrder = []; pageRotations = []; pageMirrors = [];
            for (var i = 0; i < n; i++) {
                pageOrder.push(i);
                pageRotations.push(lib.getPages()[i].getRotation().angle);
                pageMirrors.push(false);
            }
        }
        historyStack = [];
        var undoBtn = document.getElementById('undo-btn');
        if (undoBtn) undoBtn.disabled = true;

        // Chế độ xem (giống updateViewMode nhưng giữ nguyên vị trí trang đang xem)
        if (m.viewMode) {
            setv('view-mode', m.viewMode);
            var container = document.getElementById('grid-container');
            if (m.viewMode === '1') container.style.gridTemplateColumns = 'repeat(1, 1fr)';
            else if (m.viewMode === '2' || m.viewMode === '4') container.style.gridTemplateColumns = 'repeat(2, 1fr)';
            else container.style.gridTemplateColumns = 'repeat(4, 1fr)';
        }
        currentPageStartIndex = m.start || 0;
        renderGrid();
    }

    async function restoreMerge() {
        var list = await idbGet('merge');
        if (!list || !list.length) return;
        mergeFilesArray = list;
        renderMergeList();
    }

    async function restoreCompare(state) {
        var c = state.compare;
        var b1 = await idbGet('compare-1');
        var b2 = await idbGet('compare-2');
        if (!b1 && !b2) return;
        if (b1) {
            compareDoc1 = await pdfjsLib.getDocument({ data: b1.slice(0) }).promise;
            if (c) setStatus('compare-status-1', c.l1);
        }
        if (b2) {
            compareDoc2 = await pdfjsLib.getDocument({ data: b2.slice(0) }).promise;
            if (c) setStatus('compare-status-2', c.l2);
        }
        var p1 = compareDoc1 ? compareDoc1.numPages : 0;
        var p2 = compareDoc2 ? compareDoc2.numPages : 0;
        maxComparePages = Math.max(p1, p2);
        var cur = c && c.page ? c.page : 1;
        currentComparePage = Math.min(Math.max(cur, 1), Math.max(maxComparePages, 1));
        // Việc vẽ lại sẽ do switchTab() hoặc người dùng mở tab gọi renderCompare()
    }

    async function restoreEditor(state) {
        var e = state.editor;
        var bytes = await idbGet('editor-bytes');
        if (!bytes || !e) return;

        editorPdfDataBytes = bytes;
        editorFileName = e.name || '';
        modifiedTexts = e.texts || [];
        modifiedImages = e.images || [];
        addedTexts = e.added || [];
        editorShapes = e.shapes || [];
        editorScale = e.scale || 1.5;

        // Giữ bộ đếm id không bị trùng với dữ liệu đã có
        var maxSeq = e.seq || 0;
        modifiedTexts.concat(modifiedImages).forEach(function (o) { if (o && o._seq > maxSeq) maxSeq = o._seq; });
        editorSeq = maxSeq;
        var maxAdded = e.addedSeq || 0;
        addedTexts.forEach(function (o) {
            var k = parseInt(String(o.id || '').replace(/\D/g, ''), 10);
            if (k > maxAdded) maxAdded = k;
        });
        addedIdSeq = maxAdded;

        editorPdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
        editorPage = Math.min(Math.max(e.page || 1, 1), editorPdfJsDoc.numPages);

        // Dựng lại viewport cho từng hình vẽ (mỗi hình thuộc một trang riêng)
        var vpCache = {};
        for (var i = 0; i < editorShapes.length; i++) {
            var pn = editorShapes[i].page;
            if (!vpCache[pn]) {
                var pg = await editorPdfJsDoc.getPage(pn);
                vpCache[pn] = pg.getViewport({ scale: editorScale });
            }
            editorShapes[i].vp = vpCache[pn];
        }

        resetHistory();
        updateZoomLabel();
        setStatus('editor-file-status', e.label);
        document.getElementById('editor-empty').style.display = 'none';
        document.getElementById('editor-page-shell').style.display = 'inline-block';
        document.getElementById('editor-download-btn').disabled = false;
        initDrawCanvasEvents();
        if (activeTabId() === 'tab-editor') await editorRenderPage();
    }

    async function restore() {
        var state = await idbGet('state');
        if (!state) return;
        var failed = false;
        var steps = [
            ['trang chính', function () { return restoreMain(state); }],
            ['gộp file', function () { return restoreMerge(); }],
            ['so sánh', function () { return restoreCompare(state); }],
            ['chỉnh sửa', function () { return restoreEditor(state); }]
        ];
        for (var i = 0; i < steps.length; i++) {
            try { await steps[i][1](); }
            catch (err) {
                failed = true;
                console.warn('Không khôi phục được phần ' + steps[i][0] + ':', err);
            }
        }
        // Mở lại đúng tab đang dùng
        var tabId = state.tab || 'tab-main';
        var btn = document.querySelector('.tab-btn[onclick*="\'' + tabId + '\'"], .menu-item[onclick*="\'' + tabId + '\'"]');
        if (btn && tabId !== 'tab-main') switchTab(tabId, btn);
        if (failed) throw new Error('Khôi phục dở dang');
    }

    // ---------- Khởi động ----------
    async function init() {
        try {
            db = await openDb();
        } catch (e) {
            console.warn('Không mở được IndexedDB, bỏ qua lưu tự động:', e);
            return;
        }
        if (typeof pdfjsLib === 'undefined' || typeof PDFLib === 'undefined') return; // thiếu thư viện thì không đụng vào dữ liệu đã lưu
        try {
            await restore();
        } catch (e) {
            // Khôi phục lỗi: không ghi đè dữ liệu cũ để người dùng không mất thêm
            notify('Không khôi phục được toàn bộ phiên làm việc trước. Dữ liệu cũ được giữ nguyên.');
            return;
        }
        // Lấy mốc hiện tại để không ghi lại những gì vừa đọc ra
        last.main = originalPdfBytes;
        last.editor = editorPdfDataBytes;
        last.merge = mergeSig();
        last.cmp1 = compareDoc1;
        last.cmp2 = compareDoc2;
        last.state = JSON.stringify(collectState());
        ready = true;
        setInterval(tick, POLL_MS);
        window.addEventListener('beforeunload', tick);
        document.addEventListener('visibilitychange', function () { if (document.hidden) tick(); });
    }

    // Nút "Xóa dữ liệu đã lưu"
    window.clearSavedSession = async function () {
        if (!confirm('Xóa toàn bộ dữ liệu phiên làm việc đã lưu tự động và tải lại trang?')) return;
        disabled = true;
        try {
            await queue;
            if (db) await idbClear();
        } catch (e) {
            console.warn(e);
        }
        location.reload();
    };

    init();
})();
