// Bắt mọi lỗi không lường trước: báo nhẹ nhàng, KHÔNG làm dừng các chức năng khác.
(function installGlobalErrorGuard() {
    let last = 0;
    function toast(detail) {
        const now = Date.now();
        if (now - last < 4000) return;
        last = now;
        try {
            let el = document.getElementById('error-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'error-toast';
                el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:10001;padding:10px 14px;background:#c42b2b;color:#fff;border-radius:6px;font-size:13px;max-width:360px;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;transition:opacity .3s;';
                el.title = 'Bấm để ẩn';
                el.addEventListener('click', function () { el.style.opacity = '0'; });
                document.body.appendChild(el);
            }
            el.textContent = '⚠ Thao tác vừa rồi gặp lỗi' + (detail ? ': ' + String(detail).slice(0, 120) : '') + '. Bạn có thể thử lại, các chức năng khác vẫn dùng bình thường.';
            el.style.opacity = '1';
            clearTimeout(el._t);
            el._t = setTimeout(function () { el.style.opacity = '0'; }, 8000);
        } catch (e) {}
    }
    window.addEventListener('error', function (ev) {
        const m = ev && ev.message;
        if (!m || /ResizeObserver|^Script error\.?$/i.test(m)) return;
        console.error(ev.error || m);
        toast(m);
    });
    window.addEventListener('unhandledrejection', function (ev) {
        const r = ev && ev.reason;
        const m = (r && r.message) || String(r || '');
        if (/AbortError|RenderingCancelled|cancelled/i.test(m)) return;
        console.error(r);
        toast(m);
    });
})();

const missingLibs = [];

if (typeof PDFLib === 'undefined') missingLibs.push('pdf-lib');

if (typeof pdfjsLib === 'undefined') missingLibs.push('pdf.js');

if (typeof fontkit === 'undefined') missingLibs.push('fontkit (font tiếng Việt)');

if (missingLibs.length) {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:sticky;top:0;z-index:9999;padding:10px 16px;background:#c42b2b;color:#fff;font-weight:bold;text-align:center;';
    banner.textContent = 'Không tải được thư viện: ' + missingLibs.join(', ') + '. Hãy kiểm tra kết nối mạng, tắt trình chặn quảng cáo rồi tải lại trang (Ctrl+F5).';
    document.body.prepend(banner);
}

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️ Chế độ sáng' : '🌙 Chế độ tối';
}

function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
        localStorage.setItem('pdftool-theme', next);
    } catch (e) {}
}

applyTheme(document.documentElement.getAttribute('data-theme') || 'light');

(function initNoLogToggle() {
    const chk = document.getElementById('no-log-chk');
    if (!chk) return;
    try { chk.checked = localStorage.getItem('pdftool-no-log') === '1'; } catch (e) {}
    chk.addEventListener('change', function () {
        try { localStorage.setItem('pdftool-no-log', chk.checked ? '1' : '0'); } catch (e) {}
    });
})();

const FEEDBACK_EMBED_URL = '';

(function initFeedbackForm() {
    if (!FEEDBACK_EMBED_URL) return;
    const box = document.getElementById('feedback-box');
    if (!box) return;
    const f = document.createElement('iframe');
    f.src = FEEDBACK_EMBED_URL;
    f.width = '100%';
    f.height = '700';
    f.frameBorder = '0';
    f.style.cssText = 'border:1px solid #d2d0ce;border-radius:8px;background:#fff;';
    box.replaceWith(f);
})();

let originalPdfBytes = null;

let pageRotations = [];

let pageMirrors = [];

let pageOrder = [];

let historyStack = [];

let currentRenderTaskId = 0;

let currentPageStartIndex = 0;

let dragSourceIndex = null;

let mainFileName = '';

let editorFileName = '';

let wmRelativeLeft = 30;

let wmRelativeTop = 40;

let isDraggingWatermark = false;

let startX, startY;

let cachedUnicodeFontBytes = {
    regular: null,
    bold: null,
    italic: null,
    bolditalic: null
};

function closeMenus() { document.querySelectorAll('.nav-menu.open').forEach(function (m) { m.classList.remove('open'); }); }
function toggleMenu(id, btn) {
    var m = document.getElementById(id), was = m.classList.contains('open');
    closeMenus();
    if (was) return;
    var r = btn.getBoundingClientRect();
    m.style.top = (r.bottom + 2) + 'px';
    m.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 290)) + 'px';
    m.classList.add('open');
}
document.addEventListener('click', function (e) { if (!e.target.closest('.nav-menu') && !e.target.closest('.has-menu')) closeMenus(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });
window.addEventListener('resize', closeMenus);

function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn, .menu-item').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    closeMenus();
    if (btn) {
        btn.classList.add('active');
        if (btn.classList.contains('menu-item')) {
            var ow = document.getElementById(btn.closest('.nav-menu').dataset.owner);
            if (ow) ow.classList.add('active');
        }
    }
    if (tabId === 'tab-compare') setTimeout(renderCompare, 100);
    if (tabId === 'tab-merge') setTimeout(renderMergePreview, 100);
    if (tabId === 'tab-editor' && editorPdfJsDoc) setTimeout(editorRenderPage, 100);
}

function isImageFile(file) {
    return file && file.type && file.type.indexOf('image/') === 0;
}

function imageFileToPngBytes(file) {
    return new Promise(function(resolve, reject) {
        const url = URL.createObjectURL(file);
        const img = new Image;
        img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(function(blob) {
                const reader = new FileReader;
                reader.onload = function() {
                    URL.revokeObjectURL(url);
                    resolve(new Uint8Array(reader.result));
                };
                reader.onerror = function(e) {
                    URL.revokeObjectURL(url);
                    reject(e);
                };
                reader.readAsArrayBuffer(blob);
            }, 'image/png');
        };
        img.onerror = function(e) {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

function readFileAsBytes(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader;
        reader.onload = function() {
            resolve(new Uint8Array(reader.result));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

async function imageFileToPdfBytes(file) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    let embeddedImage;
    const rawBytes = await readFileAsBytes(file);
    const mime = (file.type || "").toLowerCase();
    try {
        if (mime === 'image/jpeg' || mime === 'image/jpg') {
            embeddedImage = await pdfDoc.embedJpg(rawBytes);
        } else if (mime === 'image/png') {
            embeddedImage = await pdfDoc.embedPng(rawBytes);
        } else {
            const pngBytes = await imageFileToPngBytes(file);
            embeddedImage = await pdfDoc.embedPng(pngBytes);
        }
    } catch (e) {
        const pngBytes = await imageFileToPngBytes(file);
        embeddedImage = await pdfDoc.embedPng(pngBytes);
    }
    const {width: width, height: height} = embeddedImage;
    const page = pdfDoc.addPage([ width, height ]);
    page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: width,
        height: height
    });
    return await pdfDoc.save();
}

async function fileToPdfBytes(file) {
    if (isImageFile(file)) {
        return await imageFileToPdfBytes(file);
    }
    return await readFileAsBytes(file);
}

function toggleWatermarkMockup() {
    const isEnabled = document.getElementById('wm-enable').checked;
    const settingsBlock = document.getElementById('wm-settings-block');
    const mockups = document.querySelectorAll('.mockup-watermark');
    if (isEnabled) {
        settingsBlock.style.display = "block";
        mockups.forEach(m => m.style.display = "block");
        document.querySelectorAll('.page-box').forEach(b => b.classList.remove('sortable-mode'));
    } else {
        settingsBlock.style.display = "none";
        mockups.forEach(m => m.style.display = "none");
        document.querySelectorAll('.page-box').forEach(b => b.classList.add('sortable-mode'));
    }
    updateWatermarkStyles();
}

function updateWatermarkStyles() {
    const input = document.getElementById('wm-text');
    const text = input.value;
    const size = document.getElementById('wm-size').value + "px";
    const color = document.getElementById('wm-color').value;
    const rotation = document.getElementById('wm-rotation').value + "deg";
    const opacity = document.getElementById('wm-opacity').value;
    const isBold = document.getElementById('wm-bold').checked;
    const isItalic = document.getElementById('wm-italic').checked;
    const mockups = document.querySelectorAll('.mockup-watermark');
    mockups.forEach(m => {
        m.innerText = text;
        m.style.fontSize = size;
        m.style.color = color;
        m.style.transform = `rotate(${rotation})`;
        m.style.opacity = opacity;
        m.style.fontWeight = isBold ? 'bold' : 'normal';
        m.style.fontStyle = isItalic ? 'italic' : 'normal';
        m.style.left = wmRelativeLeft + "%";
        m.style.top = wmRelativeTop + "%";
    });
}

function setupWatermarkDragging(mElement) {
    mElement.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        isDraggingWatermark = true;
        startX = e.clientX;
        startY = e.clientY;
        const wrapper = mElement.parentElement;
        const wrapperRect = wrapper.getBoundingClientRect();
        function onMouseMove(moveEvent) {
            if (!isDraggingWatermark) return;
            let deltaX = moveEvent.clientX - startX;
            let deltaY = moveEvent.clientY - startY;
            startX = moveEvent.clientX;
            startY = moveEvent.clientY;
            let currentLeftPx = parseFloat(mElement.style.left || 0) * wrapperRect.width / 100;
            let currentTopPx = parseFloat(mElement.style.top || 0) * wrapperRect.height / 100;
            let newLeftPx = currentLeftPx + deltaX;
            let newTopPx = currentTopPx + deltaY;
            wmRelativeLeft = newLeftPx / wrapperRect.width * 100;
            wmRelativeTop = newTopPx / wrapperRect.height * 100;
            updateWatermarkStyles();
        }
        function onMouseUp() {
            isDraggingWatermark = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function saveToHistory() {
    historyStack.push({
        rotations: [ ...pageRotations ],
        mirrors: [ ...pageMirrors ],
        order: [ ...pageOrder ]
    });
    document.getElementById('undo-btn').disabled = false;
}

function undo() {
    if (historyStack.length === 0) return;
    const state = historyStack.pop();
    pageRotations = state.rotations;
    pageMirrors = state.mirrors || state.rotations.map(() => false);
    pageOrder = state.order;
    if (historyStack.length === 0) document.getElementById('undo-btn').disabled = true;
    renderGrid();
}

async function loadPDF(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 150 * 1024 * 1024 && !confirm('File rất lớn (' + Math.round(file.size / 1048576) + ' MB), trình duyệt có thể chậm hoặc hết bộ nhớ. Vẫn tiếp tục?')) {
        input.value = '';
        return;
    }
    const statusEl = document.getElementById('file-status');
    let bytes, pdfDocLib;
    try {
        bytes = await fileToPdfBytes(file);
        pdfDocLib = await PDFLib.PDFDocument.load(bytes.slice(0));
    } catch (e) {
        const enc = /encrypt/i.test((e && e.message) || '');
        alert(enc
            ? 'File "' + file.name + '" có mật khẩu hoặc bị hạn chế quyền. Hãy vào "🧰 Công cụ PDF" → "🔒 Đặt / gỡ mật khẩu" để gỡ mật khẩu trước, rồi mở lại.'
            : 'Không thể đọc file "' + file.name + '": ' + ((e && e.message) || e));
        input.value = '';
        return;
    }
    mainFileName = file.name.replace(/\.pdf$/i, '');
    statusEl.innerText = "✓ " + file.name;
    statusEl.style.color = "var(--success)";
    originalPdfBytes = bytes;
    const pageCount = pdfDocLib.getPageCount();
    const libPages = pdfDocLib.getPages();
    pageRotations = [];
    pageOrder = [];
    pageMirrors = [];
    for (let i = 0; i < pageCount; i++) {
        pageOrder.push(i);
        pageRotations.push(libPages[i].getRotation().angle);
        pageMirrors.push(false);
    }
    historyStack = [];
    document.getElementById('undo-btn').disabled = true;
    currentPageStartIndex = 0;
    renderGrid();
}

function parsePagesInput(totalCount) {
    const inputStr = document.getElementById('pages-input').value.trim();
    if (!inputStr) return Array.from({
        length: totalCount
    }, (_, i) => i);
    let pages = new Set;
    const parts = inputStr.split(',');
    for (let part of parts) {
        part = part.trim();
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    if (i >= 1 && i <= totalCount) pages.add(i - 1);
                }
            }
        } else {
            const num = Number(part);
            if (!isNaN(num) && num >= 1 && num <= totalCount) pages.add(num - 1);
        }
    }
    return Array.from(pages).sort((a, b) => a - b);
}

async function rotate(angle) {
    if (!originalPdfBytes) {
        alert("Vui lòng mở file PDF trước!");
        return;
    }
    const targetPages = parsePagesInput(pageRotations.length);
    if (targetPages.length === 0) return;
    saveToHistory();
    targetPages.forEach(pIdx => {
        pageRotations[pIdx] = (pageRotations[pIdx] + angle) % 360;
        if (pageRotations[pIdx] < 0) pageRotations[pIdx] += 360;
    });
    renderGrid();
}

async function mirrorPages() {
    if (!originalPdfBytes) {
        alert("Vui lòng mở file PDF trước!");
        return;
    }
    const targetPages = parsePagesInput(pageMirrors.length);
    if (targetPages.length === 0) return;
    saveToHistory();
    targetPages.forEach(pIdx => {
        pageMirrors[pIdx] = !pageMirrors[pIdx];
    });
    renderGrid();
}

function updateViewMode() {
    const mode = document.getElementById('view-mode').value;
    const container = document.getElementById('grid-container');
    if (mode === "1") container.style.gridTemplateColumns = "repeat(1, 1fr)"; else if (mode === "2" || mode === "4") container.style.gridTemplateColumns = "repeat(2, 1fr)"; else container.style.gridTemplateColumns = "repeat(4, 1fr)";
    currentPageStartIndex = 0;
    renderGrid();
}

function changePageOffset(direction) {
    const mode = document.getElementById('view-mode').value;
    if (mode === "all" || !originalPdfBytes) return;
    let step = 1;
    if (mode === "2") step = 2; else if (mode === "4") step = 4;
    currentPageStartIndex += direction * step;
    if (currentPageStartIndex < 0) currentPageStartIndex = 0;
    renderGrid();
}

function handleDragStart(e) {
    if (document.getElementById('wm-enable').checked) return;
    dragSourceIndex = parseInt(this.getAttribute('data-index'));
    e.dataTransfer.effectAllowed = 'move';
    this.classList.add('dragging');
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    if (!document.getElementById('wm-enable').checked) this.classList.add('drag-over');
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation();
    this.classList.remove('drag-over');
    if (document.getElementById('wm-enable').checked) return;
    const dropTargetIndex = parseInt(this.getAttribute('data-index'));
    if (dragSourceIndex !== null && dragSourceIndex !== dropTargetIndex) {
        saveToHistory();
        const movedPage = pageOrder.splice(dragSourceIndex, 1)[0];
        pageOrder.splice(dropTargetIndex, 0, movedPage);
        const movedRotation = pageRotations.splice(dragSourceIndex, 1)[0];
        pageRotations.splice(dropTargetIndex, 0, movedRotation);
        const movedMirror = pageMirrors.splice(dragSourceIndex, 1)[0];
        pageMirrors.splice(dropTargetIndex, 0, movedMirror);
        renderGrid();
    }
    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.page-box').forEach(box => box.classList.remove('drag-over'));
}

async function renderGrid() {
    if (!originalPdfBytes) return;
    const taskId = ++currentRenderTaskId;
    const container = document.getElementById('grid-container');
    container.innerHTML = "";
    const mode = document.getElementById('view-mode').value;
    const loadingTask = pdfjsLib.getDocument({
        data: originalPdfBytes.slice(0)
    });
    const pdfjsDoc = await loadingTask.promise;
    if (taskId !== currentRenderTaskId) return;
    const totalPages = pdfjsDoc.numPages;
    let limit = totalPages, scaleFactor = .5;
    if (mode === "1") {
        limit = 1;
        scaleFactor = 1;
    } else if (mode === "2") {
        limit = 2;
        scaleFactor = .65;
    } else if (mode === "4") {
        limit = 4;
        scaleFactor = .45;
    }
    if (currentPageStartIndex >= totalPages) currentPageStartIndex = Math.max(0, totalPages - limit);
    let startPage = currentPageStartIndex + 1;
    let endPage = Math.min(currentPageStartIndex + limit, totalPages);
    const paginator = document.getElementById('pagination-ctrl');
    if (mode === "all") paginator.style.display = "none"; else {
        paginator.style.display = "flex";
        document.getElementById('page-indicator-text').innerText = `Trang ${startPage} - ${endPage} / ${totalPages}`;
        document.getElementById('prev-page-btn').disabled = startPage === 1;
        document.getElementById('next-page-btn').disabled = endPage === totalPages;
    }
    const wmEnabled = document.getElementById('wm-enable').checked;
    for (let i = startPage; i <= endPage; i++) {
        if (taskId !== currentRenderTaskId) return;
        const globalIndex = i - 1;
        const originalPageIndex = pageOrder[globalIndex] + 1;
        const page = await pdfjsDoc.getPage(originalPageIndex);
        const box = document.createElement('div');
        box.className = "page-box" + (!wmEnabled ? " sortable-mode" : "");
        box.draggable = !wmEnabled;
        box.setAttribute('data-index', globalIndex);
        box.addEventListener('dragstart', handleDragStart);
        box.addEventListener('dragover', handleDragOver);
        box.addEventListener('dragenter', handleDragEnter);
        box.addEventListener('dragleave', handleDragLeave);
        box.addEventListener('drop', handleDrop);
        box.addEventListener('dragend', handleDragEnd);
        const wrapper = document.createElement('div');
        wrapper.className = "canvas-wrapper";
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const currentRotation = pageRotations[globalIndex];
        const viewport = page.getViewport({
            scale: scaleFactor,
            rotation: currentRotation
        });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        wrapper.appendChild(canvas);
        const mWatermark = document.createElement('div');
        mWatermark.className = "mockup-watermark";
        setupWatermarkDragging(mWatermark);
        wrapper.appendChild(mWatermark);
        box.appendChild(wrapper);
        const info = document.createElement('div');
        info.className = "page-info";
        info.innerText = `Trang ${i}` + (pageMirrors[globalIndex] ? " (Lật)" : "");
        box.appendChild(info);
        container.appendChild(box);
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;
        if (pageMirrors[globalIndex]) {
            canvas.style.transform = "scaleX(-1)";
        } else {
            canvas.style.transform = "none";
        }
    }
    updateWatermarkStyles();
    if (wmEnabled) {
        document.querySelectorAll('.mockup-watermark').forEach(m => m.style.display = "block");
    }
}

function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    } : {
        r: 0,
        g: 0,
        b: 0
    };
}

function mirrorPageContent(page) {
    const mb = page.getMediaBox();
    page.node.normalize();
    page.getContentStream();
    const start = page.createContentStream(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(-1, 0, 0, 1, 2 * mb.x + mb.width, 0));
    const end = page.createContentStream(PDFLib.popGraphicsState());
    page.node.wrapContentStreams(page.doc.context.register(start), page.doc.context.register(end));
    page.getContentStream(false);
}

async function savePDF() {
    if (!originalPdfBytes) {
        alert('Hãy chọn file PDF trước khi lưu.');
        return;
    }
    logAction("save_pdf");
    try {
        await _savePDFCore();
    } catch (error) {
        console.error(error);
        alert('Lỗi lưu file: ' + ((error && error.message) ? error.message : String(error)));
    }
}

async function _savePDFCore() {
    const originalDoc = await PDFLib.PDFDocument.load(originalPdfBytes.slice(0));
    const mergedPdfDoc = await PDFLib.PDFDocument.create();
    if (typeof fontkit !== 'undefined') mergedPdfDoc.registerFontkit(fontkit);
    const copiedPages = await mergedPdfDoc.copyPages(originalDoc, pageOrder);
    const wmEnabled = document.getElementById('wm-enable').checked;
    const wmText = document.getElementById('wm-text').value;
    const wmSize = parseInt(document.getElementById('wm-size').value);
    const wmColorHex = document.getElementById('wm-color').value;
    const wmRotationDeg = parseInt(document.getElementById('wm-rotation').value);
    const wmOpacity = parseFloat(document.getElementById('wm-opacity').value);
    const isBold = document.getElementById('wm-bold').checked;
    const isItalic = document.getElementById('wm-italic').checked;
    const rgbColor = hexToRgb(wmColorHex);
    let fontStyle = "regular";
    if (isBold && isItalic) fontStyle = "bolditalic"; else if (isBold) fontStyle = "bold"; else if (isItalic) fontStyle = "italic";
    let chosenFont = null;
    if (wmEnabled && wmText.trim() !== "") {
        try {
            const fontBytes = await getUnicodeFontBytes(fontStyle);
            chosenFont = await mergedPdfDoc.embedFont(fontBytes, {
                subset: true
            });
        } catch (e) {
            console.warn("Không tải được font Unicode cho watermark:", e);
            alert("Không tải được font Unicode cho watermark. Vui lòng kiểm tra thư mục fonts hoặc kết nối mạng.");
            return;
        }
    }
    copiedPages.forEach((page, idx) => {
        const currentPageRotation = pageRotations[idx] || 0;
        if (pageMirrors[idx]) mirrorPageContent(page);
        page.setRotation(PDFLib.degrees(0));
        if (wmEnabled && wmText.trim() !== "") {
            const {width: width, height: height} = page.getSize();
            let pdfX = wmRelativeLeft / 100 * width;
            let pdfY = height - wmRelativeTop / 100 * height;
            if (currentPageRotation === 90 || currentPageRotation === 270) {
                pdfX = wmRelativeTop / 100 * width;
                pdfY = height - wmRelativeLeft / 100 * height;
            }
            let finalRotation = -wmRotationDeg;
            page.drawText(wmText, {
                x: pdfX,
                y: pdfY,
                size: wmSize,
                font: chosenFont,
                color: PDFLib.rgb(rgbColor.r, rgbColor.g, rgbColor.b),
                rotate: PDFLib.degrees(finalRotation),
                opacity: wmOpacity
            });
        }
        page.setRotation(PDFLib.degrees(currentPageRotation));
        mergedPdfDoc.addPage(page);
    });
    const modifiedPdfBytes = await mergedPdfDoc.save();
    const blob = new Blob([ modifiedPdfBytes ], {
        type: "application/pdf"
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const finalFileName = mainFileName ? `${mainFileName}_mod.pdf` : 'tai_lieu_edited.pdf';
    link.download = finalFileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

let mergeFilesArray = [];

function addMergeFiles(input) {
    const files = input.files;
    if (files.length === 0) return;
    const list = Array.from(files);
    Promise.all(list.map(async file => {
        try {
            const bytes = await fileToPdfBytes(file);
            const pdfDoc = await PDFLib.PDFDocument.load(bytes.slice(0));
            return {
                name: file.name,
                bytes: bytes,
                pageCount: pdfDoc.getPageCount()
            };
        } catch (e) {
            alert(`File "${file.name}" lỗi!`);
            return null;
        }
    })).then(results => {
        results.filter(Boolean).forEach(r => mergeFilesArray.push(r));
        input.value = "";
        renderMergeList();
    });
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

// ===================== Danh sách gộp + xem trước =====================
let mergeSelectedFile = null;      // file đang được chọn để xem trước (giữ theo đối tượng, không theo vị trí)
let mergePreviewPage = 1;
let mergePreviewTaskId = 0;
let mergePreviewKey = '';
let mergePreviewRenderTask = null;
const mergePreviewDocs = new WeakMap();   // fileObj -> Promise<pdfjs doc>
const mergeFileIds = new WeakMap();       // fileObj -> mã định danh riêng (không đổi khi đổi thứ tự)
let mergeFileIdSeq = 0;

function mergeFileId(fileObj) {
    if (!mergeFileIds.has(fileObj)) mergeFileIds.set(fileObj, ++mergeFileIdSeq);
    return mergeFileIds.get(fileObj);
}

function releaseMergePreviewDoc(fileObj) {
    const p = mergePreviewDocs.get(fileObj);
    if (!p) return;
    mergePreviewDocs.delete(fileObj);
    p.then(d => d.destroy()).catch(() => {});
}

function renderMergeList() {
    const container = document.getElementById('file-list-container');
    const submitBtn = document.getElementById('merge-submit-btn');
    // Nếu file đang chọn không còn trong danh sách thì chọn file đầu tiên
    if (mergeSelectedFile && mergeFilesArray.indexOf(mergeSelectedFile) === -1) mergeSelectedFile = null;
    if (!mergeSelectedFile && mergeFilesArray.length) {
        mergeSelectedFile = mergeFilesArray[0];
        mergePreviewPage = 1;
    }
    if (mergeFilesArray.length === 0) {
        container.innerHTML = `<div style="color:gray; font-style:italic; text-align:center; padding-top:40px;">Chưa chọn tệp tin nào.</div>`;
        submitBtn.disabled = true;
        renderMergePreview();
        return;
    }
    submitBtn.disabled = mergeFilesArray.length < 2;
    const oldScroll = container.scrollTop;
    container.innerHTML = "";
    mergeFilesArray.forEach((fileObj, idx) => {
        const item = document.createElement('div');
        item.className = "file-item" + (fileObj === mergeSelectedFile ? " selected" : "");
        item.title = "Nhấn để xem trước";
        item.innerHTML = `
                    <div class="file-item-info"><span class="file-item-name">${idx + 1}. ${escapeHtml(fileObj.name)}</span><span class="file-item-meta">Số trang: ${fileObj.pageCount} trang</span></div>
                    <div class="file-item-actions">
                        <button class="btn btn-small" onclick="moveMergeFile(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>▲</button>
                        <button class="btn btn-small" onclick="moveMergeFile(${idx}, 1)" ${idx === mergeFilesArray.length - 1 ? 'disabled' : ''}>▼</button>
                        <button class="btn btn-danger btn-small" onclick="deleteMergeFile(${idx})">❌</button>
                    </div>`;
        item.addEventListener('click', e => {
            if (e.target.closest('button')) return;
            selectMergeFile(idx);
        });
        container.appendChild(item);
    });
    container.scrollTop = oldScroll;
    renderMergePreview();
}

function selectMergeFile(index) {
    const f = mergeFilesArray[index];
    if (!f) return;
    if (mergeSelectedFile !== f) {
        mergeSelectedFile = f;
        mergePreviewPage = 1;
    }
    // Chỉ đổi màu chọn, không dựng lại danh sách để giữ vị trí cuộn
    document.querySelectorAll('#file-list-container .file-item').forEach((el, i) => {
        el.classList.toggle('selected', mergeFilesArray[i] === mergeSelectedFile);
    });
    renderMergePreview();
}

function changeMergePreviewPage(dir) {
    if (!mergeSelectedFile) return;
    const n = mergePreviewPage + dir;
    if (n < 1 || n > mergeSelectedFile.pageCount) return;
    mergePreviewPage = n;
    renderMergePreview();
}

async function renderMergePreview() {
    const area = document.getElementById('merge-preview-area');
    const canvas = document.getElementById('merge-preview-canvas');
    const empty = document.getElementById('merge-preview-empty');
    const title = document.getElementById('merge-preview-title');
    const indicator = document.getElementById('merge-page-indicator');
    const prevBtn = document.getElementById('merge-prev-btn');
    const nextBtn = document.getElementById('merge-next-btn');
    if (!area) return;
    const f = mergeSelectedFile;
    if (!f) {
        ++mergePreviewTaskId;
        mergePreviewKey = '';
        if (mergePreviewRenderTask) { try { mergePreviewRenderTask.cancel(); } catch (e) {} }
        canvas.style.display = 'none';
        empty.style.display = 'block';
        empty.textContent = 'Nhấn vào một file ở danh sách bên trái để xem trước.';
        title.textContent = 'XEM TRƯỚC';
        indicator.textContent = '0 / 0';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }
    const total = f.pageCount;
    if (mergePreviewPage > total) mergePreviewPage = total;
    if (mergePreviewPage < 1) mergePreviewPage = 1;
    title.textContent = 'XEM TRƯỚC: ' + f.name;
    indicator.textContent = `${mergePreviewPage} / ${total}`;
    prevBtn.disabled = mergePreviewPage <= 1;
    nextBtn.disabled = mergePreviewPage >= total;

    const availW = area.clientWidth - 30;
    if (availW < 50 || typeof pdfjsLib === 'undefined') return;   // tab đang ẩn: switchTab sẽ gọi lại
    const key = [ mergeFileId(f), mergePreviewPage, availW ].join('|');
    if (key === mergePreviewKey) return;
    const prevKeyFile = mergePreviewKey.split('|')[0];
    mergePreviewKey = key;
    const taskId = ++mergePreviewTaskId;
    if (mergePreviewRenderTask) { try { mergePreviewRenderTask.cancel(); } catch (e) {} }
    try {
        let docPromise = mergePreviewDocs.get(f);
        if (!docPromise) {
            docPromise = pdfjsLib.getDocument({ data: f.bytes.slice(0) }).promise;
            mergePreviewDocs.set(f, docPromise);
        }
        const doc = await docPromise;
        if (taskId !== mergePreviewTaskId) return;
        const page = await doc.getPage(mergePreviewPage);
        if (taskId !== mergePreviewTaskId) return;
        const base = page.getViewport({ scale: 1 });
        const cssScale = Math.min(availW / base.width, 3);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: cssScale * dpr });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = Math.floor(vp.width / dpr) + 'px';
        canvas.style.height = Math.floor(vp.height / dpr) + 'px';
        mergePreviewRenderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
        await mergePreviewRenderTask.promise;
        if (taskId !== mergePreviewTaskId) return;
        empty.style.display = 'none';
        canvas.style.display = 'block';
        if (key.split('|')[0] !== prevKeyFile) area.scrollTop = 0;
    } catch (e) {
        if (e && e.name === 'RenderingCancelledException') return;
        if (taskId !== mergePreviewTaskId) return;
        mergePreviewKey = '';
        mergePreviewDocs.delete(f);
        canvas.style.display = 'none';
        empty.style.display = 'block';
        empty.textContent = 'Không thể xem trước file này.';
        console.warn('Lỗi xem trước:', e);
    }
}

(function bindMergePreviewResize() {
    let t = null;
    window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => {
            const tab = document.getElementById('tab-merge');
            if (tab && tab.classList.contains('active')) renderMergePreview();
        }, 200);
    });
})();

function moveMergeFile(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= mergeFilesArray.length) return;
    const t = mergeFilesArray[index];
    mergeFilesArray[index] = mergeFilesArray[target];
    mergeFilesArray[target] = t;
    renderMergeList();
}

function deleteMergeFile(index) {
    const removed = mergeFilesArray[index];
    if (!removed) return;
    mergeFilesArray.splice(index, 1);
    releaseMergePreviewDoc(removed);
    if (removed === mergeSelectedFile) {
        // Chọn file liền kề thay thế
        mergeSelectedFile = mergeFilesArray[Math.min(index, mergeFilesArray.length - 1)] || null;
        mergePreviewPage = 1;
    }
    renderMergeList();
}

function clearMergeList() {
    mergeFilesArray.forEach(releaseMergePreviewDoc);
    mergeFilesArray = [];
    mergeSelectedFile = null;
    mergePreviewPage = 1;
    renderMergeList();
}

async function generateMergedPDF() {
    if (mergeFilesArray.length < 2) return;
    logAction("goppdf");
    try {
        await _generateMergedPDFCore();
    } catch (error) {
        console.error(error);
        alert('Lỗi gộp file: ' + ((error && error.message) ? error.message : String(error)));
    }
}

async function _generateMergedPDFCore() {
    const mergedPdfDoc = await PDFLib.PDFDocument.create();
    for (const fileObj of mergeFilesArray) {
        const sourcePdfDoc = await PDFLib.PDFDocument.load(fileObj.bytes.slice(0));
        const pageIndices = Array.from({
            length: fileObj.pageCount
        }, (_, i) => i);
        const copiedPages = await mergedPdfDoc.copyPages(sourcePdfDoc, pageIndices);
        copiedPages.forEach(page => {
            mergedPdfDoc.addPage(page);
        });
    }
    const modifiedPdfBytes = await mergedPdfDoc.save();
    const blob = new Blob([ modifiedPdfBytes ], {
        type: "application/pdf"
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'tai_lieu_gop_tong_hop.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

let compareDoc1 = null, compareDoc2 = null, currentComparePage = 0, maxComparePages = 0, compareRenderTaskId = 0;

async function loadCompareFile(input, fileNum) {
    logAction("compare_pdf");
    const file = input.files[0];
    if (!file) return;
    document.getElementById(`compare-status-${fileNum}`).innerText = "✓ " + file.name;
    document.getElementById(`compare-status-${fileNum}`).style.color = "var(--success)";
    try {
        const bytes = await fileToPdfBytes(file);
        const loadingTask = pdfjsLib.getDocument({
            data: bytes
        });
        if (fileNum === 1) compareDoc1 = await loadingTask.promise; else compareDoc2 = await loadingTask.promise;
        let p1 = compareDoc1 ? compareDoc1.numPages : 0;
        let p2 = compareDoc2 ? compareDoc2.numPages : 0;
        maxComparePages = Math.max(p1, p2);
        if (currentComparePage === 0 && maxComparePages > 0) currentComparePage = 1;
        renderCompare();
    } catch (e) {
        alert("Không thể đọc file này: " + e.message);
    }
}

function changeComparePage(dir) {
    let newPage = currentComparePage + dir;
    if (newPage >= 1 && newPage <= maxComparePages) {
        currentComparePage = newPage;
        renderCompare();
    }
}

function toggleOverlayMode() {
    const isOverlay = document.getElementById('overlay-mode').checked;
    const controlsGroup = document.getElementById('visibility-controls-group');
    const syncScrollLabel = document.getElementById('sync-scroll-label');
    const pane1 = document.getElementById('compare-pane-1'), pane2 = document.getElementById('compare-pane-2'), overlayContainer = document.getElementById('compare-overlay-container');
    if (isOverlay) {
        pane1.style.display = 'none';
        pane2.style.display = 'none';
        overlayContainer.style.display = 'block';
        controlsGroup.style.display = 'flex';
        syncScrollLabel.style.opacity = '0.3';
        applyViewFilter(document.querySelector('input[name="view-filter"]:checked').value);
    } else {
        pane1.style.display = 'block';
        pane2.style.display = 'block';
        overlayContainer.style.display = 'none';
        controlsGroup.style.display = 'none';
        syncScrollLabel.style.opacity = '1';
    }
}

function applyViewFilter(filterValue) {
    if (!document.getElementById('overlay-mode').checked) return;
    const cvA = document.getElementById('canvas-overlay-A'), cvB = document.getElementById('canvas-overlay-B');
    if (!cvA || !cvB) return;
    if (filterValue === 'only-A') {
        cvA.style.visibility = 'visible';
        cvA.style.opacity = '1';
        cvB.style.visibility = 'hidden';
    } else if (filterValue === 'only-B') {
        cvA.style.visibility = 'hidden';
        cvB.style.visibility = 'visible';
        cvB.style.opacity = '1';
    } else if (filterValue === 'both') {
        cvA.style.visibility = 'visible';
        cvA.style.opacity = '1';
        cvB.style.visibility = 'visible';
        cvB.style.opacity = '0.5';
    }
}

// ===================== So sánh tự động: ghép trang + so từng từ + so điểm ảnh =====================
const CMP = { pairs: null, d1: null, d2: null, results: {}, wordsCache: new WeakMap(), activeId: null, bgToken: 0, pendingFocus: null, wrapA: null, wrapB: null, wrapO: null, scale: 1.3 };
const CMP_COLORS = { added: '#22c55e', removed: '#ef4444', modified: '#f59e0b', moved: '#a855f7', style: '#3b82f6', visual: '#06b6d4', page: '#64748b' };
const CMP_LABEL = { added: 'Thêm', removed: 'Xóa', modified: 'Sửa', moved: 'Di chuyển', style: 'Cỡ chữ', visual: 'Hình/đồ họa', page: 'Trang' };

function cmpNorm(s) {
    return String(s).normalize('NFKC').replace(/[​-‏­﻿\u0000-\u001f\u{E000}-\u{F8FF}]/gu, '').toLowerCase();
}

async function cmpGetWords(doc, pageNo) {
    let m = CMP.wordsCache.get(doc);
    if (!m) { m = new Map(); CMP.wordsCache.set(doc, m); }
    if (m.has(pageNo)) return m.get(pageNo);
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
        if (!('str' in it) || !it.str || !it.str.trim()) continue;
        const t = pdfjsLib.Util.transform(vp.transform, it.transform);
        const fs = Math.hypot(t[2], t[3]) || it.height || 10;
        items.push({ str: it.str, x: t[4], yb: t[5], w: (it.width || 0) * vp.scale, fs: fs });
    }
    items.sort((a, b) => a.yb - b.yb || a.x - b.x);
    const lines = [];
    items.forEach(it => {
        const ln = lines[lines.length - 1];
        if (ln && Math.abs(it.yb - ln.yb) < Math.max(2, 0.5 * it.fs)) { ln.items.push(it); ln.yb = (ln.yb * (ln.items.length - 1) + it.yb) / ln.items.length; }
        else lines.push({ yb: it.yb, items: [it] });
    });
    const words = [];
    lines.forEach(ln => {
        ln.items.sort((a, b) => a.x - b.x);
        let prev = null, prevEnd = 0, prevItemEndsClean = false;
        ln.items.forEach(it => {
            const len = it.str.length || 1, re = /\S+/g;
            let mt, first = true;
            while ((mt = re.exec(it.str))) {
                const wx = it.x + (mt.index / len) * it.w, ww = (mt[0].length / len) * it.w;
                const word = { t: mt[0], x: wx, y: it.yb - it.fs * 0.95, w: ww, h: it.fs * 1.2, fs: it.fs };
                const startsClean = mt.index === 0;
                if (first && startsClean && prev && prevItemEndsClean && (it.x - prevEnd) < 0.2 * it.fs && (it.x - prevEnd) > -0.5 * it.fs) {
                    const x2 = Math.max(prev.x + prev.w, word.x + word.w);
                    prev.t += word.t; prev.w = x2 - prev.x;
                } else {
                    words.push(word); prev = word;
                }
                first = false;
            }
            prevEnd = it.x + it.w;
            prevItemEndsClean = !/\s$/.test(it.str);
            if (!first) { /* prev đã trỏ tới từ cuối */ }
        });
    });
    const out = [];
    words.forEach(w => { const k = cmpNorm(w.t); if (k.trim()) { w.k = k; out.push(w); } });
    const res = { words: out, W: vp.width, H: vp.height, hasText: out.length > 0, plain: out.slice(0, 500).map(w => w.k).join(' ') };
    m.set(pageNo, res);
    return res;
}

function cmpSimilarity(a, b, same) {
    if (!a.hasText && !b.hasText) return same ? 0.7 : 0.35;
    if (!a.hasText || !b.hasText) return 0.08;
    const A = new Set(a.plain.split(' ')), B = new Set(b.plain.split(' '));
    let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
    const union = new Set([...A, ...B]).size;
    return Math.min((union ? inter / union : 0) + (same ? 0.1 : 0), 1);
}

function cmpPairPages(sa, sb) {
    const ins = 0.8, R = sa.length + 1, C = sb.length + 1;
    const dp = Array.from({ length: R }, () => new Float64Array(C));
    const bt = Array.from({ length: R }, () => new Uint8Array(C)); // 0 match,1 left,2 right
    for (let i = 1; i < R; i++) { dp[i][0] = i * ins; bt[i][0] = 1; }
    for (let j = 1; j < C; j++) { dp[0][j] = j * ins; bt[0][j] = 2; }
    const simCache = {};
    const sim = (i, j) => { const k = i + ',' + j; return simCache[k] !== undefined ? simCache[k] : (simCache[k] = cmpSimilarity(sa[i], sb[j], i === j)); };
    for (let i = 1; i < R; i++) for (let j = 1; j < C; j++) {
        const m = dp[i - 1][j - 1] + (1 - sim(i - 1, j - 1)), l = dp[i - 1][j] + ins, r = dp[i][j - 1] + ins;
        const mn = Math.min(m, l, r);
        dp[i][j] = mn; bt[i][j] = mn === m ? 0 : (mn === l ? 1 : 2);
    }
    const pairs = [];
    let i = sa.length, j = sb.length;
    while (i > 0 || j > 0) {
        const d = bt[i][j];
        if (i > 0 && j > 0 && d === 0) { pairs.push({ l: i, r: j, conf: sim(i - 1, j - 1) }); i--; j--; }
        else if (i > 0 && (j === 0 || d === 1)) { pairs.push({ l: i, r: null, conf: 0 }); i--; }
        else { pairs.push({ l: null, r: j, conf: 0 }); j--; }
    }
    return pairs.reverse();
}

async function ensureComparePairs() {
    if (CMP.pairs && CMP.d1 === compareDoc1 && CMP.d2 === compareDoc2) return;
    CMP.d1 = compareDoc1; CMP.d2 = compareDoc2; CMP.results = {}; CMP.bgToken++; CMP.activeId = null;
    const sig = async doc => {
        const out = [];
        if (!doc) return out;
        for (let p = 1; p <= doc.numPages; p++) out.push(await cmpGetWords(doc, p));
        return out;
    };
    const sa = await sig(compareDoc1), sb = await sig(compareDoc2);
    if (compareDoc1 && compareDoc2) CMP.pairs = cmpPairPages(sa, sb);
    else if (compareDoc1) CMP.pairs = sa.map((s, i) => ({ l: i + 1, r: null, conf: 0 }));
    else CMP.pairs = sb.map((s, i) => ({ l: null, r: i + 1, conf: 0 }));
    maxComparePages = CMP.pairs.length;
    if (currentComparePage < 1) currentComparePage = 1;
    if (currentComparePage > maxComparePages) currentComparePage = Math.max(maxComparePages, 1);
    cmpStartBackground();
}

function cmpDiffOps(a, b) {
    const na = a.length, nb = b.length;
    let s = 0;
    while (s < na && s < nb && a[s] === b[s]) s++;
    let ea = na, eb = nb;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const ops = [];
    for (let i = 0; i < s; i++) ops.push(0);
    const n = ea - s, m = eb - s;
    if (n === 0 || m === 0 || n * m > 16e6) {
        for (let i = 0; i < n; i++) ops.push(1);
        for (let j = 0; j < m; j++) ops.push(2);
    } else {
        const W = m + 1, dp = new Uint16Array((n + 1) * W);
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
            dp[i * W + j] = a[s + i] === b[s + j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (a[s + i] === b[s + j]) { ops.push(0); i++; j++; }
            else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { ops.push(1); i++; }
            else { ops.push(2); j++; }
        }
        while (i < n) { ops.push(1); i++; }
        while (j < m) { ops.push(2); j++; }
    }
    for (let i = ea; i < na; i++) ops.push(0);
    return ops;
}

function cmpGroupRects(words, W, H) {
    if (!words.length) return [];
    const sorted = words.slice().sort((p, q) => p.y - q.y || p.x - q.x);
    const groups = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
        const g = groups[groups.length - 1], last = g[g.length - 1], cur = sorted[i];
        if (Math.abs(cur.y - last.y) < Math.max(last.h * 0.6, 4) && cur.x <= last.x + last.w + last.h * 2) g.push(cur);
        else groups.push([cur]);
    }
    return groups.map(g => {
        const x0 = Math.min(...g.map(w => w.x)), y0 = Math.min(...g.map(w => w.y));
        const x1 = Math.max(...g.map(w => w.x + w.w)), y1 = Math.max(...g.map(w => w.y + w.h));
        return { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
    });
}

function cmpLongestCommon(D, E) {
    // đoạn con liên tiếp dài nhất giữa hai dãy từ (so theo khóa chuẩn hóa)
    let best = { len: 0, di: 0, ei: 0 };
    let prev = new Uint16Array(E.length + 1);
    for (let i = 1; i <= D.length; i++) {
        const cur = new Uint16Array(E.length + 1);
        for (let j = 1; j <= E.length; j++) {
            if (D[i - 1].k === E[j - 1].k) {
                cur[j] = prev[j - 1] + 1;
                if (cur[j] > best.len) best = { len: cur[j], di: i - cur[j], ei: j - cur[j] };
            }
        }
        prev = cur;
    }
    return best;
}

function cmpTextChanges(A, B) {
    const ops = cmpDiffOps(A.words.map(w => w.k), B.words.map(w => w.k));
    const styleGroups = {}, anchors = [];
    const blocks = [];
    let ai = 0, bi = 0, k = 0;
    const txt = ws => ws.map(w => w.t).join(' ');
    while (k < ops.length) {
        if (ops[k] === 0) {
            const wa = A.words[ai], wb = B.words[bi];
            if (wa && wb) {
                anchors.push({ ya: (wa.y + wa.h / 2) / A.H, yb: (wb.y + wb.h / 2) / B.H });
                if (Math.abs(wa.fs - wb.fs) > 0.5 && Math.abs(wa.fs - wb.fs) / Math.max(wa.fs, wb.fs) > 0.06) {
                    const key = wa.fs.toFixed(1) + '→' + wb.fs.toFixed(1);
                    (styleGroups[key] = styleGroups[key] || { a: [], b: [] });
                    styleGroups[key].a.push(wa); styleGroups[key].b.push(wb);
                }
            }
            ai++; bi++; k++; continue;
        }
        const a0 = ai, b0 = bi;
        while (k < ops.length && ops[k] !== 0) { if (ops[k] === 1) ai++; else bi++; k++; }
        blocks.push({ dw: A.words.slice(a0, ai), aw: B.words.slice(b0, bi) });
    }
    // Đoạn chữ (>= 4 từ liên tiếp) xuất hiện ở cả phía bị xóa và phía được thêm => đã di chuyển
    const result = [];
    for (let iter = 0; iter < 40; iter++) {
        let best = null;
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].dw.length < 4) continue;
            for (let j = 0; j < blocks.length; j++) {
                if (blocks[j].aw.length < 4) continue;
                const m = cmpLongestCommon(blocks[i].dw, blocks[j].aw);
                if (m.len >= 4 && (!best || m.len > best.len)) best = { i: i, j: j, len: m.len, di: m.di, ei: m.ei };
            }
        }
        if (!best) break;
        const dseg = blocks[best.i].dw.splice(best.di, best.len);
        const aseg = blocks[best.j].aw.splice(best.ei, best.len);
        result.push({ type: 'moved', before: txt(dseg), after: txt(aseg), bRects: cmpGroupRects(dseg, A.W, A.H), aRects: cmpGroupRects(aseg, B.W, B.H), bw: dseg.length, aw: aseg.length });
    }
    const changes = [];
    blocks.forEach(bl => {
        const dw = bl.dw, aw = bl.aw;
        if (dw.length && aw.length) {
            if (dw.map(w => w.k).join('') === aw.map(w => w.k).join('')) return;
            changes.push({ type: 'modified', before: txt(dw), after: txt(aw), bRects: cmpGroupRects(dw, A.W, A.H), aRects: cmpGroupRects(aw, B.W, B.H), bw: dw.length, aw: aw.length });
        } else if (dw.length) {
            changes.push({ type: 'removed', before: txt(dw), after: '', bRects: cmpGroupRects(dw, A.W, A.H), aRects: [], bw: dw.length, aw: 0 });
        } else if (aw.length) {
            changes.push({ type: 'added', before: '', after: txt(aw), bRects: [], aRects: cmpGroupRects(aw, B.W, B.H), bw: 0, aw: aw.length });
        }
    });
    // Di chuyển gần đúng (>= 80% từ trùng) giữa một đoạn xóa và một đoạn thêm
    const rem = changes.filter(c => c.type === 'removed'), add = changes.filter(c => c.type === 'added');
    const used = new Set();
    rem.forEach(r => {
        const rw = r.before.toLowerCase().split(/\s+/);
        if (rw.length < 3) return;
        let best = null, bestS = 0.8;
        add.forEach(a => {
            if (used.has(a)) return;
            const aw = a.after.toLowerCase().split(/\s+/), set = new Set(aw);
            let m = 0; rw.forEach(w => { if (set.has(w)) m++; });
            const sc = m / Math.max(rw.length, aw.length);
            if (sc > bestS) { bestS = sc; best = a; }
        });
        if (best) {
            used.add(best); used.add(r);
            result.push({ type: 'moved', before: r.before, after: best.after, bRects: r.bRects, aRects: best.aRects, bw: r.bw, aw: best.aw });
        }
    });
    changes.forEach(c => { if (!used.has(c)) result.push(c); });
    Object.keys(styleGroups).forEach(key => {
        const g = styleGroups[key];
        result.push({ type: 'style', before: txt(g.a.slice(0, 12)) + (g.a.length > 12 ? ' …' : ''), after: 'Cỡ chữ ' + key.replace('→', ' → '), bRects: cmpGroupRects(g.a, A.W, A.H), aRects: cmpGroupRects(g.b, B.W, B.H), bw: g.a.length, aw: g.b.length });
    });
    // sắp xếp theo vị trí xuất hiện trên trang
    const posOf = c => { const r = (c.bRects[0] || c.aRects[0]); return r ? r.y : 2; };
    result.sort((p, q) => posOf(p) - posOf(q));
    return { changes: result, anchors: anchors };
}

// Làm mờ nhẹ (dọc 5 hàng, ngang 3 cột): đường kẻ mảnh bị lệch phần lẻ điểm ảnh vẫn giữ tổng độ đậm như nhau
function cmpBlur(src, w, h) {
    const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
        let sum = 0, cnt = 0;
        for (let y = 0; y < Math.min(3, h); y++) { sum += src[(y * w + x) * 4 + c]; cnt++; }
        for (let y = 0; y < h; y++) {
            tmp[(y * w + x) * 4 + c] = Math.round(sum / cnt);
            const add = y + 3, rem = y - 2;
            if (add < h) { sum += src[(add * w + x) * 4 + c]; cnt++; }
            if (rem >= 0) { sum -= src[(rem * w + x) * 4 + c]; cnt--; }
        }
    }
    for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
            let sum = 0;
            for (let xx = x0; xx <= x1; xx++) sum += tmp[row + xx * 4 + c];
            out[row + x * 4 + c] = Math.round(sum / (x1 - x0 + 1));
        }
    }
    return out;
}

function cmpVisualChanges(cvA, cvB, A, B, anchors, textChanges) {
    const w = cvA.width, h = cvA.height, hB = cvB.height;
    if (Math.abs(w - cvB.width) > 2 || Math.abs(h - hB) > 2) {
        return [{ type: 'page', before: '', after: 'Hai trang có kích thước khác nhau nên không so được hình ảnh.', bRects: [], aRects: [], label: 'Khác kích thước trang' }];
    }
    const dA = cvA.getContext('2d').getImageData(0, 0, w, h).data;
    const dB = cvB.getContext('2d').getImageData(0, 0, cvB.width, hB).data;
    const wB = cvB.width;
    const bA = cmpBlur(dA, w, h), bB = cmpBlur(dB, wB, hB);
    // Dịch dọc theo từng hàng: lấy độ lệch của từ khớp gần nhất (bù trường hợp nội dung bị đẩy xuống/lên)
    const anc = (anchors || []).slice().sort((p, q) => p.ya - q.ya);
    const shift = new Int32Array(h);
    if (anc.length) {
        let ptr = 0;
        for (let y = 0; y < h; y++) {
            const fy = y / h;
            while (ptr + 1 < anc.length && Math.abs(anc[ptr + 1].ya - fy) <= Math.abs(anc[ptr].ya - fy)) ptr++;
            shift[y] = Math.round((anc[ptr].yb - anc[ptr].ya) * hB);
        }
    }
    const C = 8, gw = Math.ceil(w / C), gh = Math.ceil(h / C);
    const cnt = new Uint16Array(gw * gh);
    for (let y = 0; y < h; y++) {
        const y2 = y + shift[y];
        if (y2 < 0 || y2 >= hB) continue;
        const gy = (y / C | 0) * gw;
        for (let x = 0; x < w; x++) {
            const p = (y * w + x) * 4, q = (y2 * wB + x) * 4;
            let d = Math.abs(dA[p] - dB[q]) + Math.abs(dA[p + 1] - dB[q + 1]) + Math.abs(dA[p + 2] - dB[q + 2]);
            if (d > 90) {
                // Dung sai lệch dưới 1 điểm ảnh: đường kẻ/viền bị đẩy lệch phần lẻ pixel sẽ có mức xám khử răng cưa khác nhau.
                // So điểm A với khoảng [min,max] của vùng lân cận bên B (và ngược lại); chỉ báo khi nằm ngoài khoảng đó.
                let loR = 255, loG = 255, loB = 255, hiR = 0, hiG = 0, hiB = 0;
                for (let oy = -2; oy <= 2; oy++) {
                    const yy = y2 + oy;
                    if (yy < 0 || yy >= hB) continue;
                    for (let ox = -1; ox <= 1; ox++) {
                        const xx = x + ox;
                        if (xx < 0 || xx >= wB) continue;
                        const q2 = (yy * wB + xx) * 4;
                        if (dB[q2] < loR) loR = dB[q2]; if (dB[q2] > hiR) hiR = dB[q2];
                        if (dB[q2 + 1] < loG) loG = dB[q2 + 1]; if (dB[q2 + 1] > hiG) hiG = dB[q2 + 1];
                        if (dB[q2 + 2] < loB) loB = dB[q2 + 2]; if (dB[q2 + 2] > hiB) hiB = dB[q2 + 2];
                    }
                }
                const T = 35;
                let same = dA[p] >= loR - T && dA[p] <= hiR + T && dA[p + 1] >= loG - T && dA[p + 1] <= hiG + T && dA[p + 2] >= loB - T && dA[p + 2] <= hiB + T;
                if (same) {
                    // chiều ngược lại: điểm B phải nằm trong khoảng của vùng lân cận bên A (bắt được nét/hình chỉ có ở B)
                    let aloR = 255, aloG = 255, aloB = 255, ahiR = 0, ahiG = 0, ahiB = 0;
                    for (let oy = -2; oy <= 2; oy++) {
                        const yy = y + oy;
                        if (yy < 0 || yy >= h) continue;
                        for (let ox = -1; ox <= 1; ox++) {
                            const xx = x + ox;
                            if (xx < 0 || xx >= w) continue;
                            const q3 = (yy * w + xx) * 4;
                            if (dA[q3] < aloR) aloR = dA[q3]; if (dA[q3] > ahiR) ahiR = dA[q3];
                            if (dA[q3 + 1] < aloG) aloG = dA[q3 + 1]; if (dA[q3 + 1] > ahiG) ahiG = dA[q3 + 1];
                            if (dA[q3 + 2] < aloB) aloB = dA[q3 + 2]; if (dA[q3 + 2] > ahiB) ahiB = dA[q3 + 2];
                        }
                    }
                    same = dB[q] >= aloR - T && dB[q] <= ahiR + T && dB[q + 1] >= aloG - T && dB[q + 1] <= ahiG + T && dB[q + 2] >= aloB - T && dB[q + 2] <= ahiB + T;
                }
                if (!same && Math.abs(bA[p] - bB[q]) + Math.abs(bA[p + 1] - bB[q + 1]) + Math.abs(bA[p + 2] - bB[q + 2]) > 60) cnt[gy + (x / C | 0)]++;
            }
        }
    }
    // Với mỗi ô nghi khác biệt, thử dịch dọc thêm +-6 điểm ảnh: nếu có độ lệch nào khớp thì coi là cùng nội dung (chỉ bị xê dịch)
    const cellCount = (gx, gy, off) => {
        let n = 0;
        const y0 = gy * C, y1 = Math.min(h, y0 + C), x0 = gx * C, x1 = Math.min(w, x0 + C);
        for (let y = y0; y < y1; y++) {
            const y2 = y + shift[y] + off;
            if (y2 < 0 || y2 >= hB) continue;
            for (let x = x0; x < x1; x++) {
                const p = (y * w + x) * 4, q = (y2 * wB + x) * 4;
                if (Math.abs(dA[p] - dB[q]) + Math.abs(dA[p + 1] - dB[q + 1]) + Math.abs(dA[p + 2] - dB[q + 2]) > 90) n++;
            }
        }
        return n;
    };
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx;
        if (cnt[i] < 3) continue;
        let best = cnt[i];
        for (let off = -6; off <= 6 && best >= 3; off++) {
            if (off === 0) continue;
            const n = cellCount(gx, gy, off);
            if (n < best) best = n;
        }
        cnt[i] = best;
    }
    const ex = new Uint8Array(gw * gh);
    const mark = (P, isB) => {
        P.words.forEach(wd => {
            let yy = wd.y / P.H * h;
            if (isB) yy -= shift[Math.max(0, Math.min(h - 1, Math.round(yy)))] || 0;
            const x0 = Math.max(0, Math.floor(wd.x / P.W * w / C) - 1), x1 = Math.min(gw - 1, Math.floor((wd.x + wd.w) / P.W * w / C) + 1);
            const y0 = Math.max(0, Math.floor(yy / C) - 1), y1 = Math.min(gh - 1, Math.floor((yy + wd.h / P.H * h) / C) + 1);
            for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) ex[gy * gw + gx] = 1;
        });
    };
    mark(A, false); mark(B, true);
    // dải dòng chữ đã được báo là thay đổi: loại khỏi so hình (toàn bề ngang)
    (textChanges || []).forEach(c => {
        const band = (r, isB) => {
            let y0 = r.y * h, y1 = (r.y + r.h) * h;
            if (isB) { const sh = shift[Math.max(0, Math.min(h - 1, Math.round(y0)))] || 0; y0 -= sh; y1 -= sh; }
            const g0 = Math.max(0, Math.floor(y0 / C) - 1), g1 = Math.min(gh - 1, Math.floor(y1 / C) + 1);
            for (let gy = g0; gy <= g1; gy++) for (let gx = 0; gx < gw; gx++) ex[gy * gw + gx] = 1;
        };
        (c.bRects || []).forEach(r => band(r, false));
        (c.aRects || []).forEach(r => band(r, true));
    });
    const flag = new Uint8Array(gw * gh);
    for (let i = 0; i < flag.length; i++) if (cnt[i] >= 3 && !ex[i]) flag[i] = 1;
    const seen = new Uint8Array(gw * gh), comps = [];
    for (let i = 0; i < flag.length; i++) {
        if (!flag[i] || seen[i]) continue;
        const stack = [i]; seen[i] = 1;
        let minx = gw, miny = gh, maxx = 0, maxy = 0, n = 0;
        while (stack.length) {
            const c = stack.pop(), cx = c % gw, cy = (c / gw) | 0;
            n++; minx = Math.min(minx, cx); maxx = Math.max(maxx, cx); miny = Math.min(miny, cy); maxy = Math.max(maxy, cy);
            for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
                const ni = ny * gw + nx;
                if (flag[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
            }
        }
        if (n >= 3) comps.push({ minx, miny, maxx, maxy, n });
    }
    comps.sort((p, q) => q.n - p.n);
    const dark = (data, ww, x0, y0, x1, y1) => {
        let d = 0, t = 0;
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const p = (y * ww + x) * 4; t++; if (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < 200) d++; }
        return t ? d / t : 0;
    };
    return comps.slice(0, 20).map(c => {
        const x0 = Math.max(0, (c.minx - 1) * C), y0 = Math.max(0, (c.miny - 1) * C);
        const x1 = Math.min(w, (c.maxx + 2) * C), y1 = Math.min(h, (c.maxy + 2) * C);
        const ys = Math.max(0, Math.min(hB - 1, Math.round((y0 + y1) / 2) + (shift[Math.min(h - 1, Math.round((y0 + y1) / 2))] || 0)));
        const dy = ys - Math.round((y0 + y1) / 2);
        const by0 = Math.max(0, Math.min(hB - 1, y0 + dy)), by1 = Math.max(by0 + 1, Math.min(hB, y1 + dy));
        const fa = dark(dA, w, x0, y0, x1, y1), fb = dark(dB, wB, x0, by0, x1, by1);
        let label = 'Hình/đồ họa khác nhau';
        if (fa < 0.01 && fb >= 0.01) label = 'Thêm hình/đồ họa'; else if (fb < 0.01 && fa >= 0.01) label = 'Mất hình/đồ họa';
        return {
            type: 'visual', label: label, before: '', after: '',
            bRects: [{ x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h }],
            aRects: [{ x: x0 / w, y: by0 / hB, w: (x1 - x0) / w, h: (by1 - by0) / hB }]
        };
    });
}

async function cmpGetResult(idx) {
    let res = CMP.results[idx];
    if (res) return res;
    const pair = CMP.pairs[idx];
    res = { idx: idx, pair: pair, text: [], visual: null, changes: [] };
    if (pair.l && !pair.r) res.text = [{ type: 'page', label: 'Trang chỉ có ở File A', before: 'Trang ' + pair.l + ' không có trong File B', after: '', bRects: [], aRects: [] }];
    else if (!pair.l && pair.r) res.text = [{ type: 'page', label: 'Trang chỉ có ở File B', before: '', after: 'Trang ' + pair.r + ' không có trong File A', bRects: [], aRects: [] }];
    else {
        const A = await cmpGetWords(compareDoc1, pair.l), B = await cmpGetWords(compareDoc2, pair.r);
        res.A = A; res.B = B;
        const tr = cmpTextChanges(A, B);
        res.text = tr.changes; res.anchors = tr.anchors;
    }
    CMP.results[idx] = res;
    cmpFinalize(res);
    return res;
}

function cmpFinalize(res) {
    res.changes = res.text.concat(res.visual || []);
    res.changes.forEach((c, i) => { c.id = res.idx + '-' + i; });
}

async function cmpComputeVisual(res, cvA, cvB) {
    if (res.visual || !res.A || !res.B) return;
    res.visual = cmpVisualChanges(cvA, cvB, res.A, res.B, res.anchors, res.text);
    cmpFinalize(res);
}

async function cmpBackgroundVisual(res) {
    const pair = res.pair;
    if (res.visual || !pair.l || !pair.r) return;
    const mk = async (doc, no) => {
        const page = await doc.getPage(no), vp = page.getViewport({ scale: CMP.scale });
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        return cv;
    };
    const cvA = await mk(compareDoc1, pair.l), cvB = await mk(compareDoc2, pair.r);
    if (!res.visual) await cmpComputeVisual(res, cvA, cvB);
    cvA.width = 0; cvB.width = 0;
}

async function cmpStartBackground() {
    const token = ++CMP.bgToken;
    const total = CMP.pairs.length;
    const doVisual = total <= 60;
    for (let i = 0; i < total; i++) {
        if (token !== CMP.bgToken) return;
        try {
            const res = await cmpGetResult(i);
            if (doVisual) await cmpBackgroundVisual(res);
        } catch (e) { console.warn('So sánh nền lỗi ở cặp ' + (i + 1), e); }
        CMP.bgDone = i + 1;
        if (token === CMP.bgToken) cmpRenderPanel();
        await new Promise(r => setTimeout(r, 0));
    }
    CMP.bgDone = total;
    if (token === CMP.bgToken) cmpRenderPanel();
}

// ---------- Hiển thị ----------
function cmpEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function cmpShort(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
function cmpLabelOf(c) { return c.label || CMP_LABEL[c.type] || c.type; }

function cmpDrawHighlights() {
    document.querySelectorAll('.cmp-hl-layer').forEach(n => n.remove());
    const res = CMP.results[currentComparePage - 1];
    const auto = document.getElementById('cmp-auto');
    if (!res || (auto && !auto.checked)) return;
    const addLayer = (host, side) => {
        if (!host) return;
        const layer = document.createElement('div');
        layer.className = 'cmp-hl-layer';
        res.changes.forEach(c => {
            const rects = side === 'A' ? c.bRects : (side === 'B' ? c.aRects : c.bRects.concat(c.aRects));
            rects.forEach((r, ri) => {
                const col = CMP_COLORS[c.type] || '#64748b';
                const box = document.createElement('div');
                box.className = 'cmp-hl-box';
                box.setAttribute('data-cid', c.id);
                box.style.cssText = 'left:' + (r.x * 100) + '%;top:' + (r.y * 100) + '%;width:' + (r.w * 100) + '%;height:' + (r.h * 100) + '%;background:' + col + '47;border-color:' + col + ';';
                if (side === 'O' && ri < c.bRects.length && c.aRects.length) box.style.borderStyle = 'dashed';
                box.title = cmpLabelOf(c) + (c.before ? ': ' + cmpShort(c.before, 80) : '') + (c.after && c.type !== 'style' ? ' → ' + cmpShort(c.after, 80) : '');
                box.addEventListener('click', () => cmpFocusChange(c.id, true));
                layer.appendChild(box);
            });
        });
        host.appendChild(layer);
    };
    addLayer(CMP.wrapA, 'A');
    addLayer(CMP.wrapB, 'B');
    addLayer(CMP.wrapO, 'O');
}

function cmpRenderPanel() {
    const listEl = document.getElementById('cmp-list'), glob = document.getElementById('cmp-global'), info = document.getElementById('cmp-pairinfo');
    if (!listEl || !CMP.pairs) return;
    const idx = currentComparePage - 1, pair = CMP.pairs[idx];
    if (info && pair) {
        info.textContent = (pair.l ? 'File A: trang ' + pair.l : 'File A: (không có)') + '  ↔  ' + (pair.r ? 'File B: trang ' + pair.r : 'File B: (không có)') + (pair.l && pair.r ? ' • độ giống ' + Math.round(pair.conf * 100) + '%' : '');
    }
    // tổng quan
    let totalChanges = 0, pagesWith = [];
    for (let i = 0; i < CMP.pairs.length; i++) {
        const r = CMP.results[i];
        if (r && r.changes.length) { totalChanges += r.changes.length; pagesWith.push({ i: i, n: r.changes.length }); }
    }
    const done = CMP.bgDone || 0, total = CMP.pairs.length, finished = done >= total;
    let g = '';
    if (!compareDoc1 || !compareDoc2) g = 'Chọn đủ File A và File B để tự động phát hiện khác biệt.';
    else if (!finished) g = 'Đang phân tích ' + done + '/' + total + ' trang... Đã thấy ' + totalChanges + ' khác biệt.';
    else if (!totalChanges) g = '✓ Không phát hiện khác biệt nào giữa hai file.';
    else g = '⚠ Phát hiện ' + totalChanges + ' khác biệt ở ' + pagesWith.length + '/' + total + ' trang.';
    glob.innerHTML = '<div style="font-weight:600; margin-bottom:4px;">' + cmpEsc(g) + '</div>' +
        (pagesWith.length ? '<div style="display:flex; flex-wrap:wrap; gap:4px;">' + pagesWith.slice(0, 80).map(p => '<button class="btn btn-small" style="padding:2px 7px;' + (p.i === idx ? 'background:#f59e0b;' : '') + '" onclick="cmpGoPair(' + p.i + ')" title="' + p.n + ' khác biệt">Cặp ' + (p.i + 1) + ' (' + p.n + ')</button>').join('') + '</div>' : '');
    // danh sách của trang đang xem
    const res = CMP.results[idx];
    if (!res) { listEl.innerHTML = '<div class="editor-hint">Đang phân tích trang này...</div>'; return; }
    if (!res.changes.length) { listEl.innerHTML = '<div class="editor-hint" style="color:#107c41;">✓ Trang này giống nhau.</div>'; return; }
    listEl.innerHTML = res.changes.map(c => {
        const col = CMP_COLORS[c.type] || '#64748b';
        let body = '';
        if (c.type === 'modified' || c.type === 'moved') body = '<s style="opacity:.7">' + cmpEsc(cmpShort(c.before, 60)) + '</s> → <b>' + cmpEsc(cmpShort(c.after, 60)) + '</b>';
        else if (c.type === 'removed') body = '<s style="opacity:.7">' + cmpEsc(cmpShort(c.before, 90)) + '</s>';
        else if (c.type === 'added') body = '<b>' + cmpEsc(cmpShort(c.after, 90)) + '</b>';
        else if (c.type === 'style') body = cmpEsc(cmpShort(c.before, 40)) + ' (' + cmpEsc(c.after) + ')';
        else body = cmpEsc(c.before || c.after || '');
        return '<div class="cmp-row' + (CMP.activeId === c.id ? ' active' : '') + '" data-cid="' + c.id + '" onclick="cmpFocusChange(\'' + c.id + '\')">' +
            '<span class="cmp-dot" style="background:' + col + '"></span><div style="min-width:0;"><div style="font-size:11px; font-weight:700; color:' + col + ';">' + cmpEsc(cmpLabelOf(c)) + '</div><div style="font-size:12px; word-break:break-word;">' + body + '</div></div></div>';
    }).join('');
}

function cmpFocusChange(id, fromBox) {
    CMP.activeId = id;
    document.querySelectorAll('.cmp-row').forEach(r => r.classList.toggle('active', r.getAttribute('data-cid') === id));
    const boxes = Array.from(document.querySelectorAll('.cmp-hl-box[data-cid="' + id + '"]'));
    boxes.forEach(b => { b.classList.remove('cmp-flash'); void b.offsetWidth; b.classList.add('cmp-flash'); });
    const overlay = document.getElementById('overlay-mode').checked;
    const visibleBoxes = boxes.filter(b => b.offsetParent !== null);
    visibleBoxes.forEach(b => {
        const pane = b.closest('.compare-pane') || b.closest('.overlay-container');
        if (!pane) return;
        const pr = pane.getBoundingClientRect(), br = b.getBoundingClientRect();
        pane.scrollTop += (br.top - pr.top) - pane.clientHeight / 3;
        pane.scrollLeft += (br.left - pr.left) - pane.clientWidth / 3;
    });
    if (fromBox) {
        const row = document.querySelector('.cmp-row[data-cid="' + id + '"]');
        if (row) row.scrollIntoView({ block: 'nearest' });
    }
}

function cmpGoPair(i) {
    currentComparePage = i + 1;
    renderCompare();
}

async function cmpNavDiff(dir) {
    if (!CMP.pairs) return;
    const flat = [];
    CMP.pairs.forEach((p, i) => { const r = CMP.results[i]; if (r) r.changes.forEach(c => flat.push(c.id)); });
    if (!flat.length) return;
    let cur = flat.indexOf(CMP.activeId);
    if (cur < 0) {
        const pageIds = flat.filter(id => id.indexOf((currentComparePage - 1) + '-') === 0);
        cur = dir > 0 ? (pageIds.length ? flat.indexOf(pageIds[0]) - 1 : -1) : (pageIds.length ? flat.indexOf(pageIds[0]) : flat.length);
    }
    const nxt = flat[(cur + dir + flat.length) % flat.length];
    const pi = parseInt(nxt.split('-')[0], 10);
    if (pi !== currentComparePage - 1) {
        CMP.pendingFocus = nxt;
        currentComparePage = pi + 1;
        await renderCompare();
    } else {
        cmpFocusChange(nxt);
    }
}

function cmpToggleAuto() { cmpDrawHighlights(); }

async function renderCompare() {
    if (!compareDoc1 && !compareDoc2) return;
    const taskId = ++compareRenderTaskId;
    const indicator = document.getElementById('compare-page-indicator');
    const pane1 = document.getElementById('compare-pane-1'), pane2 = document.getElementById('compare-pane-2'), wrapperContent = document.getElementById('overlay-wrapper-content');
    const glob = document.getElementById('cmp-global');
    if (glob && !CMP.pairs) glob.textContent = 'Đang phân tích và ghép trang...';
    await ensureComparePairs();
    if (taskId !== compareRenderTaskId) return;
    indicator.innerText = `${currentComparePage} / ${maxComparePages}`;
    const pair = CMP.pairs[currentComparePage - 1];
    pane1.innerHTML = '';
    pane2.innerHTML = '';
    wrapperContent.innerHTML = '';
    CMP.wrapA = CMP.wrapB = null;
    CMP.wrapO = wrapperContent;
    if (!pair) return;
    const scaleFactor = CMP.scale;
    const tasks = [];
    let canvasA = null, canvasB = null;
    const placeholder = (pane, txt) => { pane.innerHTML = '<div style="color:gray; font-style:italic; margin-top:40px;">' + txt + '</div>'; };
    if (pair.l && compareDoc1) {
        const pageA = await compareDoc1.getPage(pair.l);
        if (taskId !== compareRenderTaskId) return;
        const vpA = pageA.getViewport({ scale: scaleFactor });
        const wrap = document.createElement('div');
        wrap.className = 'cmp-page';
        canvasA = document.createElement('canvas');
        canvasA.height = vpA.height;
        canvasA.width = vpA.width;
        wrap.appendChild(canvasA);
        pane1.appendChild(wrap);
        CMP.wrapA = wrap;
        tasks.push(pageA.render({ canvasContext: canvasA.getContext('2d'), viewport: vpA }).promise);
        const canvasOverlayA = document.createElement('canvas');
        canvasOverlayA.id = 'canvas-overlay-A';
        canvasOverlayA.className = 'overlay-canvas';
        canvasOverlayA.height = vpA.height;
        canvasOverlayA.width = vpA.width;
        wrapperContent.appendChild(canvasOverlayA);
        tasks.push(pageA.render({ canvasContext: canvasOverlayA.getContext('2d'), viewport: vpA }).promise);
    } else placeholder(pane1, compareDoc1 ? 'File A không có trang tương ứng.' : 'Đang chờ File A...');
    if (pair.r && compareDoc2) {
        const pageB = await compareDoc2.getPage(pair.r);
        if (taskId !== compareRenderTaskId) return;
        const vpB = pageB.getViewport({ scale: scaleFactor });
        const wrap = document.createElement('div');
        wrap.className = 'cmp-page';
        canvasB = document.createElement('canvas');
        canvasB.height = vpB.height;
        canvasB.width = vpB.width;
        wrap.appendChild(canvasB);
        pane2.appendChild(wrap);
        CMP.wrapB = wrap;
        tasks.push(pageB.render({ canvasContext: canvasB.getContext('2d'), viewport: vpB }).promise);
        const canvasOverlayB = document.createElement('canvas');
        canvasOverlayB.id = 'canvas-overlay-B';
        canvasOverlayB.className = 'overlay-canvas';
        canvasOverlayB.height = vpB.height;
        canvasOverlayB.width = vpB.width;
        wrapperContent.appendChild(canvasOverlayB);
        tasks.push(pageB.render({ canvasContext: canvasOverlayB.getContext('2d'), viewport: vpB }).promise);
    } else placeholder(pane2, compareDoc2 ? 'File B không có trang tương ứng.' : 'Đang chờ File B...');
    applyViewFilter(document.querySelector('input[name="view-filter"]:checked').value);
    try {
        const res = await cmpGetResult(currentComparePage - 1);
        if (taskId !== compareRenderTaskId) return;
        cmpDrawHighlights();
        cmpRenderPanel();
        await Promise.all(tasks);
        if (taskId !== compareRenderTaskId) return;
        if (canvasA && canvasB && !res.visual) {
            await cmpComputeVisual(res, canvasA, canvasB);
            if (taskId !== compareRenderTaskId) return;
            cmpDrawHighlights();
            cmpRenderPanel();
        }
        if (CMP.pendingFocus) { const f = CMP.pendingFocus; CMP.pendingFocus = null; cmpFocusChange(f); }
    } catch (e) {
        console.error('Lỗi so sánh tự động:', e);
    }
}

let isSyncingScroll = false;

function handleSyncScroll(paneIndex) {
    if (!document.getElementById('sync-scroll').checked || isSyncingScroll) return;
    isSyncingScroll = true;
    const paneA = document.getElementById('compare-pane-1'), paneB = document.getElementById('compare-pane-2');
    const source = paneIndex === 1 ? paneA : paneB, target = paneIndex === 1 ? paneB : paneA;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    setTimeout(() => {
        isSyncingScroll = false;
    }, 20);
}

let editorPdfDataBytes = null;

let editorPdfJsDoc = null;

let editorPage = 1;

let editorViewport = null;

let editorScale = 1.5;

let modifiedTexts = [];

let modifiedImages = [];

let editorSeq = 0;

let editorCurrentTool = 'text';

let editorShapes = [];
let editorSigs = [];
let editorSigSel = null;
let editorSigSeq = 0;

let isDrawingShape = false;

let brushSize = 3;

let currentDrawShape = null;
let isSelectingEditorRegion = false;
let editorSelectionStart = null;
let editorControlStates = [];

function setEditorRegionLocked(locked) {
    const tab = document.getElementById('tab-editor');
    if (!tab) return;
    const controls = tab.querySelectorAll('.editor-sidebar button, .editor-sidebar input, .editor-sidebar select, .editor-pagebar button');
    if (locked) {
        if (!editorControlStates.length) editorControlStates = Array.from(controls).map(el => ({ el, disabled: el.disabled }));
        tab.classList.add('region-selecting');
        controls.forEach(el => { el.disabled = true; });
    } else {
        tab.classList.remove('region-selecting');
        editorControlStates.forEach(({ el, disabled }) => { if (el.isConnected) el.disabled = disabled; });
        editorControlStates = [];
    }
}

function clearEditorRegionSelection() {
    isSelectingEditorRegion = false;
    editorSelectionStart = null;
    const box = document.getElementById('editor-region-selection');
    const shell = document.getElementById('editor-page-shell');
    if (box) { box.style.display = 'none'; box.style.width = '0px'; box.style.height = '0px'; }
    if (shell) shell.classList.remove('region-selecting');
    setEditorRegionLocked(false);
}

function initEditorRegionSelection() {
    const shell = document.getElementById('editor-page-shell');
    const box = document.getElementById('editor-region-selection');
    if (!shell || !box || shell.dataset.regionSelectionBound) return;
    shell.dataset.regionSelectionBound = '1';
    shell.addEventListener('pointerdown', e => {
        if (editorCurrentTool !== 'text' || e.button !== 0) return;
        // Text/image objects keep their normal drag/edit behavior. Empty canvas starts a region drag.
        if (e.target.closest('.editor-text-layer span, .editing-input, .editor-img-box')) return;
        e.preventDefault();
        isSelectingEditorRegion = true;
        editorSelectionStart = getCanvasPos(e, document.getElementById('editor-draw-canvas'));
        shell.setPointerCapture?.(e.pointerId);
        shell.classList.add('region-selecting');
        setEditorRegionLocked(true);
        box.style.display = 'block';
        box.style.left = editorSelectionStart.x + 'px';
        box.style.top = editorSelectionStart.y + 'px';
        box.style.width = '0px';
        box.style.height = '0px';
    });
    shell.addEventListener('pointermove', e => {
        if (!isSelectingEditorRegion) return;
        const pos = getCanvasPos(e, document.getElementById('editor-draw-canvas'));
        const left = Math.min(editorSelectionStart.x, pos.x), top = Math.min(editorSelectionStart.y, pos.y);
        box.style.left = left + 'px'; box.style.top = top + 'px';
        box.style.width = Math.abs(pos.x - editorSelectionStart.x) + 'px';
        box.style.height = Math.abs(pos.y - editorSelectionStart.y) + 'px';
    });
    shell.addEventListener('pointerup', clearEditorRegionSelection);
    shell.addEventListener('pointercancel', clearEditorRegionSelection);
}

function setEditorTool(toolName) {
    editorCurrentTool = toolName;
    const tb = document.getElementById(`tool-${toolName}`);
    if (tb) tb.classList.add('active');
    const textLayer = document.getElementById('editor-text-layer');
    if (toolName === 'text' || toolName === 'addtext') {
        textLayer.classList.remove('drawing-active');
    } else {
        textLayer.classList.add('drawing-active');
    }
    textLayer.classList.toggle('add-mode', toolName === 'addtext');
    const dc = document.getElementById('editor-draw-canvas');
    if (dc) dc.style.cursor = toolName === 'text' ? 'default' : 'crosshair';
    updateBrushPreview();
    initEditorRegionSelection();
}

function getArrowGeometry(x1, y1, x2, y2, size) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) return null;
    const ang = Math.atan2(dy, dx);
    const headLen = Math.min(len * .6, Math.max(14, size * 4.5));
    const spread = Math.PI / 7;
    return {
        tip: {
            x: x2,
            y: y2
        },
        left: {
            x: x2 - headLen * Math.cos(ang - spread),
            y: y2 - headLen * Math.sin(ang - spread)
        },
        right: {
            x: x2 - headLen * Math.cos(ang + spread),
            y: y2 - headLen * Math.sin(ang + spread)
        },
        shaftEnd: {
            x: x2 - headLen * .8 * Math.cos(ang),
            y: y2 - headLen * .8 * Math.sin(ang)
        }
    };
}

function updateBrushPreview() {
    const el = document.getElementById('brush-size-status');
    if (el) el.innerText = `Độ dày nét: ${brushSize}px (Cuộn chuột để thay đổi)`;
}
window.changeBrushSize = function(delta) {
    brushSize = Math.max(1, Math.min(50, brushSize + delta));
    updateBrushPreview();
    if (typeof redrawPageShapes === 'function') redrawPageShapes();
};
window.getBrushSize = function() { return brushSize; };

document.addEventListener('keydown', function(e) {
    const isEditorActive = document.getElementById('tab-editor')?.classList.contains('active');
    if (!isEditorActive) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const _k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && _k === 'o') {
        e.preventDefault();
        document.getElementById('editor-file-input')?.click();
    } else if ((e.ctrlKey || e.metaKey) && _k === 'b') {
        e.preventDefault();
        if (typeof editorToggleBold === 'function') editorToggleBold();
    } else if ((e.ctrlKey || e.metaKey) && _k === 'i') {
        e.preventDefault();
        if (typeof editorToggleItalic === 'function') editorToggleItalic();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && _k === 'c') {
        if (editorCopySelection()) e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && _k === 'v') {
        if (editorClip) { e.preventDefault(); editorPasteClip(); }
    } else if ((e.ctrlKey || e.metaKey) && _k === 'z' && !e.shiftKey) {
        e.preventDefault();
        editorUndo();
    } else if ((e.ctrlKey || e.metaKey) && (_k === 'y' || (_k === 'z' && e.shiftKey))) {
        e.preventDefault();
        editorRedo();
    } else if ((e.ctrlKey || e.metaKey) && _k === 's') {
        e.preventDefault();
        if (typeof editorExportPDF === 'function') editorExportPDF();
    }
});

let drawEventsBound = false;

function getCanvasPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
}

function initDrawCanvasEvents() {
    if (drawEventsBound) return;
    drawEventsBound = true;
    const dCanvas = document.getElementById('editor-draw-canvas');
    const ctx = dCanvas.getContext('2d');
    dCanvas.addEventListener('wheel', e => {
        if (editorCurrentTool === 'text' || editorCurrentTool === 'addtext' || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (e.deltaY < 0) {
            brushSize = Math.min(50, brushSize + 1);
        } else {
            brushSize = Math.max(1, brushSize - 1);
        }
        updateBrushPreview();
        redrawPageShapes();
    }, {
        passive: false
    });
    dCanvas.addEventListener('pointerdown', e => {
        if (editorCurrentTool === 'text' || editorCurrentTool === 'addtext') return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        isDrawingShape = true;
        try {
            dCanvas.setPointerCapture(e.pointerId);
        } catch (_) {}
        const pos = getCanvasPos(e, dCanvas);
        const mouseX = pos.x;
        const mouseY = pos.y;
        const strokeColor = document.getElementById('editor-stroke-color').value;
        currentDrawShape = {
            page: editorPage,
            type: editorCurrentTool,
            color: strokeColor,
            size: brushSize,
            startX: mouseX,
            startY: mouseY,
            endX: mouseX,
            endY: mouseY,
            vp: editorViewport,
            points: [ {
                x: mouseX,
                y: mouseY
            } ]
        };
    });
    dCanvas.addEventListener('pointermove', e => {
        if (!isDrawingShape || !currentDrawShape) return;
        const pos = getCanvasPos(e, dCanvas);
        const mouseX = pos.x;
        const mouseY = pos.y;
        let ex = mouseX, ey = mouseY;
        if (e.shiftKey && currentDrawShape.type !== 'free') {
            const dx = ex - currentDrawShape.startX, dy = ey - currentDrawShape.startY;
            if (currentDrawShape.type === 'rect' || currentDrawShape.type === 'ellipse') {
                const m = Math.max(Math.abs(dx), Math.abs(dy));
                ex = currentDrawShape.startX + Math.sign(dx || 1) * m;
                ey = currentDrawShape.startY + Math.sign(dy || 1) * m;
            } else {
                const len = Math.hypot(dx, dy);
                const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
                ex = currentDrawShape.startX + len * Math.cos(ang);
                ey = currentDrawShape.startY + len * Math.sin(ang);
            }
        }
        currentDrawShape.endX = ex;
        currentDrawShape.endY = ey;
        if (currentDrawShape.type === 'free') {
            currentDrawShape.points.push({
                x: mouseX,
                y: mouseY
            });
        }
        redrawPageShapes();
        ctx.strokeStyle = currentDrawShape.color;
        ctx.lineWidth = currentDrawShape.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        drawSingleShape(ctx, currentDrawShape);
    });
    window.addEventListener('pointerup', () => {
        if (isDrawingShape && currentDrawShape) {
            isDrawingShape = false;
            const sh = currentDrawShape;
            currentDrawShape = null;
            const tooSmall = sh.type === 'free' ? sh.points.length < 2 : Math.hypot(sh.endX - sh.startX, sh.endY - sh.startY) < 3;
            if (!tooSmall) { editorShapes.push(sh); recordHistory(); }
            redrawPageShapes();
        }
    });
}

function drawSingleShape(ctx, shape) {
    ctx.beginPath();
    if (shape.type === 'free') {
        if (shape.points.length < 2) return;
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let p of shape.points) {
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    } else if (shape.type === 'line') {
        ctx.moveTo(shape.startX, shape.startY);
        ctx.lineTo(shape.endX, shape.endY);
        ctx.stroke();
    } else if (shape.type === 'rect') {
        const w = shape.endX - shape.startX;
        const h = shape.endY - shape.startY;
        ctx.strokeRect(shape.startX, shape.startY, w, h);
    } else if (shape.type === 'ellipse') {
        const rx = Math.abs(shape.endX - shape.startX) / 2;
        const ry = Math.abs(shape.endY - shape.startY) / 2;
        const cx = (shape.startX + shape.endX) / 2;
        const cy = (shape.startY + shape.endY) / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (shape.type === 'arrow') {
        const g = getArrowGeometry(shape.startX, shape.startY, shape.endX, shape.endY, shape.size);
        if (!g) return;
        ctx.moveTo(shape.startX, shape.startY);
        ctx.lineTo(g.shaftEnd.x, g.shaftEnd.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(g.tip.x, g.tip.y);
        ctx.lineTo(g.left.x, g.left.y);
        ctx.lineTo(g.right.x, g.right.y);
        ctx.closePath();
        ctx.fillStyle = shape.color;
        ctx.fill();
    }
}

function redrawPageShapes() {
    const dCanvas = document.getElementById('editor-draw-canvas');
    if (!dCanvas) return;
    const ctx = dCanvas.getContext('2d');
    ctx.clearRect(0, 0, dCanvas.width, dCanvas.height);
    editorShapes.filter(s => s.page === editorPage).forEach(shape => {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        drawSingleShape(ctx, shape);
    });
}

async function editorLoadFile(input) {

    const file = input.files[0];
    if (!file) return;
    editorFileName = file.name.replace(/\.pdf$/i, '');
    document.getElementById('editor-file-status').innerText = 'Đang đọc...';
    const reader = new FileReader;
    reader.onload = async function() {
        editorPdfDataBytes = this.result.slice(0);
        modifiedTexts = [];
        modifiedImages = [];
        editorShapes = [];
        editorSigs = [];
        addedTexts = [];
        editorPage = 1;
        resetHistory();
        updateZoomLabel();
        try {
            editorPdfJsDoc = await pdfjsLib.getDocument({
                data: new Uint8Array(editorPdfDataBytes.slice(0))
            }).promise;
            document.getElementById('editor-file-status').innerText = '✓ ' + file.name;
            document.getElementById('editor-file-status').style.color = 'var(--success)';
            document.getElementById('editor-empty').style.display = 'none';
            document.getElementById('editor-page-shell').style.display = 'inline-block';
            document.getElementById('editor-download-btn').disabled = false;
            initDrawCanvasEvents();
            await editorRenderPage();
            if (typeof window.onEditorDocLoaded === 'function') window.onEditorDocLoaded();
        } catch (e) {
            alert("Lỗi phân tích cú pháp PDF: " + e.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

async function _editorRenderPageImpl() {
    if (!editorPdfJsDoc) return;
    const page = await editorPdfJsDoc.getPage(editorPage);
    editorViewport = page.getViewport({
        scale: editorScale
    });
    const canvas = document.getElementById('editor-pdf-canvas');
    const dCanvas = document.getElementById('editor-draw-canvas');
    const textLayerDiv = document.getElementById('editor-text-layer');
    canvas.height = editorViewport.height;
    canvas.width = editorViewport.width;
    dCanvas.height = editorViewport.height;
    dCanvas.width = editorViewport.width;
    const renderContext = {
        canvasContext: canvas.getContext('2d'),
        viewport: editorViewport
    };
    await page.render(renderContext).promise;
    const textContent = await page.getTextContent();
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width = canvas.width + 'px';
    textLayerDiv.style.height = canvas.height + 'px';
    document.getElementById('editor-page-indicator').innerText = `${editorPage} / ${editorPdfJsDoc.numPages}`;
    textContent.items.forEach((item, index) => {
        const span = document.createElement('span');
        const tx = pdfjsLib.Util.transform(editorViewport.transform, item.transform);
        const isBold = /bold|black|heavy/i.test(item.fontName || "");
        const isItalic = /italic|oblique/i.test(item.fontName || "");
        span.textContent = item.str;
        span.setAttribute('data-tidx', index);
        span._item = item;
        span.style.fontFamily = item.fontName || 'Arial';
        span.style.fontSize = `${item.height * editorScale}px`;
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - item.height * editorScale}px`;
        if (isBold) span.classList.add("is-bold");
        if (isItalic) span.classList.add("is-italic");
        const key = `${editorPage}_${index}`;
        const savedChange = modifiedTexts.find(m => m.key === key);
        if (savedChange) {
            span.textContent = savedChange.text;
            {
                const [_hx, _hy] = editorViewport.convertToViewportPoint(savedChange.x, savedChange.y);
                const _fs = savedChange.fontSize || item.height;
                span.style.left = `${_hx}px`;
                span.style.top = `${_hy - _fs * editorScale}px`;
            }
            span.classList.add('modified');
            // Khi chỉ di chuyển chữ gốc, giữ nguyên kiểu chữ và màu do PDF.js hiển thị.
            // Chỉ áp màu/font tùy chỉnh khi người dùng thực sự sửa định dạng.
            if (!savedChange.preserveOriginalFormatting) {
                span.style.setProperty('--txt-color', savedChange.color || '#000000');
            } else {
                span.style.removeProperty('--txt-color');
            }
            if (!savedChange.preserveOriginalFormatting && savedChange.fontSize) {
                span._ptSize = savedChange.fontSize;
                span.style.fontSize = `${savedChange.fontSize * editorScale}px`;
            }
            if (!savedChange.preserveOriginalFormatting && savedChange.isBold) span.classList.add('is-bold');
            if (!savedChange.preserveOriginalFormatting && savedChange.isItalic) span.classList.add('is-italic');
            if (!savedChange.preserveOriginalFormatting) applyFontToEl(span, fontKeyOf(savedChange));
            maskOriginalPosition(index, item, tx);
        }
        enableDragAndEdit(span, item, index, tx);
        textLayerDiv.appendChild(span);
    });
    buildAddedTexts(textLayerDiv);
    try {
        await buildImageBoxes(page, textLayerDiv, canvas);
    } catch (e) {
        console.warn('Không dò được ảnh trong trang:', e);
        setImgStatus('⚠ Không dò được ảnh trên trang này: ' + (e && e.message ? e.message : e));
    }
    buildImageCopyBoxes(textLayerDiv);
    if (typeof buildSigBoxes === 'function') buildSigBoxes(textLayerDiv);
    applySelHighlight();
    redrawPageShapes();
}

function mulMatrix(m1, m2) {
    return [
        m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
}

async function detectPageImages(page) {
    const OPS = pdfjsLib.OPS;
    const opList = await page.getOperatorList();
    let ctm = [ 1, 0, 0, 1, 0, 0 ];
    const stack = [];
    const found = [];
    const view = page.view;
    const pageArea = Math.abs((view[2] - view[0]) * (view[3] - view[1]));
    for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];
        if (fn === OPS.save) {
            stack.push(ctm.slice());
        } else if (fn === OPS.restore) {
            if (stack.length) ctm = stack.pop();
        } else if (fn === OPS.transform) {
            ctm = mulMatrix(ctm, args);
        } else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm.slice());
            if (args && args[0]) ctm = mulMatrix(ctm, args[0]);
        } else if (fn === OPS.paintFormXObjectEnd) {
            if (stack.length) ctm = stack.pop();
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
            const xs = [ ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4] ];
            const ys = [ ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5] ];
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            const w = x1 - x0, h = y1 - y0;
            if (!isFinite(w) || !isFinite(h)) continue;
            if (w < 8 || h < 8) continue;
            if (w * h > pageArea * 0.85) continue;
            found.push({ x0, y0, x1, y1 });
        }
    }
    return found;
}

function imgBoxViewportRect(vp, b) {
    const [ax, ay] = vp.convertToViewportPoint(b.x0, b.y0);
    const [bx, by] = vp.convertToViewportPoint(b.x1, b.y1);
    return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

function sampleBgAround(cv, r) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const off = 3;
    const pts = [
        [ r.left - off, r.top - off ], [ r.left + r.width + off, r.top - off ],
        [ r.left - off, r.top + r.height + off ], [ r.left + r.width + off, r.top + r.height + off ],
        [ r.left + r.width / 2, r.top - off ], [ r.left + r.width / 2, r.top + r.height + off ],
        [ r.left - off, r.top + r.height / 2 ], [ r.left + r.width + off, r.top + r.height / 2 ]
    ];
    const counts = {};
    let best = null, bestN = 0;
    pts.forEach(([x, y]) => {
        x = Math.round(x); y = Math.round(y);
        if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
        const d = ctx.getImageData(x, y, 1, 1).data;
        const k = [ d[0] >> 3, d[1] >> 3, d[2] >> 3 ].join(',');
        counts[k] = (counts[k] || 0) + 1;
        if (counts[k] > bestN) { bestN = counts[k]; best = d; }
    });
    if (!best) return '#ffffff';
    return '#' + [ best[0], best[1], best[2] ].map(v => v.toString(16).padStart(2, '0')).join('');
}

function cropCanvasToDataURL(cv, r) {
    const x = Math.max(0, Math.floor(r.left)), y = Math.max(0, Math.floor(r.top));
    const w = Math.max(1, Math.min(cv.width - x, Math.ceil(r.width))), h = Math.max(1, Math.min(cv.height - y, Math.ceil(r.height)));
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
    return tmp.toDataURL('image/png');
}

function setImgStatus(msg) {
    const el = document.getElementById('editor-img-status');
    if (el) el.textContent = msg;
}

async function buildImageBoxes(page, textLayerDiv, pdfCanvas) {
    if (page.rotate && page.rotate % 360 !== 0) {
        setImgStatus('🖼 Trang này bị xoay nên chưa hỗ trợ kéo ảnh.');
        return;
    }
    const images = await detectPageImages(page);
    setImgStatus(images.length ? `🖼 Trang này có ${images.length} ảnh kéo được (rê chuột vào ảnh, kéo để dời).` : '🖼 Không thấy ảnh nào kéo được trên trang này (ảnh quá nhỏ, phủ gần kín trang, hoặc là hình vector).');
    images.forEach((b, idx) => {
        const key = `${editorPage}_img${idx}`;
        const r = imgBoxViewportRect(editorViewport, b);
        const saved = modifiedImages.find(m => m.key === key);
        const box = document.createElement('div');
        box.className = 'editor-img-box';
        box.setAttribute('data-img-key', key);
        box._b = b;
        box._crop = () => cropCanvasToDataURL(pdfCanvas, r);
        box.title = 'Kéo để di chuyển ảnh • Click đúp để trả về vị trí cũ • Click chọn rồi Ctrl+C / Ctrl+V để nhân bản';
        box.style.left = r.left + 'px';
        box.style.top = r.top + 'px';
        box.style.width = r.width + 'px';
        box.style.height = r.height + 'px';
        const addMask = bg => {
            const mask = document.createElement('div');
            mask.className = 'original-mask';
            mask.setAttribute('data-img-index', idx);
            mask.style.setProperty('--mask-bg', bg);
            mask.style.left = (r.left - 1) + 'px';
            mask.style.top = (r.top - 1) + 'px';
            mask.style.width = (r.width + 2) + 'px';
            mask.style.height = (r.height + 2) + 'px';
            textLayerDiv.appendChild(mask);
        };
        const showCrop = () => {
            box.style.backgroundImage = `url(${cropCanvasToDataURL(pdfCanvas, r)})`;
            box.classList.add('modified');
        };
        if (saved) {
            {
                const [_bx, _by] = editorViewport.convertToViewportPoint(saved.newX, saved.newY);
                box.style.left = _bx + 'px';
                box.style.top = (_by - r.height) + 'px';
            }
            showCrop();
            addMask(saved.bgColor);
        }
        textLayerDiv.appendChild(box);
        let prepared = !!saved;
        let bgColor = saved ? saved.bgColor : null;
        box.addEventListener('mousedown', e => {
            if (editorCurrentTool !== 'text' || e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startLeft = parseFloat(box.style.left), startTop = parseFloat(box.style.top);
            let moved = false;
            const onMove = ev => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                if (!moved) {
                    moved = true;
                    if (!prepared) {
                        bgColor = sampleBgAround(pdfCanvas, r);
                        showCrop();
                        addMask(bgColor);
                        prepared = true;
                    }
                    box.classList.add('dragging');
                }
                box.style.left = (startLeft + dx) + 'px';
                box.style.top = (startTop + dy) + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                box.classList.remove('dragging');
                if (!moved) return;
                const left = parseFloat(box.style.left), top = parseFloat(box.style.top);
                const [px, py] = editorViewport.convertToPdfPoint(left, top + r.height);
                const data = {
                    key: key, page: editorPage, _seq: ++editorSeq,
                    x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1,
                    newX: px, newY: py, width: b.x1 - b.x0, height: b.y1 - b.y0,
                    htmlLeft: left, htmlTop: top, bgColor: bgColor || '#ffffff'
                };
                const ei = modifiedImages.findIndex(m => m.key === key);
                if (ei !== -1) modifiedImages[ei] = data; else modifiedImages.push(data);
                recordHistory();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        box.addEventListener('dblclick', () => {
            const ei = modifiedImages.findIndex(m => m.key === key);
            if (ei === -1) return;
            modifiedImages.splice(ei, 1);
            recordHistory();
            editorRenderPage();
        });
    });
}

// ===================== Roboto cho bản xem trước (khớp với bản xuất PDF) =====================
(function loadPreviewFonts() {
    try {
        const sel = document.getElementById('editor-text-font');
        if (sel) window.FONT_LIST.forEach(f => {
            const o = document.createElement('option');
            o.value = f.key; o.textContent = f.label;
            sel.appendChild(o);
        });
        const variants = { regular: [ 'normal', '400' ], bold: [ 'normal', '700' ], italic: [ 'italic', '400' ], bolditalic: [ 'italic', '700' ] };
        window.FONT_LIST.forEach(info => {
            info.styles.forEach(k => {
                const u = fontBytes(info.key, k);
                if (!u) return;
                const [st, w] = variants[k];
                const ff = new FontFace(info.css, u.buffer, { style: st, weight: w });
                ff.load().then(f => { document.fonts.add(f); }).catch(() => {});
            });
        });
    } catch (e) {}
})();

// ===================== Vẽ lại trang: xếp hàng, tránh chạy chồng =====================
let _renderBusy = false, _renderPending = false;
async function editorRenderPage() {
    if (_renderBusy) { _renderPending = true; return; }
    _renderBusy = true;
    try {
        do {
            _renderPending = false;
            await _editorRenderPageImpl();
        } while (_renderPending);
    } finally {
        _renderBusy = false;
    }
}

// ===================== Chữ thêm mới =====================
let addedTexts = [];
let addedIdSeq = 0;
const ADDED_K = 0.842;
const INPUT_K = 0.928;
const ADDED_FONT = "'RobotoEmb', Roboto, Arial, sans-serif";
const addedK = key => fontInfo(key).k;
const inputK = key => fontInfo(key).ik;
const _measureCtx = document.createElement('canvas').getContext('2d');

function buildAddedTexts(layer) {
    layer.querySelectorAll('.added-text').forEach(n => n.remove());
    addedTexts.filter(a => a.page === editorPage).forEach(a => {
        const span = document.createElement('span');
        span.className = 'added-text modified';
        if (a.isBold) span.classList.add('is-bold');
        if (a.isItalic) span.classList.add('is-italic');
        span.textContent = a.text;
        applyFontToEl(span, fontKeyOf(a));
        span.style.lineHeight = '1';
        span.style.fontSize = `${a.fontSize * editorScale}px`;
        span.style.setProperty('--txt-color', a.color);
        const [vx, vy] = editorViewport.convertToViewportPoint(a.x, a.y);
        span.style.left = `${vx}px`;
        span.style.top = `${vy - addedK(fontKeyOf(a)) * a.fontSize * editorScale}px`;
        span.setAttribute('data-added-id', a.id);
        bindAddedTextEvents(span, a.id);
        layer.appendChild(span);
    });
}

function bindAddedTextEvents(span, id) {
    let moved = false;
    span.addEventListener('mousedown', e => {
        if (e.button !== 0 || editorCurrentTool !== 'text') return;
        if (document.querySelector('#editor-text-layer .editing-input')) return;
        moved = false;
        const startX = e.clientX, startY = e.clientY;
        const startLeft = parseFloat(span.style.left), startTop = parseFloat(span.style.top);
        document.body.style.userSelect = 'none';
        const onMove = ev => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
            moved = true;
            span.classList.add('dragging');
            span.style.left = (startLeft + dx) + 'px';
            span.style.top = (startTop + dy) + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.userSelect = '';
            span.classList.remove('dragging');
            if (!moved) return;
            const a = addedTexts.find(t => t.id === id);
            if (!a) return;
            const [px, py] = editorViewport.convertToPdfPoint(parseFloat(span.style.left), parseFloat(span.style.top) + addedK(fontKeyOf(a)) * a.fontSize * editorScale);
            a.x = px;
            a.y = py;
            recordHistory();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    span.addEventListener('dblclick', () => {
        if (editorCurrentTool === 'text') openAddedTextEditor(addedTexts.find(t => t.id === id));
    });
    span.addEventListener('click', () => {
        if (editorCurrentTool === 'addtext') openAddedTextEditor(addedTexts.find(t => t.id === id));
    });
}

function isRibbonOrPicker(el) {
    if (!el) return false;
    return !!(
        (el.closest && (
            el.closest('#word-ribbon-bar') ||
            el.closest('.word-ribbon') ||
            el.closest('#rb-panels-container') ||
            el.closest('.ribbon-group') ||
            el.closest('.ribbon-tabs-bar')
        )) ||
        el.id === 'editor-text-color' ||
        el.id === 'editor-text-size' ||
        el.id === 'editor-text-font' ||
        el.id === 'rb-bold-btn' ||
        el.id === 'rb-italic-btn' ||
        el.id === 'rb-font-inc' ||
        el.id === 'rb-font-dec'
    );
}

function openAddedTextEditor(entry, pos) {
    const layer = document.getElementById('editor-text-layer');
    if (layer.querySelector('.editing-input')) return;
    const colorPicker = document.getElementById('editor-text-color');
    const sizeInput = document.getElementById('editor-text-size');
    const fontSel = document.getElementById('editor-text-font');
    let size, color, bold, italic, text, left, baseline, fontKey;
    if (entry) {
        fontKey = fontKeyOf(entry);
        size = entry.fontSize; color = entry.color; bold = !!entry.isBold; italic = !!entry.isItalic; text = entry.text;
        const [vx, vy] = editorViewport.convertToViewportPoint(entry.x, entry.y);
        left = vx; baseline = vy;
    } else {
        fontKey = fontKeyOf({ fontFamily: fontSel && fontSel.value });
        size = parseFloat(sizeInput ? sizeInput.value : 12);
        if (!(size >= 4 && size <= 200)) size = 12;
        color = (colorPicker && colorPicker.value) || '#000000';
        bold = false; italic = false; text = '';
        left = pos.x;
        baseline = pos.y + addedK(fontKey) * size * editorScale;
    }
    if (fontSel) fontSel.value = fontKey;
    if (colorPicker) colorPicker.value = color;
    if (sizeInput) sizeInput.value = String(Math.round(size * 10) / 10);
    if (entry) {
        const sp = layer.querySelector(`.added-text[data-added-id="${entry.id}"]`);
        if (sp) sp.style.visibility = 'hidden';
    }
    const input = document.createElement('input');
    input.className = 'editing-input';
    input.setAttribute('data-added', '1');
    input.value = text;
    input.placeholder = 'Gõ chữ...';
    applyFontToEl(input, fontKey);
    input.style.left = `${left - 1}px`;
    input.style.setProperty('--txt-color', color);
    if (bold) input.classList.add('is-bold');
    if (italic) input.classList.add('is-italic');
    const anchorTop = entry ? null : pos.y;
    const applySize = () => {
        if (anchorTop !== null) baseline = anchorTop + addedK(fontKey) * size * editorScale;
        input.style.fontSize = `${size * editorScale}px`;
        input.style.top = `${baseline - inputK(fontKey) * size * editorScale}px`;
        _measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size * editorScale}px ${fontCss(fontKey)}`;
        const w = _measureCtx.measureText(input.value || ' ').width;
        input.style.width = `${Math.max(120, Math.ceil(w) + 30)}px`;
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };

    input._toggleBold = () => {
        bold = !bold;
        input.classList.toggle('is-bold', bold);
        applySize();
    };
    input._toggleItalic = () => {
        italic = !italic;
        input.classList.toggle('is-italic', italic);
        applySize();
    };
    input._setSize = (newSize) => {
        size = newSize;
        applySize();
    };
    input._setFont = (newKey) => {
        fontKey = fontKeyOf({ fontFamily: newKey });
        applyFontToEl(input, fontKey);
        applySize();
    };
    input._setColor = (newColor) => {
        color = newColor;
        input.style.setProperty('--txt-color', color);
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input._getFormat = () => ({
        isEditing: true,
        hasSelection: true,
        isBold: bold,
        isItalic: italic,
        color: color,
        fontSize: size,
        fontKey: fontKey
    });

    applySize();
    layer.appendChild(input);
    input.focus();
    let done = false, pickerBusy = false;
    const onPickDown = () => { pickerBusy = true; };
    const endPick = () => { setTimeout(() => { pickerBusy = false; if (input.isConnected) input.focus(); }, 0); };
    const onColor = () => { color = colorPicker.value; input.style.setProperty('--txt-color', color); };
    const onColorChange = () => { onColor(); endPick(); };
    const onSize = () => {
        const v = parseFloat(sizeInput.value);
        if (!(v >= 4 && v <= 200)) return;
        size = v;
        applySize();
    };
    const onSizeKey = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
    const onFont = () => {
        fontKey = fontKeyOf({ fontFamily: fontSel.value });
        applyFontToEl(input, fontKey);
        applySize();
        endPick();
    };
    if (fontSel) {
        fontSel.addEventListener('mousedown', onPickDown);
        fontSel.addEventListener('change', onFont);
        fontSel.addEventListener('blur', endPick);
    }
    if (colorPicker) {
        colorPicker.addEventListener('mousedown', onPickDown);
        colorPicker.addEventListener('input', onColor);
        colorPicker.addEventListener('change', onColorChange);
        colorPicker.addEventListener('blur', endPick);
    }
    if (sizeInput) {
        sizeInput.addEventListener('mousedown', onPickDown);
        sizeInput.addEventListener('input', onSize);
        sizeInput.addEventListener('keydown', onSizeKey);
        sizeInput.addEventListener('blur', endPick);
    }
    const cleanup = () => {
        if (colorPicker) {
            colorPicker.removeEventListener('mousedown', onPickDown);
            colorPicker.removeEventListener('input', onColor);
            colorPicker.removeEventListener('change', onColorChange);
            colorPicker.removeEventListener('blur', endPick);
        }
        if (sizeInput) {
            sizeInput.removeEventListener('mousedown', onPickDown);
            sizeInput.removeEventListener('input', onSize);
            sizeInput.removeEventListener('keydown', onSizeKey);
            sizeInput.removeEventListener('blur', endPick);
        }
        if (fontSel) {
            fontSel.removeEventListener('mousedown', onPickDown);
            fontSel.removeEventListener('change', onFont);
            fontSel.removeEventListener('blur', endPick);
        }
    };
    const commit = () => {
        if (done) return;
        done = true;
        cleanup();
        const t = input.value;
        input.remove();
        if (entry) {
            const e = addedTexts.find(a => a.id === entry.id);
            if (e) {
                if (!t.trim()) {
                    addedTexts = addedTexts.filter(a => a.id !== e.id);
                } else {
                    e.text = t; e.fontSize = size; e.color = color; e.isBold = bold; e.isItalic = italic; e.fontFamily = fontKey;
                }
            }
        } else if (t.trim()) {
            const [px, py] = editorViewport.convertToPdfPoint(left, baseline);
            addedTexts.push({ id: 'a' + (++addedIdSeq), page: editorPage, text: t, x: px, y: py, fontSize: size, color: color, isBold: bold, isItalic: italic, fontFamily: fontKey });
        }
        buildAddedTexts(layer);
        recordHistory();
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    const cancel = () => {
        if (done) return;
        done = true;
        cleanup();
        input.remove();
        buildAddedTexts(layer);
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input.addEventListener('input', applySize);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); bold = !bold; input.classList.toggle('is-bold', bold); applySize(); }
        if (k === 'i') { e.preventDefault(); italic = !italic; input.classList.toggle('is-italic', italic); applySize(); }
    });
    input.addEventListener('blur', e => {
        if (pickerBusy) return;
        const rt = e.relatedTarget || document.activeElement;
        if (isRibbonOrPicker(rt)) return;
        commit();
    });
}

(function bindAddTextClick() {
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    layer.addEventListener('mousedown', e => {
        if (editorCurrentTool !== 'addtext' || e.button !== 0) return;
        if (!(e.target === layer || e.target.classList.contains('editor-img-box'))) return;
        const rect = layer.getBoundingClientRect();
        const k = rect.width ? layer.offsetWidth / rect.width : 1;
        const pos = { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
        if (layer.querySelector('.editing-input')) {
            setTimeout(() => openAddedTextEditor(null, pos), 0);
        } else {
            e.preventDefault();
            openAddedTextEditor(null, pos);
        }
    });
})();

// ===================== Chọn khối chữ / ảnh + Ctrl+C, Ctrl+V nhân bản =====================
let editorSel = null;   // { type: 'tidx'|'added'|'img', page, index|id|key }
let editorClip = null;  // dữ liệu đã sao chép
const PASTE_OFFSET = 12; // pt

function applySelHighlight() {
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    layer.querySelectorAll('.sel-hl').forEach(n => n.classList.remove('sel-hl'));
    if (!editorSel || editorSel.page !== editorPage) {
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
        return;
    }
    let el = null;
    if (editorSel.type === 'tidx') el = layer.querySelector(`span[data-tidx="${editorSel.index}"]`);
    else if (editorSel.type === 'added') el = layer.querySelector(`span[data-added-id="${editorSel.id}"]`);
    else if (editorSel.type === 'img') el = layer.querySelector(`.editor-img-box[data-img-key="${editorSel.key}"]`);
    if (el) el.classList.add('sel-hl');
    if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
}

function updateModifiedItemFormatting(index, span, changes) {
    const key = `${editorPage}_${index}`;
    const existingIndex = modifiedTexts.findIndex(item => item.key === key);
    const originalItem = span._item;
    const tx = originalItem ? pdfjsLib.Util.transform(editorViewport.transform, originalItem.transform) : [1, 0, 0, 1, 0, 0];
    const prev = existingIndex !== -1 ? modifiedTexts[existingIndex] : null;
    const sampled = prev && prev.color ? { color: prev.color, bg: prev.bgColor } : (originalItem ? sampleTextColors(originalItem) : { color: '#000000', bg: '#ffffff' });
    const htmlLeft = parseFloat(span.style.left) || tx[4] || 0;
    const curSize = changes.fontSize !== undefined ? changes.fontSize : (span._ptSize || (prev && prev.fontSize) || (originalItem ? originalItem.height : 12));
    const baselineVp = (parseFloat(span.style.top) || (tx[5] - (originalItem ? originalItem.height : curSize) * editorScale)) + curSize * editorScale;
    const [pdfX, pdfY] = editorViewport.convertToPdfPoint(htmlLeft, baselineVp);

    const curColor = changes.color !== undefined ? changes.color : ((prev && prev.color) || span.style.getPropertyValue('--txt-color') || sampled.color || '#000000');
    const curFont = changes.fontFamily !== undefined ? changes.fontFamily : ((prev && prev.fontFamily) || fontKeyOf({ fontFamily: span.style.fontFamily || (originalItem && originalItem.fontName) }));
    const curBold = changes.isBold !== undefined ? changes.isBold : span.classList.contains('is-bold');
    const curItalic = changes.isItalic !== undefined ? changes.isItalic : span.classList.contains('is-italic');

    const changeData = {
        key: key, _seq: ++editorSeq,
        page: editorPage,
        color: curColor,
        bgColor: (prev && prev.bgColor) || sampled.bg || '#ffffff',
        index: index,
        text: (prev && prev.text) || span.textContent,
        origX: originalItem ? originalItem.transform[4] : (prev ? prev.origX : 0),
        origY: originalItem ? originalItem.transform[5] : (prev ? prev.origY : 0),
        origWidth: originalItem ? originalItem.width : (prev ? prev.origWidth : 0),
        origHeight: originalItem ? originalItem.height : (prev ? prev.origHeight : 0),
        x: pdfX,
        y: pdfY,
        fontSize: curSize,
        htmlLeft: htmlLeft,
        htmlTop: baselineVp - curSize * editorScale,
        isBold: curBold,
        isItalic: curItalic,
        fontFamily: curFont,
        preserveOriginalFormatting: false
    };

    if (existingIndex !== -1) {
        modifiedTexts[existingIndex] = { ...modifiedTexts[existingIndex], ...changeData };
    } else {
        modifiedTexts.push(changeData);
    }
}

function editorGetSelectedFormatting() {
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return { hasSelection: false, isEditing: false };
    const input = layer.querySelector('.editing-input');
    if (input && typeof input._getFormat === 'function') {
        return input._getFormat();
    }
    if (editorSel && editorSel.page === editorPage) {
        if (editorSel.type === 'added') {
            const a = addedTexts.find(t => t.id === editorSel.id);
            if (a) {
                return {
                    isEditing: false, hasSelection: true,
                    isBold: !!a.isBold, isItalic: !!a.isItalic,
                    color: a.color || '#000000',
                    fontSize: a.fontSize || 12,
                    fontKey: a.fontFamily || 'roboto'
                };
            }
        } else if (editorSel.type === 'tidx') {
            const sp = layer.querySelector(`span[data-tidx="${editorSel.index}"]`);
            if (sp) {
                const key = `${editorPage}_${editorSel.index}`;
                const m = modifiedTexts.find(item => item.key === key);
                const isBold = sp.classList.contains('is-bold');
                const isItalic = sp.classList.contains('is-italic');
                const color = (m && m.color) || sp.style.getPropertyValue('--txt-color') || (sp._item && sampleTextColors(sp._item).color) || '#000000';
                const fontSize = (m && m.fontSize) || sp._ptSize || (sp._item && sp._item.height) || 12;
                const fontKey = (m && m.fontFamily) || (sp._item && fontKeyOf({ fontFamily: sp.style.fontFamily || sp._item.fontName })) || 'roboto';
                return { isEditing: false, hasSelection: true, isBold, isItalic, color, fontSize, fontKey };
            }
        }
    }
    const regionSpans = Array.from(layer.querySelectorAll('span[data-tidx].region-selected'));
    if (regionSpans.length) {
        const sp = regionSpans[0];
        const isBold = sp.classList.contains('is-bold');
        const isItalic = sp.classList.contains('is-italic');
        const color = sp.style.getPropertyValue('--txt-color') || (sp._item && sampleTextColors(sp._item).color) || '#000000';
        const fontSize = sp._ptSize || (sp._item && sp._item.height) || 12;
        const fontKey = (sp._item && fontKeyOf({ fontFamily: sp.style.fontFamily || sp._item.fontName })) || 'roboto';
        return { isEditing: false, hasSelection: true, isBold, isItalic, color, fontSize, fontKey };
    }
    return { hasSelection: false, isEditing: false };
}

function notifyEditorSelection() {
    if (typeof window.onEditorSelectionChange === 'function') {
        window.onEditorSelectionChange(editorGetSelectedFormatting());
    }
}
window.notifyEditorSelection = notifyEditorSelection;
window.editorGetSelectedFormatting = editorGetSelectedFormatting;

function editorToggleBold() {
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    const activeInput = layer.querySelector('.editing-input');
    if (activeInput && typeof activeInput._toggleBold === 'function') {
        activeInput._toggleBold();
        activeInput.focus();
        return;
    }
    if (editorSel && editorSel.page === editorPage) {
        if (editorSel.type === 'added') {
            const a = addedTexts.find(t => t.id === editorSel.id);
            if (a) {
                a.isBold = !a.isBold;
                const sp = layer.querySelector(`span[data-added-id="${editorSel.id}"]`);
                if (sp) sp.classList.toggle('is-bold', a.isBold);
                recordHistory();
                notifyEditorSelection();
                return;
            }
        } else if (editorSel.type === 'tidx') {
            const index = editorSel.index;
            const sp = layer.querySelector(`span[data-tidx="${index}"]`);
            if (sp && sp._item) {
                const b = !sp.classList.contains('is-bold');
                sp.classList.toggle('is-bold', b);
                sp.classList.add('modified');
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { isBold: b });
                recordHistory();
                notifyEditorSelection();
                return;
            }
        }
    }
    const regionSpans = Array.from(layer.querySelectorAll('span[data-tidx].region-selected'));
    if (regionSpans.length) {
        const anyNotBold = regionSpans.some(s => !s.classList.contains('is-bold'));
        regionSpans.forEach(sp => {
            const index = parseInt(sp.getAttribute('data-tidx'), 10);
            sp.classList.toggle('is-bold', anyNotBold);
            sp.classList.add('modified');
            if (sp._item) {
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { isBold: anyNotBold });
            }
        });
        recordHistory();
        notifyEditorSelection();
        return;
    }
}
window.editorToggleBold = editorToggleBold;

function editorToggleItalic() {
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    const activeInput = layer.querySelector('.editing-input');
    if (activeInput && typeof activeInput._toggleItalic === 'function') {
        activeInput._toggleItalic();
        activeInput.focus();
        return;
    }
    if (editorSel && editorSel.page === editorPage) {
        if (editorSel.type === 'added') {
            const a = addedTexts.find(t => t.id === editorSel.id);
            if (a) {
                a.isItalic = !a.isItalic;
                const sp = layer.querySelector(`span[data-added-id="${editorSel.id}"]`);
                if (sp) sp.classList.toggle('is-italic', a.isItalic);
                recordHistory();
                notifyEditorSelection();
                return;
            }
        } else if (editorSel.type === 'tidx') {
            const index = editorSel.index;
            const sp = layer.querySelector(`span[data-tidx="${index}"]`);
            if (sp && sp._item) {
                const it = !sp.classList.contains('is-italic');
                sp.classList.toggle('is-italic', it);
                sp.classList.add('modified');
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { isItalic: it });
                recordHistory();
                notifyEditorSelection();
                return;
            }
        }
    }
    const regionSpans = Array.from(layer.querySelectorAll('span[data-tidx].region-selected'));
    if (regionSpans.length) {
        const anyNotItalic = regionSpans.some(s => !s.classList.contains('is-italic'));
        regionSpans.forEach(sp => {
            const index = parseInt(sp.getAttribute('data-tidx'), 10);
            sp.classList.toggle('is-italic', anyNotItalic);
            sp.classList.add('modified');
            if (sp._item) {
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { isItalic: anyNotItalic });
            }
        });
        recordHistory();
        notifyEditorSelection();
        return;
    }
}
window.editorToggleItalic = editorToggleItalic;

function editorSetFontSize(size) {
    if (isNaN(size) || size < 4 || size > 200) return;
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    const activeInput = layer.querySelector('.editing-input');
    if (activeInput && typeof activeInput._setSize === 'function') {
        activeInput._setSize(size);
        return;
    }
    if (editorSel && editorSel.page === editorPage) {
        if (editorSel.type === 'added') {
            const a = addedTexts.find(t => t.id === editorSel.id);
            if (a) {
                a.fontSize = size;
                const sp = layer.querySelector(`span[data-added-id="${editorSel.id}"]`);
                if (sp) {
                    sp.style.fontSize = `${size * editorScale}px`;
                    const [_vx, vy] = editorViewport.convertToViewportPoint(a.x, a.y);
                    sp.style.top = `${vy - addedK(fontKeyOf(a)) * size * editorScale}px`;
                }
                recordHistory();
                notifyEditorSelection();
                return;
            }
        } else if (editorSel.type === 'tidx') {
            const index = editorSel.index;
            const sp = layer.querySelector(`span[data-tidx="${index}"]`);
            if (sp && sp._item) {
                const oldSize = sp._ptSize || (sp._item && sp._item.height) || 12;
                sp._ptSize = size;
                sp.style.fontSize = `${size * editorScale}px`;
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                const baselineVp = (parseFloat(sp.style.top) || (tx[5] - oldSize * editorScale)) + oldSize * editorScale;
                sp.style.top = `${baselineVp - size * editorScale}px`;
                sp.classList.add('modified');
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { fontSize: size });
                recordHistory();
                notifyEditorSelection();
                return;
            }
        }
    }
    const regionSpans = Array.from(layer.querySelectorAll('span[data-tidx].region-selected'));
    if (regionSpans.length) {
        regionSpans.forEach(sp => {
            const index = parseInt(sp.getAttribute('data-tidx'), 10);
            const oldSize = sp._ptSize || (sp._item && sp._item.height) || 12;
            sp._ptSize = size;
            sp.style.fontSize = `${size * editorScale}px`;
            if (sp._item) {
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                const baselineVp = (parseFloat(sp.style.top) || (tx[5] - oldSize * editorScale)) + oldSize * editorScale;
                sp.style.top = `${baselineVp - size * editorScale}px`;
                sp.classList.add('modified');
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { fontSize: size });
            }
        });
        recordHistory();
        notifyEditorSelection();
        return;
    }
}
window.editorSetFontSize = editorSetFontSize;

function editorSetFontFamily(key) {
    if (!key) return;
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    const activeInput = layer.querySelector('.editing-input');
    if (activeInput && typeof activeInput._setFont === 'function') {
        activeInput._setFont(key);
        return;
    }
    if (editorSel && editorSel.page === editorPage) {
        if (editorSel.type === 'added') {
            const a = addedTexts.find(t => t.id === editorSel.id);
            if (a) {
                a.fontFamily = key;
                const sp = layer.querySelector(`span[data-added-id="${editorSel.id}"]`);
                if (sp) applyFontToEl(sp, key);
                recordHistory();
                notifyEditorSelection();
                return;
            }
        } else if (editorSel.type === 'tidx') {
            const index = editorSel.index;
            const sp = layer.querySelector(`span[data-tidx="${index}"]`);
            if (sp && sp._item) {
                applyFontToEl(sp, key);
                sp.classList.add('modified');
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { fontFamily: key });
                recordHistory();
                notifyEditorSelection();
                return;
            }
        }
    }
    const regionSpans = Array.from(layer.querySelectorAll('span[data-tidx].region-selected'));
    if (regionSpans.length) {
        regionSpans.forEach(sp => {
            const index = parseInt(sp.getAttribute('data-tidx'), 10);
            applyFontToEl(sp, key);
            sp.classList.add('modified');
            if (sp._item) {
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { fontFamily: key });
            }
        });
        recordHistory();
        notifyEditorSelection();
        return;
    }
}
window.editorSetFontFamily = editorSetFontFamily;

function editorSetTextColor(color) {
    if (!color) return;
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    const activeInput = layer.querySelector('.editing-input');
    if (activeInput && typeof activeInput._setColor === 'function') {
        activeInput._setColor(color);
        return;
    }
    if (editorSel && editorSel.page === editorPage) {
        if (editorSel.type === 'added') {
            const a = addedTexts.find(t => t.id === editorSel.id);
            if (a) {
                a.color = color;
                const sp = layer.querySelector(`span[data-added-id="${editorSel.id}"]`);
                if (sp) sp.style.setProperty('--txt-color', color);
                recordHistory();
                notifyEditorSelection();
                return;
            }
        } else if (editorSel.type === 'tidx') {
            const index = editorSel.index;
            const sp = layer.querySelector(`span[data-tidx="${index}"]`);
            if (sp && sp._item) {
                sp.style.setProperty('--txt-color', color);
                sp.classList.add('modified');
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { color: color });
                recordHistory();
                notifyEditorSelection();
                return;
            }
        }
    }
    const regionSpans = Array.from(layer.querySelectorAll('span[data-tidx].region-selected'));
    if (regionSpans.length) {
        regionSpans.forEach(sp => {
            const index = parseInt(sp.getAttribute('data-tidx'), 10);
            sp.style.setProperty('--txt-color', color);
            sp.classList.add('modified');
            if (sp._item) {
                const tx = pdfjsLib.Util.transform(editorViewport.transform, sp._item.transform);
                maskOriginalPosition(index, sp._item, tx);
                updateModifiedItemFormatting(index, sp, { color: color });
            }
        });
        recordHistory();
        notifyEditorSelection();
        return;
    }
}
window.editorSetTextColor = editorSetTextColor;

(function bindSelection() {
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    layer.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest('.editing-input')) return;
        const sp = e.target.closest ? e.target.closest('span') : null;
        const box = e.target.closest ? e.target.closest('.editor-img-box') : null;
        if (sp && sp.hasAttribute('data-added-id')) editorSel = { type: 'added', page: editorPage, id: sp.getAttribute('data-added-id') };
        else if (sp && sp.hasAttribute('data-tidx')) editorSel = { type: 'tidx', page: editorPage, index: parseInt(sp.getAttribute('data-tidx'), 10) };
        else if (box && box.hasAttribute('data-img-key')) editorSel = { type: 'img', page: editorPage, key: box.getAttribute('data-img-key') };
        else editorSel = null;
        applySelHighlight();
    });
})();

// Chọn nhiều dòng bằng cách kéo khung trống; chỉ chọn các dòng nằm HOÀN TOÀN trong khung.
// Kéo một dòng đã chọn sẽ di chuyển cả nhóm, không làm mất font/màu gốc.
(function bindTextRegionSelection() {
    const layer = document.getElementById('editor-text-layer');
    if (!layer) return;
    let selected = new Set();
    let start = null;
    let rect = null;
    let groupDragging = false;
    let dragStart = null;
    let initial = [];

    function getBox(el) {
        const l = parseFloat(el.style.left) || 0;
        const t = parseFloat(el.style.top) || 0;
        return { left:l, top:t, right:l + el.offsetWidth, bottom:t + el.offsetHeight };
    }
    function setSelected(nodes) {
        selected = new Set(nodes);
        layer.querySelectorAll('span[data-tidx]').forEach(el => el.classList.toggle('region-selected', selected.has(el)));
    }
    function ensureRect() {
        if (rect) return rect;
        rect = document.createElement('div');
        rect.className = 'editor-region-select';
        rect.style.cssText = 'position:absolute;border:1px dashed #0078d4;background:rgba(0,120,212,.12);z-index:200;pointer-events:none;display:none;';
        layer.appendChild(rect);
        return rect;
    }
    layer.addEventListener('mousedown', e => {
        if (e.button !== 0 || editorCurrentTool !== 'text') return;
        const target = e.target.closest ? e.target.closest('span[data-tidx]') : null;
        if (selected.size && target && selected.has(target)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            groupDragging = true;
            dragStart = { x:e.clientX, y:e.clientY };
            initial = Array.from(selected).map(el => ({el, left:parseFloat(el.style.left)||0, top:parseFloat(el.style.top)||0}));
            document.body.style.userSelect = 'none';
            const move = ev => {
                const dx = ev.clientX - dragStart.x, dy = ev.clientY - dragStart.y;
                if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
                initial.forEach(o => {
                    o.el.style.left = (o.left + dx) + 'px';
                    o.el.style.top = (o.top + dy) + 'px';
                    o.el.classList.add('modified');
                    o.el.classList.add('dragging');
                    const ix = Number(o.el.getAttribute('data-tidx'));
                    if (o.el._item) {
                        const tx = pdfjsLib.Util.transform(editorViewport.transform, o.el._item.transform);
                        maskOriginalPosition(ix, o.el._item, tx);
                    }
                });
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.body.style.userSelect = '';
                groupDragging = false;
                initial.forEach(o => {
                    o.el.classList.remove('dragging');
                    const ix = Number(o.el.getAttribute('data-tidx'));
                    if (o.el._item) savePositionAndText(o.el, o.el._item, ix);
                });
                // Giữ nguyên các node đang chọn để có thể kéo cả nhóm thêm lần nữa.
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            return;
        }
        // Bắt đầu khung chọn khi nhấn vào vùng trống, không phải chữ/ảnh.
        if (target || (e.target.closest && e.target.closest('.editor-img-box')) || e.target.closest('.editing-input')) {
            if (!e.shiftKey && !target) setSelected([]);
            return;
        }
        const bounds = layer.getBoundingClientRect();
        start = { x:e.clientX - bounds.left, y:e.clientY - bounds.top };
        const box = ensureRect();
        box.style.left = start.x + 'px'; box.style.top = start.y + 'px';
        box.style.width = '0px'; box.style.height = '0px'; box.style.display = 'block';
        if (!e.shiftKey) setSelected([]);
        e.preventDefault();
        const move = ev => {
            const x = ev.clientX - bounds.left, y = ev.clientY - bounds.top;
            box.style.left = Math.min(start.x,x) + 'px';
            box.style.top = Math.min(start.y,y) + 'px';
            box.style.width = Math.abs(x-start.x) + 'px';
            box.style.height = Math.abs(y-start.y) + 'px';
        };
        const up = ev => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            const x = ev.clientX - bounds.left, y = ev.clientY - bounds.top;
            const r = {left:Math.min(start.x,x), top:Math.min(start.y,y), right:Math.max(start.x,x), bottom:Math.max(start.y,y)};
            box.style.display = 'none';
            const inside = Array.from(layer.querySelectorAll('span[data-tidx]')).filter(el => {
                const b = getBox(el);
                return b.left >= r.left && b.top >= r.top && b.right <= r.right && b.bottom <= r.bottom && (el.textContent || '').trim();
            });
            setSelected(e.shiftKey ? [...selected, ...inside] : inside);
            start = null;
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
})();

function editorCopySelection() {
    const sel = editorSel;
    if (!sel || sel.page !== editorPage) return false;
    const layer = document.getElementById('editor-text-layer');
    try {
        if (sel.type === 'added') {
            const a = addedTexts.find(t => t.id === sel.id);
            if (!a) return false;
            editorClip = { kind: 'text', page: a.page, text: a.text, x: a.x, y: a.y, fontSize: a.fontSize, color: a.color, isBold: !!a.isBold, isItalic: !!a.isItalic, fontFamily: fontKeyOf(a) };
            return true;
        }
        if (sel.type === 'tidx') {
            const key = `${sel.page}_${sel.index}`;
            const m = modifiedTexts.find(t => t.key === key);
            if (m) {
                if (!(m.text || '').trim()) return false;
                editorClip = { kind: 'text', page: sel.page, text: m.text, x: m.x, y: m.y, fontSize: m.fontSize, color: m.color || '#000000', isBold: !!m.isBold, isItalic: !!m.isItalic, fontFamily: fontKeyOf(m) };
                return true;
            }
            const sp = layer.querySelector(`span[data-tidx="${sel.index}"]`);
            const item = sp && sp._item;
            if (!item || !String(item.str).trim()) return false;
            editorClip = { kind: 'text', page: sel.page, text: item.str, x: item.transform[4], y: item.transform[5], fontSize: item.height, color: sampleTextColors(item).color, isBold: sp.classList.contains('is-bold'), isItalic: sp.classList.contains('is-italic'), fontFamily: 'roboto' };
            return true;
        }
        if (sel.type === 'img') {
            const box = layer.querySelector(`.editor-img-box[data-img-key="${sel.key}"]`);
            if (!box) return false;
            const saved = modifiedImages.find(m => m.key === sel.key);
            let src, thumb;
            if (saved && saved.isCopy) {
                src = { x0: saved.x0, y0: saved.y0, x1: saved.x1, y1: saved.y1, srcPage: saved.srcPage || saved.page };
                thumb = saved.thumb;
            } else if (box._b) {
                src = { x0: box._b.x0, y0: box._b.y0, x1: box._b.x1, y1: box._b.y1, srcPage: sel.page };
                thumb = box._crop ? box._crop() : null;
            } else return false;
            editorClip = {
                kind: 'img', page: sel.page, src, thumb,
                width: src.x1 - src.x0, height: src.y1 - src.y0,
                x: saved ? saved.newX : src.x0, y: saved ? saved.newY : src.y0
            };
            return true;
        }
    } catch (err) { console.error('Lỗi sao chép:', err); }
    return false;
}

function editorPasteClip() {
    const c = editorClip;
    if (!c || !editorPdfJsDoc) return;
    const off = c.page === editorPage ? PASTE_OFFSET : 0;
    const nx = c.x + off, ny = c.y - off;
    if (c.kind === 'text') {
        const id = 'a' + (++addedIdSeq);
        addedTexts.push({ id, page: editorPage, text: c.text, x: nx, y: ny, fontSize: c.fontSize, color: c.color, isBold: c.isBold, isItalic: c.isItalic, fontFamily: c.fontFamily });
        editorSel = { type: 'added', page: editorPage, id };
    } else if (c.kind === 'img') {
        const key = `${editorPage}_imgc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        modifiedImages.push({
            key, page: editorPage, _seq: ++editorSeq, isCopy: true, srcPage: c.src.srcPage,
            x0: c.src.x0, y0: c.src.y0, x1: c.src.x1, y1: c.src.y1,
            newX: nx, newY: ny, width: c.width, height: c.height,
            bgColor: '#ffffff', thumb: c.thumb || null
        });
        editorSel = { type: 'img', page: editorPage, key };
    }
    c.page = editorPage; c.x = nx; c.y = ny;
    recordHistory();
    editorRenderPage();
}

// Hộp ảnh cho các bản sao ảnh (kéo để di chuyển, click đúp để xóa bản sao)
function buildImageCopyBoxes(textLayerDiv) {
    modifiedImages.filter(m => m.isCopy && m.page === editorPage).forEach(m => {
        const w = m.width * editorScale, h = m.height * editorScale;
        const [bx, by] = editorViewport.convertToViewportPoint(m.newX, m.newY);
        const box = document.createElement('div');
        box.className = 'editor-img-box modified';
        box.setAttribute('data-img-key', m.key);
        box.title = 'Bản sao ảnh • Kéo để di chuyển • Click đúp để xóa bản sao';
        box.style.left = bx + 'px';
        box.style.top = (by - h) + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
        if (m.thumb) box.style.backgroundImage = `url(${m.thumb})`;
        textLayerDiv.appendChild(box);
        box.addEventListener('mousedown', e => {
            if (editorCurrentTool !== 'text' || e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startLeft = parseFloat(box.style.left), startTop = parseFloat(box.style.top);
            let moved = false;
            const onMove = ev => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                moved = true;
                box.classList.add('dragging');
                box.style.left = (startLeft + dx) + 'px';
                box.style.top = (startTop + dy) + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                box.classList.remove('dragging');
                if (!moved) return;
                const left = parseFloat(box.style.left), top = parseFloat(box.style.top);
                const [px, py] = editorViewport.convertToPdfPoint(left, top + h);
                const cur = modifiedImages.find(x => x.key === m.key);
                if (!cur) return;
                cur.newX = px; cur.newY = py; cur._seq = ++editorSeq;
                recordHistory();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        box.addEventListener('dblclick', () => {
            const ei = modifiedImages.findIndex(x => x.key === m.key);
            if (ei === -1) return;
            modifiedImages.splice(ei, 1);
            if (editorSel && editorSel.key === m.key) editorSel = null;
            recordHistory();
            editorRenderPage();
        });
    });
}

// ===================== Lịch sử: Hoàn tác / Làm lại =====================
let editorHistStack = [];
let editorHistIndex = -1;
let editorHistRestoring = false;

function cloneShape(sh) {
    return Object.assign({}, sh, sh.points ? { points: sh.points.map(p => ({ x: p.x, y: p.y })) } : {});
}

function rescaleShape(sh, from, to) {
    if (!(from > 0) || Math.abs(from - to) < 1e-9) return sh;
    const r = to / from;
    [ 'startX', 'startY', 'endX', 'endY', 'size' ].forEach(k => { if (typeof sh[k] === 'number') sh[k] *= r; });
    if (sh.points) sh.points.forEach(p => { p.x *= r; p.y *= r; });
    if (sh.vp && typeof sh.vp.clone === 'function') sh.vp = sh.vp.clone({ scale: to });
    return sh;
}

function snapshotState() {
    const sn = {
        scale: editorScale,
        page: editorPage,
        t: modifiedTexts.map(o => Object.assign({}, o)),
        i: modifiedImages.map(o => Object.assign({}, o)),
        a: addedTexts.map(o => Object.assign({}, o)),
        s: editorShapes.map(cloneShape),
        g: editorSigs.map(o => Object.assign({}, o))
    };
    sn.sig = JSON.stringify([ sn.t, sn.i, sn.a, sn.s.map(o => { const c = Object.assign({}, o); delete c.vp; return c; }), sn.g.map(o => [ o.id, o.page, o.x, o.y, o.w, o.h ]) ]);
    return sn;
}

function recordHistory() {
    if (editorHistRestoring) return;
    const sn = snapshotState();
    editorHistStack.length = editorHistIndex + 1;
    if (editorHistIndex >= 0 && editorHistStack[editorHistIndex].sig === sn.sig) { updateHistoryButtons(); return; }
    editorHistStack.push(sn);
    if (editorHistStack.length > 100) editorHistStack.shift();
    editorHistIndex = editorHistStack.length - 1;
    updateHistoryButtons();
}

function resetHistory() {
    editorHistStack = [];
    editorHistIndex = -1;
    recordHistory();
}

function updateHistoryButtons() {
    const canUndo = editorHistIndex > 0;
    const canRedo = editorHistIndex < editorHistStack.length - 1;
    document.querySelectorAll('#editor-undo-btn, #rb-undo-btn').forEach(u => u.disabled = !canUndo);
    document.querySelectorAll('#editor-redo-btn, #rb-redo-btn').forEach(r => r.disabled = !canRedo);
}

function restoreSnapshot(sn, goPage) {
    editorHistRestoring = true;
    try {
        modifiedTexts = sn.t.map(o => Object.assign({}, o));
        modifiedImages = sn.i.map(o => Object.assign({}, o));
        addedTexts = sn.a.map(o => Object.assign({}, o));
        editorShapes = sn.s.map(o => rescaleShape(cloneShape(o), sn.scale, editorScale));
        editorSigs = (sn.g || []).map(o => Object.assign({}, o));
        if (goPage && editorPdfJsDoc && goPage >= 1 && goPage <= editorPdfJsDoc.numPages) editorPage = goPage;
    } finally {
        editorHistRestoring = false;
    }
    updateHistoryButtons();
    editorRenderPage();
}

function editorUndo() {
    if (!editorPdfJsDoc || editorHistIndex <= 0) return;
    const leaving = editorHistStack[editorHistIndex];
    editorHistIndex--;
    restoreSnapshot(editorHistStack[editorHistIndex], leaving.page);
}

function editorRedo() {
    if (!editorPdfJsDoc || editorHistIndex >= editorHistStack.length - 1) return;
    editorHistIndex++;
    restoreSnapshot(editorHistStack[editorHistIndex], editorHistStack[editorHistIndex].page);
}

// ===================== Phóng to / thu nhỏ =====================
const ZOOM_STEPS = [ 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250 ];
const ZOOM_BASE = 1.5;

function updateZoomLabel() {
    const el = document.getElementById('editor-zoom-label');
    if (el) el.textContent = Math.round(editorScale / ZOOM_BASE * 100) + '%';
}

async function setEditorZoom(newScale) {
    if (!editorPdfJsDoc) return;
    newScale = Math.min(ZOOM_BASE * 2.5, Math.max(ZOOM_BASE * 0.1, Math.round(newScale * 1000) / 1000));
    if (Math.abs(newScale - editorScale) < 0.001) return;
    const old = editorScale;
    editorShapes.forEach(sh => rescaleShape(sh, old, newScale));
    const sc = document.querySelector('.editor-stage-scroll');
    const fx = sc && sc.scrollWidth ? (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth : 0.5;
    const fy = sc && sc.scrollHeight ? (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight : 0;
    editorScale = newScale;
    updateZoomLabel();
    await editorRenderPage();
    if (sc) {
        sc.scrollLeft = fx * sc.scrollWidth - sc.clientWidth / 2;
        sc.scrollTop = fy * sc.scrollHeight - sc.clientHeight / 2;
    }
}

function editorZoomBy(dir) {
    const cur = Math.round(editorScale / ZOOM_BASE * 100);
    let target = cur;
    if (dir > 0) {
        target = ZOOM_STEPS.find(p => p > cur + 1) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    } else {
        for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) { if (ZOOM_STEPS[i] < cur - 1) { target = ZOOM_STEPS[i]; break; } }
        if (target === cur) target = ZOOM_STEPS[0];
    }
    setEditorZoom(target / 100 * ZOOM_BASE);
}

function editorZoomFit() {
    if (!editorPdfJsDoc || !editorViewport) return;
    const sc = document.querySelector('.editor-stage-scroll');
    const baseWidth = editorViewport.width / editorScale;
    const avail = sc.clientWidth - 56;
    if (avail > 100 && baseWidth > 0) setEditorZoom(avail / baseWidth);
}

(function bindZoomWheel() {
    const sc = document.querySelector('.editor-stage-scroll');
    if (!sc) return;
    sc.addEventListener('wheel', e => {
        if (!(e.ctrlKey || e.metaKey) || !editorPdfJsDoc) return;
        e.preventDefault();
        setEditorZoom(editorScale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
})();


function editorChangePage(dir) {
    if (!editorPdfJsDoc) return;
    let targetPage = editorPage + dir;
    if (targetPage >= 1 && targetPage <= editorPdfJsDoc.numPages) {
        editorPage = targetPage;
        editorRenderPage();
    }
}

function maskOriginalPosition(index, originalItem, tx) {
    const textLayerDiv = document.getElementById('editor-text-layer');
    if (textLayerDiv.querySelector(`.original-mask[data-index="${index}"]`)) return;
    const mask = document.createElement('div');
    mask.className = 'original-mask';
    mask.setAttribute('data-index', index);
    const _pm = modifiedTexts.find(m => m.key === `${editorPage}_${index}`);
    mask.style.setProperty('--mask-bg', (_pm && _pm.bgColor) || sampleTextColors(originalItem).bg);
    const origWidth = originalItem.width * editorScale;
    const origHeight = originalItem.height * editorScale;
    const _pad = Math.max(2, origHeight * 0.15);
    mask.style.left = `${tx[4] - _pad}px`;
    mask.style.top = `${tx[5] - origHeight - 2}px`;
    mask.style.width = `${origWidth + _pad * 2}px`;
    mask.style.height = `${origHeight * 1.28 + 4}px`;
    textLayerDiv.appendChild(mask);
}

function enableDragAndEdit(span, originalItem, index, tx) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY;
    let startLeft, startTop;
    const textLayerDiv = document.getElementById('editor-text-layer');
    span.addEventListener('mousedown', e => {
        if (editorCurrentTool !== 'text') return;
        if (e.button !== 0) return;
        if (textLayerDiv.querySelector(`.editing-input[data-index="${index}"]`)) return;
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseFloat(span.style.left);
        startTop = parseFloat(span.style.top);
        document.body.style.userSelect = 'none';
        const onMouseMove = ev => {
            if (!isDragging) return;
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasMoved = true;
            }
            if (hasMoved) {
                span.style.left = `${startLeft + dx}px`;
                span.style.top = `${startTop + dy}px`;
                span.classList.add('dragging');
                span.classList.add('modified');
                maskOriginalPosition(index, originalItem, tx);
            }
        };
        const onMouseUp = () => {
            isDragging = false;
            document.body.style.userSelect = '';
            span.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (hasMoved) {
                savePositionAndText(span, originalItem, index);
            }
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
    span.addEventListener('dblclick', () => {
        if (editorCurrentTool !== 'text') return;
        makeEditable(span, originalItem, index, tx);
    });
}

function sampleTextColors(originalItem) {
    const res = {
        color: '#000000',
        bg: '#ffffff'
    };
    try {
        const cv = document.getElementById('editor-pdf-canvas');
        const ctx = cv.getContext('2d', {
            willReadFrequently: true
        });
        const [vx, vy] = editorViewport.convertToViewportPoint(originalItem.transform[4], originalItem.transform[5]);
        const w = Math.max(1, Math.round(originalItem.width * editorScale));
        const h = Math.max(1, Math.round(originalItem.height * editorScale));
        const x0 = Math.max(0, Math.round(vx)), y0 = Math.max(0, Math.round(vy - h));
        const rw = Math.min(w, cv.width - x0), rh = Math.min(h, cv.height - y0);
        if (rw > 0 && rh > 0) {
            const d = ctx.getImageData(x0, y0, rw, rh).data;
            let minL = 1e9, best = null;
            for (let i = 0; i < d.length; i += 4) {
                const L = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
                if (L < minL) {
                    minL = L;
                    best = [ d[i], d[i + 1], d[i + 2] ];
                }
            }
            const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
            if (best && minL < 200) res.color = hex(best);
        }
        const bx = Math.max(0, x0 - 3), by = Math.min(cv.height - 1, Math.max(0, y0 + Math.floor(h / 2)));
        const bp = ctx.getImageData(bx, by, 1, 1).data;
        res.bg = '#' + [ bp[0], bp[1], bp[2] ].map(v => v.toString(16).padStart(2, '0')).join('');
    } catch (e) {}
    return res;
}

function savePositionAndText(span, originalItem, index) {
    const htmlLeft = parseFloat(span.style.left);
    const htmlTop = parseFloat(span.style.top);
    const curSize = span._ptSize || originalItem.height;
    const y_viewport = htmlTop + curSize * editorScale;
    const [pdfX, pdfY] = editorViewport.convertToPdfPoint(htmlLeft, y_viewport);
    const key = `${editorPage}_${index}`;
    const existingIndex = modifiedTexts.findIndex(item => item.key === key);
    const isBold = span.classList.contains('is-bold');
    const isItalic = span.classList.contains('is-italic');
  const prev = existingIndex !== -1 ? modifiedTexts[existingIndex] : null;
  const fontKey = prev ? fontKeyOf(prev) : fontKeyOf({ fontFamily: span.style.fontFamily });
  // Di chuyển đơn thuần không được chuyển font/màu gốc sang font mặc định.
  // Nếu trước đó người dùng đã sửa font/màu thì tiếp tục giữ định dạng chỉnh sửa đó.
  const preserveOriginalFormatting = prev ? !!prev.preserveOriginalFormatting : true;
  if (!preserveOriginalFormatting) applyFontToEl(span, fontKey);
  const cols = prev && prev.color ? {
        color: prev.color,
        bg: prev.bgColor
    } : sampleTextColors(originalItem);
  if (preserveOriginalFormatting) span.style.removeProperty('--txt-color');
  else span.style.setProperty('--txt-color', cols.color);
    const changeData = {
        key: key, _seq: ++editorSeq,
        page: editorPage,
        color: cols.color,
        bgColor: cols.bg,
        index: index,
        text: span.textContent,
        origX: originalItem.transform[4],
        origY: originalItem.transform[5],
        origWidth: originalItem.width,
        origHeight: originalItem.height,
        x: pdfX,
        y: pdfY,
        fontSize: curSize,
        htmlLeft: htmlLeft,
        htmlTop: htmlTop,
        isBold: isBold,
        isItalic: isItalic,
        fontFamily: fontKey,
        preserveOriginalFormatting: preserveOriginalFormatting
    };
    if (existingIndex !== -1) {
        changeData.text = modifiedTexts[existingIndex].text;
        modifiedTexts[existingIndex] = changeData;
    } else {
        modifiedTexts.push(changeData);
    }
    recordHistory();
}

function makeEditable(span, originalItem, index, tx) {
    const textLayerDiv = document.getElementById('editor-text-layer');
    if (textLayerDiv.querySelector(`.editing-input[data-index="${index}"]`)) return;
    const currentText = span.textContent;
    const input = document.createElement('input');
    input.className = 'editing-input';
    input.setAttribute('data-index', index);
    input.value = currentText;
    input.style.left = span.style.left;
    input.style.top = span.style.top;
    input.style.fontSize = span.style.fontSize;
    const _prevMod = modifiedTexts.find(m => m.key === `${editorPage}_${index}`);
    let editFont = _prevMod && !_prevMod.preserveOriginalFormatting ? fontKeyOf(_prevMod) : fontKeyOf({ fontFamily: span.style.fontFamily });
    let fontWasChanged = !!(_prevMod && !_prevMod.preserveOriginalFormatting);
    const originalCssFont = span.style.fontFamily || fontCss(editFont);
    const fontSel = document.getElementById('editor-text-font');
    if (fontSel) fontSel.value = fontWasChanged ? editFont : '';
    input.style.fontFamily = originalCssFont;
    input.style.fontWeight = span.classList.contains('is-bold') ? '700' : '400';
    input.style.fontStyle = span.classList.contains('is-italic') ? 'italic' : 'normal';
    const fitWidth = () => {
        const measureFont = fontWasChanged ? fontCss(editFont) : originalCssFont;
        _measureCtx.font = `${input.classList.contains('is-italic') ? 'italic ' : ''}${input.classList.contains('is-bold') ? 'bold ' : ''}${parseFloat(input.style.fontSize)}px ${measureFont}`;
        const w = _measureCtx.measureText(input.value || ' ').width;
        input.style.width = Math.max(span.offsetWidth, Math.ceil(w)) + 30 + 'px';
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    let editColor = (_prevMod && _prevMod.color) || sampleTextColors(originalItem).color;
    const colorPicker = document.getElementById('editor-text-color');
    if (colorPicker) colorPicker.value = editColor;
    input.style.setProperty('--txt-color', editColor);

    input._toggleBold = () => {
        input.classList.toggle('is-bold');
        span.classList.toggle('is-bold');
        fitWidth();
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input._toggleItalic = () => {
        input.classList.toggle('is-italic');
        span.classList.toggle('is-italic');
        fitWidth();
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input._setSize = (newSize) => {
        editSize = newSize;
        input.style.fontSize = `${newSize * editorScale}px`;
        input.style.top = `${baselineVp - newSize * editorScale}px`;
        fitWidth();
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input._setFont = (newKey) => {
        editFont = fontKeyOf({ fontFamily: newKey });
        fontWasChanged = true;
        applyFontToEl(input, editFont);
        fitWidth();
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input._setColor = (newColor) => {
        editColor = newColor;
        input.style.setProperty('--txt-color', editColor);
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input._getFormat = () => ({
        isEditing: true,
        hasSelection: true,
        isBold: input.classList.contains('is-bold'),
        isItalic: input.classList.contains('is-italic'),
        color: editColor,
        fontSize: editSize,
        fontKey: editFont
    });

    let pickerBusy = false, saved = false;
    const onPickDown = () => { pickerBusy = true; };
    const onPick = () => { editColor = colorPicker.value; input.style.setProperty('--txt-color', editColor); };
    const endPick = () => { setTimeout(() => { pickerBusy = false; if (input.isConnected) input.focus(); }, 0); };
    const onPickChange = () => { onPick(); endPick(); };
    if (colorPicker) {
        colorPicker.addEventListener('mousedown', onPickDown);
        colorPicker.addEventListener('input', onPick);
        colorPicker.addEventListener('change', onPickChange);
        colorPicker.addEventListener('blur', endPick);
    }
    const startSize = span._ptSize || originalItem.height;
    let editSize = startSize;
    const baselineVp = parseFloat(span.style.top) + startSize * editorScale;
    const sizeInput = document.getElementById('editor-text-size');
    if (sizeInput) sizeInput.value = String(Math.round(startSize * 10) / 10);
    const onSize = () => {
        const v = parseFloat(sizeInput.value);
        if (!(v >= 4 && v <= 200)) return;
        editSize = v;
        input.style.fontSize = `${v * editorScale}px`;
        input.style.top = `${baselineVp - v * editorScale}px`;
    };
    const onSizeKey = e => { if (e.key === 'Enter') { e.preventDefault(); input.focus(); saveChange(); } };
    if (sizeInput) {
        sizeInput.addEventListener('mousedown', onPickDown);
        sizeInput.addEventListener('input', onSize);
        sizeInput.addEventListener('keydown', onSizeKey);
        sizeInput.addEventListener('blur', endPick);
    }
    const onFont = () => {
        editFont = fontKeyOf({ fontFamily: fontSel.value });
        fontWasChanged = true;
        applyFontToEl(input, editFont);
        fitWidth();
        endPick();
    };
    if (fontSel) {
        fontSel.addEventListener('mousedown', onPickDown);
        fontSel.addEventListener('change', onFont);
        fontSel.addEventListener('blur', endPick);
    }
    if (span.classList.contains('is-bold')) input.classList.add('is-bold');
    if (span.classList.contains('is-italic')) input.classList.add('is-italic');
    textLayerDiv.appendChild(input);
    fitWidth();
    input.addEventListener('input', fitWidth);
    input.focus();
    input.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const isB = e.key.toLowerCase() === 'b';
        const isI = e.key.toLowerCase() === 'i';
        if (!isB && !isI) return;
        e.preventDefault();
        if (isB) {
            input.classList.toggle('is-bold');
            span.classList.toggle('is-bold');
            fitWidth();
        }
        if (isI) {
            input.classList.toggle('is-italic');
            span.classList.toggle('is-italic');
            fitWidth();
        }
    });
    const saveChange = () => {
        if (saved) return;
        saved = true;
        if (colorPicker) {
            colorPicker.removeEventListener('mousedown', onPickDown);
            colorPicker.removeEventListener('input', onPick);
            colorPicker.removeEventListener('change', onPickChange);
            colorPicker.removeEventListener('blur', endPick);
        }
        if (sizeInput) {
            sizeInput.removeEventListener('mousedown', onPickDown);
            sizeInput.removeEventListener('input', onSize);
            sizeInput.removeEventListener('keydown', onSizeKey);
            sizeInput.removeEventListener('blur', endPick);
        }
        if (fontSel) {
            fontSel.removeEventListener('mousedown', onPickDown);
            fontSel.removeEventListener('change', onFont);
            fontSel.removeEventListener('blur', endPick);
        }
        const newText = input.value;
        span.textContent = newText;
        const isBold = input.classList.contains('is-bold');
        const isItalic = input.classList.contains('is-italic');
        input.remove();
        span.style.setProperty('--txt-color', editColor);
        if (fontWasChanged) applyFontToEl(span, editFont);
        span._ptSize = editSize;
        span.style.fontSize = `${editSize * editorScale}px`;
        span.style.top = `${baselineVp - editSize * editorScale}px`;
        const _sampled = (modifiedTexts.find(m => m.key === `${editorPage}_${index}`) || {}).color ? null : sampleTextColors(originalItem);
        span.classList.add('modified');
        maskOriginalPosition(index, originalItem, tx);
        const htmlLeft = parseFloat(span.style.left);
        const htmlTop = parseFloat(span.style.top);
        const y_viewport = baselineVp;
        const [pdfX, pdfY] = editorViewport.convertToPdfPoint(htmlLeft, y_viewport);
        const key = `${editorPage}_${index}`;
        const existingIndex = modifiedTexts.findIndex(item => item.key === key);
        const prev = existingIndex !== -1 ? modifiedTexts[existingIndex] : null;
        const cols = prev && prev.color ? {
            color: prev.color,
            bg: prev.bgColor
        } : _sampled || sampleTextColors(originalItem);
        const changeData = {
            key: key, _seq: ++editorSeq,
            page: editorPage,
            color: editColor,
            bgColor: cols.bg,
            index: index,
            text: newText,
            origX: originalItem.transform[4],
            origY: originalItem.transform[5],
            origWidth: originalItem.width,
            origHeight: originalItem.height,
            x: pdfX,
            y: pdfY,
            fontSize: editSize,
            htmlLeft: htmlLeft,
            htmlTop: htmlTop,
            isBold: isBold,
            isItalic: isItalic,
            fontFamily: editFont,
            preserveOriginalFormatting: !fontWasChanged
        };
        if (existingIndex !== -1) {
            modifiedTexts[existingIndex] = changeData;
        } else {
            modifiedTexts.push(changeData);
        }
        recordHistory();
        if (typeof notifyEditorSelection === 'function') notifyEditorSelection();
    };
    input.addEventListener('blur', e => {
        if (pickerBusy) return;
        const rt = e.relatedTarget || document.activeElement;
        if (isRibbonOrPicker(rt)) return;
        saveChange();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveChange();
    });
}

async function fetchFontWithFallback(style) {
    let fontName = "Roboto-Regular.ttf";
    if (style === "bolditalic") fontName = "Roboto-BoldItalic.ttf"; else if (style === "bold") fontName = "Roboto-Bold.ttf"; else if (style === "italic") fontName = "Roboto-Italic.ttf";
    const urls = [ `https://raw.githubusercontent.com/bpampuch/pdfmake/master/examples/fonts/Roboto-${fontName.replace('Roboto-', '')}`, `https://cdn.jsdelivr.net/gh/bpampuch/pdfmake@0.1.66/examples/fonts/${fontName}`, `https://cdn.jsdelivr.net/npm/pdfmake@0.1.66/fonts/Roboto/${fontName}`, `https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/${fontName}` ];
    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                const bytes = await response.arrayBuffer();
                if (bytes.byteLength > 1e3) {
                    return bytes;
                }
            }
        } catch (err) {
            console.warn(`Thử tải font từ ${url} thất bại...`);
        }
    }
    throw new Error("Không thể tải font Roboto Unicode. Vui lòng kiểm tra kết nối mạng!");
}

async function getUnicodeFontBytes(style = "regular") {
    const _emb = getEmbeddedFont(style);
    if (_emb) return _emb;
    if (cachedUnicodeFontBytes[style]) {
        return cachedUnicodeFontBytes[style];
    }
    const fontMap = {
        regular: "fonts/Roboto-Regular.ttf",
        bold: "fonts/Roboto-Bold.ttf",
        italic: "fonts/Roboto-Italic.ttf",
        bolditalic: "fonts/Roboto-BoldItalic.ttf"
    };
    const path = fontMap[style] || fontMap.regular;
    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error("Không tìm thấy font: " + path);
        }
        const buffer = await response.arrayBuffer();
        cachedUnicodeFontBytes[style] = buffer;
        console.log("Đã load font:", style);
        return buffer;
    } catch (err) {
        console.warn("Không có font local, thử tải từ CDN:", err);
        try {
            const buffer = await fetchFontWithFallback(style);
            cachedUnicodeFontBytes[style] = buffer;
            return buffer;
        } catch (cdnErr) {
            console.error(cdnErr);
            alert("Không tải được font Unicode.\n" + "Hãy kiểm tra thư mục fonts/ hoặc kết nối mạng.");
            throw cdnErr;
        }
    }
}

async function editorExportPDF(captureCb) {
    if (!editorPdfDataBytes) {
        alert('Vui lòng mở một file PDF trước khi xuất.');
        return;
    }
    if (typeof PDFLib === 'undefined' || !PDFLib.PDFDocument) {
        alert('Thư viện PDF chưa tải xong. Vui lòng tải lại trang hoặc kiểm tra kết nối mạng.');
        return;
    }
    if (!captureCb) logAction("edit_pdf");
    const btn = document.getElementById('editor-download-btn');
    btn.textContent = 'Đang xử lý xuất PDF...';
    btn.disabled = true;
    try {
        const pdfDoc = await PDFLib.PDFDocument.load(editorPdfDataBytes);
        if (typeof fontkit !== 'undefined') {
            pdfDoc.registerFontkit(fontkit);
        } else {
            throw new Error("Không tìm thấy bộ tiện ích thư viện Fontkit.");
        }
        const pages = pdfDoc.getPages();
        let regularFont, boldFont, italicFont, boldItalicFont;
        let usingStdFont = false;
        let fontBytesList = [ 'regular', 'bold', 'italic', 'bolditalic' ].map(getEmbeddedFont);
        if (fontBytesList.some(b => !b)) fontBytesList = null;
        if (!fontBytesList) try {
            fontBytesList = await Promise.all([ './fonts/Roboto-Regular.ttf', './fonts/Roboto-Bold.ttf', './fonts/Roboto-Italic.ttf', './fonts/Roboto-BoldItalic.ttf' ].map(u => fetch(u).then(res => {
                if (!res.ok) throw new Error(u);
                return res.arrayBuffer();
            })));
        } catch (localErr) {
            console.warn("Không có font local, thử tải từ CDN:", localErr);
            try {
                fontBytesList = await Promise.all([ 'regular', 'bold', 'italic', 'bolditalic' ].map(fetchFontWithFallback));
            } catch (cdnErr) {
                fontBytesList = null;
            }
        }
        if (fontBytesList) {
            regularFont = await pdfDoc.embedFont(fontBytesList[0], {
                subset: true
            });
            boldFont = await pdfDoc.embedFont(fontBytesList[1], {
                subset: true
            });
            italicFont = await pdfDoc.embedFont(fontBytesList[2], {
                subset: true
            });
            boldItalicFont = await pdfDoc.embedFont(fontBytesList[3], {
                subset: true
            });
        } else {
            const hasVietnameseText = modifiedTexts.concat(addedTexts).some(o =>
                /[À-ỹĐđ]/.test(String(o.text || ''))
            );
            if (hasVietnameseText) {
                throw new Error('Không tải được font Unicode nên chưa thể xuất an toàn: văn bản tiếng Việt có thể mất dấu. Hãy thử lại khi có mạng hoặc kiểm tra thư mục fonts/ (Roboto-Regular.ttf, Roboto-Bold.ttf, Roboto-Italic.ttf, Roboto-BoldItalic.ttf).');
            }
            usingStdFont = true;
            regularFont = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
            boldFont = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.HelveticaBold);
            italicFont = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.HelveticaOblique);
            boldItalicFont = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.HelveticaBoldOblique);
        }
        // Nhúng thêm các font người dùng đã chọn (chỉ font thực sự được dùng)
        const extraFonts = {};
        if (!usingStdFont) {
            const usedKeys = new Set();
            modifiedTexts.concat(addedTexts).forEach(o => { const k = fontKeyOf(o); if (k !== 'roboto') usedKeys.add(k); });
            for (const k of usedKeys) {
                try {
                    extraFonts[k] = {};
                    const info = fontInfo(k);
                    if (isLocalKey(k)) {
                        await ensureLocalFonts();
                        const faces = window.LOCAL_FONTS[localFamily(k)];
                        if (!faces || !faces.regular) throw new Error('Không tìm thấy font trong máy: ' + localFamily(k));
                        for (const st of info.styles) {
                            const fd = faces[st] || faces.regular;
                            if (extraFonts[k][fd._emb]) { extraFonts[k][st] = extraFonts[k][fd._emb]; continue; }
                            const buf = new Uint8Array(await (await fd.blob()).arrayBuffer());
                            const ef = await pdfDoc.embedFont(buf, { subset: true });
                            fd._emb = st;
                            extraFonts[k][st] = ef;
                        }
                    } else for (const st of info.styles) {
                        extraFonts[k][st] = await pdfDoc.embedFont(fontBytes(k, st), { subset: true });
                    }
                } catch (fe) {
                    console.error('Không nhúng được font ' + k + ', dùng Roboto thay thế:', fe);
                    delete extraFonts[k];
                }
            }
        }
        const pickFont = (o) => {
            const b = !!o.isBold, i = !!o.isItalic;
            const st = b && i ? 'bolditalic' : b ? 'bold' : i ? 'italic' : 'regular';
            const ef = extraFonts[fontKeyOf(o)];
            if (ef) return ef[st] || ef.regular;
            return st === 'bolditalic' ? boldItalicFont : st === 'bold' ? boldFont : st === 'italic' ? italicFont : regularFont;
        };
        const unsupportedChars = new Set();
        let failedItems = 0;
        const safeText = (text, font) => {
            let set = null;
            try { set = new Set(font.getCharacterSet()); } catch (e) {}
            let out = '';
            for (const ch of String(text).replace(/[\r\n\t]+/g, ' ')) {
                if (!set || set.has(ch.codePointAt(0))) out += ch; else { unsupportedChars.add(ch); out += '?'; }
            }
            return out;
        };
        modifiedTexts.forEach(change => {
            try {
                const pageObj = pages[change.page - 1];
                if (!pageObj) throw new Error('Trang PDF không tồn tại: ' + change.page);
                const h = change.origHeight || change.fontSize;
                const pad = Math.max(2, h * 0.15);
                const c = hexToRgb(change.bgColor || '#ffffff');
                pageObj.drawRectangle({
                    x: change.origX - pad,
                    y: change.origY - h * 0.28,
                    width: change.origWidth + pad * 2,
                    height: h * 1.28 + 2,
                    color: PDFLib.rgb(c.r, c.g, c.b)
                });
            } catch (e) { failedItems++; console.error('Lỗi che nền chữ cũ:', e); }
        });
        let movedImgFailed = 0;
        if (modifiedImages.length) {
            const renderCache = {};
            const SC = 3;
            try {
                modifiedImages.forEach(im => {
                    if (im.isCopy) return;
                    try {
                        const c = hexToRgb(im.bgColor || '#ffffff');
                        pages[im.page - 1].drawRectangle({
                            x: im.x0 - 1, y: im.y0 - 1, width: im.width + 2, height: im.height + 2,
                            color: PDFLib.rgb(c.r, c.g, c.b)
                        });
                    } catch (e) { movedImgFailed++; console.error('Lỗi che ảnh cũ:', e); }
                });
                for (const im of modifiedImages) {
                    try {
                        const srcPg = im.srcPage || im.page;
                        if (!renderCache[srcPg]) {
                            const pg = await editorPdfJsDoc.getPage(srcPg);
                            const vp = pg.getViewport({ scale: SC });
                            const cv = document.createElement('canvas');
                            cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
                            await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
                            renderCache[srcPg] = { cv, vp };
                        }
                        const { cv, vp } = renderCache[srcPg];
                        const r = imgBoxViewportRect(vp, im);
                        const x = Math.max(0, Math.floor(r.left)), y = Math.max(0, Math.floor(r.top));
                        const w = Math.max(1, Math.min(cv.width - x, Math.ceil(r.width))), h = Math.max(1, Math.min(cv.height - y, Math.ceil(r.height)));
                        const tmp = document.createElement('canvas');
                        tmp.width = w; tmp.height = h;
                        tmp.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
                        const blob = await new Promise(res => tmp.toBlob(res, 'image/png'));
                        const png = await pdfDoc.embedPng(await blob.arrayBuffer());
                        pages[im.page - 1].drawImage(png, { x: im.newX, y: im.newY, width: im.width, height: im.height });
                        tmp.width = 0;
                    } catch (e) { movedImgFailed++; console.error('Lỗi vẽ ảnh ở vị trí mới:', e); }
                }
            } finally {
                Object.values(renderCache).forEach(o => { o.cv.width = 0; });
            }
            failedItems += movedImgFailed;
        }
        modifiedTexts.forEach(change => {
            try {
                const pageObj = pages[change.page - 1];
                if (!pageObj) throw new Error('Trang PDF không tồn tại: ' + change.page);
                const targetFont = pickFont(change);
                const rawText = usingStdFont ? removeVietnameseTones(change.text) : change.text;
                const c = hexToRgb(change.color || '#000000');
                pageObj.drawText(safeText(rawText, targetFont), {
                    x: change.x,
                    y: change.y,
                    size: change.fontSize,
                    font: targetFont,
                    color: PDFLib.rgb(c.r, c.g, c.b)
                });
            } catch (e) { failedItems++; console.error('Lỗi vẽ chữ mới:', e); }
        });
        addedTexts.forEach(a => {
            try {
                const pageObj = pages[a.page - 1];
                if (!pageObj) throw new Error('Trang PDF không tồn tại: ' + a.page);
                const f = pickFont(a);
                const c = hexToRgb(a.color || '#000000');
                const raw = usingStdFont ? removeVietnameseTones(a.text) : a.text;
                pageObj.drawText(safeText(raw, f), { x: a.x, y: a.y, size: a.fontSize, font: f, color: PDFLib.rgb(c.r, c.g, c.b) });
            } catch (e) { failedItems++; console.error('Lỗi vẽ chữ thêm mới:', e); }
        });
        if (editorSigs.length && typeof editorDrawSigsOnPdf === 'function') failedItems += await editorDrawSigsOnPdf(pdfDoc, pages);
        editorShapes.forEach(shape => {
            const pageObj = pages[shape.page - 1];
            if (!pageObj) { failedItems++; console.error('Không tìm thấy trang cho hình vẽ:', shape.page); return; }
            const rgb = hexToRgb(shape.color);
            const pdfLibColor = PDFLib.rgb(rgb.r, rgb.g, rgb.b);
            const vp = shape.vp || editorViewport;
            // Nét vẽ phải dùng tỷ lệ viewport tại thời điểm vẽ, không phải mức zoom hiện tại.
            const shapeScale = (vp && Number.isFinite(vp.scale) && vp.scale > 0) ? vp.scale : editorScale;
            const finalThickness = shape.size / shapeScale;
            const [pStartX, pStartY] = vp.convertToPdfPoint(shape.startX, shape.startY);
            const [pEndX, pEndY] = vp.convertToPdfPoint(shape.endX, shape.endY);
            if (shape.type === 'line') {
                pageObj.drawLine({
                    start: {
                        x: pStartX,
                        y: pStartY
                    },
                    end: {
                        x: pEndX,
                        y: pEndY
                    },
                    thickness: finalThickness,
                    color: pdfLibColor
                });
            } else if (shape.type === 'rect') {
                const lowX = Math.min(pStartX, pEndX);
                const lowY = Math.min(pStartY, pEndY);
                const w = Math.abs(pStartX - pEndX);
                const h = Math.abs(pStartY - pEndY);
                pageObj.drawRectangle({
                    x: lowX,
                    y: lowY,
                    width: w,
                    height: h,
                    borderWidth: finalThickness,
                    borderColor: pdfLibColor,
                    borderOpacity: 1
                });
            } else if (shape.type === 'ellipse') {
                const cx = (pStartX + pEndX) / 2;
                const cy = (pStartY + pEndY) / 2;
                const rx = Math.abs(pStartX - pEndX) / 2;
                const ry = Math.abs(pStartY - pEndY) / 2;
                pageObj.drawEllipse({
                    x: cx,
                    y: cy,
                    xScale: rx,
                    yScale: ry,
                    borderWidth: finalThickness,
                    borderColor: pdfLibColor,
                    borderOpacity: 1
                });
            } else if (shape.type === 'arrow') {
                const g = getArrowGeometry(shape.startX, shape.startY, shape.endX, shape.endY, shape.size);
                if (!g) return;
                const toPdf = pt => {
                    const [X, Y] = vp.convertToPdfPoint(pt.x, pt.y);
                    return {
                        x: X,
                        y: Y
                    };
                };
                const pShaftEnd = toPdf(g.shaftEnd), pTip = toPdf(g.tip), pL = toPdf(g.left), pR = toPdf(g.right);
                pageObj.drawLine({
                    start: {
                        x: pStartX,
                        y: pStartY
                    },
                    end: pShaftEnd,
                    thickness: finalThickness,
                    color: pdfLibColor
                });
                pageObj.drawSvgPath(`M ${pTip.x} ${-pTip.y} L ${pL.x} ${-pL.y} L ${pR.x} ${-pR.y} Z`, {
                    x: 0,
                    y: 0,
                    color: pdfLibColor,
                    borderWidth: 0
                });
            } else if (shape.type === 'free') {
                if (shape.points.length < 2) return;
                for (let k = 0; k < shape.points.length - 1; k++) {
                    const [pt1X, pt1Y] = vp.convertToPdfPoint(shape.points[k].x, shape.points[k].y);
                    const [pt2X, pt2Y] = vp.convertToPdfPoint(shape.points[k + 1].x, shape.points[k + 1].y);
                    pageObj.drawLine({
                        start: {
                            x: pt1X,
                            y: pt1Y
                        },
                        end: {
                            x: pt2X,
                            y: pt2Y
                        },
                        thickness: finalThickness,
                        color: pdfLibColor
                    });
                }
            }
        });
        const modifiedPdfBytes = await pdfDoc.save();
        if (captureCb) { captureCb(modifiedPdfBytes); return; }
        const blob = new Blob([ modifiedPdfBytes ], {
            type: 'application/pdf'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const finalFileName = editorFileName ? `${editorFileName}_edit.pdf` : 'tai_lieu_chinh_sua.pdf';
        link.download = finalFileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 60000);
        const notes = [];
        if (unsupportedChars.size) notes.push('Các ký tự font không hỗ trợ đã được thay bằng "?": ' + Array.from(unsupportedChars).join(' '));
        if (failedItems) notes.push(failedItems + ' mục chữ không vẽ được (xem Console F12).');
        if (notes.length) setTimeout(() => alert('Đã xuất PDF, nhưng lưu ý:\n' + notes.join('\n')), 300);
    } catch (error) {
        console.error(error);
        alert('Lỗi xuất file: ' + ((error && error.message) ? error.message : String(error)));
    } finally {
        btn.textContent = '💾 XUẤT FILE ĐÃ SỬA';
        btn.disabled = false;
    }
}

function removeVietnameseTones(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function logAction(action) {
    // Ghi nhận lượt thao tác ẩn danh (chỉ tên thao tác + mã ngẫu nhiên) về /api/track trên Vercel.
    // Tôn trọng Do Not Track và công tắc localStorage 'pdftool-no-log' = '1'.
    try {
        if (localStorage.getItem('pdftool-no-log') === '1' || navigator.doNotTrack === '1') return;
    } catch (e) {}
    try {
        let uid = localStorage.getItem('pdftool-uid');
        if (!uid) {
            uid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Math.random()).slice(2) + Date.now());
            localStorage.setItem('pdftool-uid', uid);
        }
        fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, uid: uid }),
            keepalive: true
        }).catch(() => {});
    } catch (e) {}
}

async function renderEditorPageImage(pageNum) {
    const page = await editorPdfJsDoc.getPage(pageNum);
    const vp = page.getViewport({
        scale: editorScale
    });
    const cv = document.createElement('canvas');
    cv.width = vp.width;
    cv.height = vp.height;
    const ctx = cv.getContext('2d');
    await page.render({
        canvasContext: ctx,
        viewport: vp
    }).promise;
    const _movedImgs = modifiedImages.filter(m => m.page === pageNum).map(m => {
        const r0 = imgBoxViewportRect(vp, m);
        const [nx0, ny0] = vp.convertToViewportPoint(m.newX, m.newY);
        const t = document.createElement('canvas');
        t.width = Math.max(1, Math.ceil(r0.width));
        t.height = Math.max(1, Math.ceil(r0.height));
        t.getContext('2d').drawImage(cv, Math.floor(r0.left), Math.floor(r0.top), t.width, t.height, 0, 0, t.width, t.height);
        return { m, r0, crop: t, nx: nx0, ny: ny0 - r0.height };
    });
    _movedImgs.forEach(o => {
        ctx.fillStyle = o.m.bgColor || '#ffffff';
        ctx.fillRect(o.r0.left - 1, o.r0.top - 1, o.r0.width + 2, o.r0.height + 2);
    });
    _movedImgs.forEach(o => { ctx.drawImage(o.crop, o.nx, o.ny, o.r0.width, o.r0.height); });
    modifiedTexts.filter(t => t.page === pageNum).forEach(t => {
        const [ox, oy] = vp.convertToViewportPoint(t.origX, t.origY);
        const [nx, ny] = vp.convertToViewportPoint(t.x ?? t.origX, t.y ?? t.origY);
        const h = t.fontSize * editorScale;
        const w = (t.origWidth || 0) * editorScale;
        ctx.fillStyle = t.bgColor || '#ffffff';
        const mh = (t.origHeight || t.fontSize) * editorScale;
        const mp = Math.max(3, mh * 0.15);
        ctx.fillRect(ox - mp, oy - mh - 2, w + mp * 2, mh * 1.28 + 6);
        ctx.font = `${t.isItalic ? 'italic ' : ''}${t.isBold ? 'bold ' : ''}${h}px 'RobotoEmb', Arial`;
        ctx.fillStyle = t.color || '#000000';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(t.text, nx, ny);
    });
    addedTexts.filter(a => a.page === pageNum).forEach(a => {
        const [ax, ay] = vp.convertToViewportPoint(a.x, a.y);
        ctx.font = `${a.isItalic ? 'italic ' : ''}${a.isBold ? 'bold ' : ''}${a.fontSize * editorScale}px 'RobotoEmb', Arial`;
        ctx.fillStyle = a.color || '#000000';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(a.text, ax, ay);
    });
    editorShapes.filter(sh => sh.page === pageNum).forEach(sh => {
        ctx.strokeStyle = sh.color;
        ctx.lineWidth = sh.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        drawSingleShape(ctx, sh);
    });
    return cv.toDataURL('image/png');
}

function editorBuildPdfBytes() {
    return new Promise((resolve, reject) => {
        let got = false;
        editorExportPDF(bytes => { got = true; resolve(bytes); }).then(() => {
            if (!got) reject(new Error('Không dựng được file PDF để in.'));
        });
    });
}

function printEditorPages(pageNumbers) {
    if (!editorPdfJsDoc) {
        alert('Chưa mở PDF!');
        return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Trình duyệt đã chặn cửa sổ Popup. Vui lòng cho phép hiện Popup để in!');
        return;
    }
    const title = editorFileName ? `${editorFileName}_edit` : 'PDF_Print';
    (async () => {
        const pdfBytes = await editorBuildPdfBytes();
        const printDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
        const images = [];
        const usePng = pageNumbers.length <= 3;
        for (const n of pageNumbers) {
            const pg = await printDoc.getPage(n);
            const pvp = pg.getViewport({ scale: 2 });
            const pcv = document.createElement('canvas');
            pcv.width = Math.ceil(pvp.width);
            pcv.height = Math.ceil(pvp.height);
            const pctx = pcv.getContext('2d');
            pctx.fillStyle = '#ffffff';
            pctx.fillRect(0, 0, pcv.width, pcv.height);
            await pg.render({ canvasContext: pctx, viewport: pvp }).promise;
            images.push(usePng ? pcv.toDataURL('image/png') : pcv.toDataURL('image/jpeg', 0.95));
            pcv.width = 0;
        }
        printDoc.destroy();
        printWindow.document.open();
        printWindow.document.write('<html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' + '<style>body{margin:0;background:#fff}img{width:100%;display:block;page-break-after:always}' + 'img:last-child{page-break-after:auto}@page{size:auto;margin:0}</style></head><body>' + images.map(src => '<img src="' + src + '">').join('') + '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();window.close();},500)};<\/script>' + '</body></html>');
        printWindow.document.close();
    })().catch(err => {
        printWindow.close();
        alert('Lỗi khi in: ' + err.message);
    });
}

function printEditorStage() {
    printEditorPages([ editorPage ]);
}

window.loadFileIntoMainTab = async function(fileOrBlob, name) {
    try {
        const file = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], name || 'tailieu.pdf', { type: 'application/pdf' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const inp = document.getElementById('file-input');
        if (inp) {
            inp.files = dt.files;
            await loadPDF(inp);
            const mainTabBtn = document.querySelector('.tab-btn[onclick*="tab-main"]');
            if (mainTabBtn && window.switchTab) window.switchTab('tab-main', mainTabBtn);
            if (window.toast) window.toast('Đã nạp file vào tab Xoay & Sắp xếp', 'success');
        }
    } catch (e) {
        alert('Lỗi nạp file vào tab Xoay & Sắp xếp: ' + e.message);
    }
};

// ===================== Word Ribbon & Cross-Tab Editor Support =====================
window.getEditorPdfBytes = function() { return editorPdfDataBytes; };
window.getEditorPdfDoc = function() { return editorPdfJsDoc; };
window.getEditorPage = function() { return editorPage; };
window.setEditorPage = function(p) { editorPage = p; };
window.getEditorFileName = function() { return editorFileName; };
window.setEditorFileName = function(n) { editorFileName = n; };

window.editorLoadBytes = async function(bytes, fileName, preservePage = false) {
    if (!bytes) return;
    const arrayBuffer = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes.slice(0);
    editorPdfDataBytes = arrayBuffer;
    if (fileName) {
        editorFileName = fileName.replace(/\.pdf$/i, '');
    }
    modifiedTexts = [];
    modifiedImages = [];
    editorShapes = [];
    editorSigs = [];
    addedTexts = [];
    const prevPage = editorPage || 1;
    resetHistory();
    updateZoomLabel();
    try {
        editorPdfJsDoc = await pdfjsLib.getDocument({
            data: new Uint8Array(editorPdfDataBytes.slice(0))
        }).promise;
        if (preservePage && prevPage <= editorPdfJsDoc.numPages) {
            editorPage = prevPage;
        } else {
            editorPage = Math.min(prevPage, editorPdfJsDoc.numPages || 1);
        }
        const statusEl = document.getElementById('editor-file-status');
        if (statusEl) {
            statusEl.innerText = '✓ ' + (editorFileName ? editorFileName + '.pdf' : 'Tài liệu PDF');
            statusEl.style.color = 'var(--success)';
        }
        const emptyEl = document.getElementById('editor-empty');
        if (emptyEl) emptyEl.style.display = 'none';
        const shellEl = document.getElementById('editor-page-shell');
        if (shellEl) shellEl.style.display = 'inline-block';
        const dlBtn = document.getElementById('editor-download-btn');
        if (dlBtn) dlBtn.disabled = false;
        initDrawCanvasEvents();
        await editorRenderPage();
        if (typeof window.onEditorDocLoaded === 'function') {
            window.onEditorDocLoaded();
        }
    } catch (e) {
        console.error("Lỗi nạp PDF vào editor:", e);
        if (window.toast) window.toast("Lỗi tải PDF: " + e.message, "error");
        else alert("Lỗi tải PDF: " + e.message);
    }
};

window.loadFileIntoEditorTab = async function(fileOrBlob, name) {
    try {
        const buf = fileOrBlob instanceof Blob ? await fileOrBlob.arrayBuffer() : fileOrBlob;
        await window.editorLoadBytes(buf, name || 'tailieu.pdf');
        const editorTabBtn = document.querySelector('.tab-btn[onclick*="tab-editor"]');
        if (editorTabBtn && window.switchTab) window.switchTab('tab-editor', editorTabBtn);
        if (window.toast) window.toast('Đã mở tài liệu trong Chỉnh Sửa PDF', 'success');
    } catch (e) {
        alert('Lỗi nạp file vào tab Chỉnh sửa: ' + e.message);
    }
};

window.getEditorCurrentPdfBytes = async function() {
    if (!editorPdfDataBytes) return null;
    const hasCanvasEdits = (modifiedTexts && modifiedTexts.length > 0) ||
                           (addedTexts && addedTexts.length > 0) ||
                           (editorShapes && editorShapes.length > 0) ||
                           (editorSigs && editorSigs.length > 0) ||
                           (modifiedImages && modifiedImages.length > 0);
    if (!hasCanvasEdits) {
        return new Uint8Array(editorPdfDataBytes.slice(0));
    }
    return new Promise((resolve) => {
        editorExportPDF(bytes => {
            resolve(bytes);
        });
    });
};


