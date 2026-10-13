// Tính năng "Ký tên": vẽ hoặc tải ảnh chữ ký, đặt lên trang PDF (kéo, đổi cỡ), xuất PDF đã ký.
import '../styles/sign.css';

const $ = (s, r = document) => r.querySelector(s);
const STORE_KEY = 'pdftool-signatures';
const st = { pdf: null, bytes: null, name: '', pages: 0, cur: 1, zoom: 1, ph: [], sigs: [], active: null, sel: null, token: 0, imgData: null };
let uid = 1;

// ---------- Lưu chữ ký trong trình duyệt ----------
function loadSigs() { try { st.sigs = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { st.sigs = []; } if (st.sigs.length) st.active = st.sigs[0].id; }
function saveSigs() { try { localStorage.setItem(STORE_KEY, JSON.stringify(st.sigs)); } catch (e) { window.toast?.('Không lưu được chữ ký vào bộ nhớ trình duyệt', 'error'); } }

// ---------- Xử lý ảnh chữ ký ----------
function trimToDataUrl(src) {            // cắt sát nét vẽ, trả về {url, w, h}
  const w = src.width, h = src.height, d = src.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 4, cw = x1 - x0 + 1 + pad * 2, ch = y1 - y0 + 1 + pad * 2;
  const out = document.createElement('canvas'); out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(src, x0 - pad, y0 - pad, cw, ch, 0, 0, cw, ch);
  return { url: out.toDataURL('image/png'), w: cw, h: ch };
}
function imageToCanvas(img, removeWhite, thr) {
  const max = 900, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
  if (removeWhite) {
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum > thr) d[i + 3] = 0; else if (lum > thr - 40) d[i + 3] = Math.round(d[i + 3] * (thr - lum) / 40);
    }
    g.putImageData(im, 0, 0);
  }
  return c;
}

// ---------- Giao diện ----------
const HTML = `
<div class="sg-wrap">
  <div class="sg-left">
    <div class="card"><p class="card-title">1. Chọn file PDF</p>
      <input type="file" id="sg-pdf" accept="application/pdf" hidden>
      <button class="sg-btn sg-primary" id="sg-open">📂 Mở PDF cần ký</button>
      <div class="sg-hint" id="sg-fileinfo">Chưa có file</div>
    </div>
    <div class="card"><p class="card-title">2. Tạo chữ ký</p>
      <div class="sg-modes"><button class="sg-mode on" data-m="draw">✍️ Vẽ</button><button class="sg-mode" data-m="img">🖼️ Ảnh</button></div>
      <div id="sg-draw">
        <canvas id="sg-canvas" width="520" height="190"></canvas>
        <div class="sg-row"><label>Màu <select id="sg-color"><option value="#111111">Đen</option><option value="#1d4ed8">Xanh dương</option><option value="#b91c1c">Đỏ</option></select></label>
        <label>Nét <input type="range" id="sg-width" min="1" max="8" value="3"></label>
        <button class="sg-btn" id="sg-clear">Xóa</button></div>
      </div>
      <div id="sg-img" hidden>
        <input type="file" id="sg-imgfile" accept="image/*" hidden>
        <button class="sg-btn" id="sg-pickimg">Chọn ảnh chữ ký</button>
        <div class="sg-row"><label><input type="checkbox" id="sg-rmbg" checked> Xóa nền trắng</label>
        <label>Ngưỡng <input type="range" id="sg-thr" min="120" max="250" value="200"></label></div>
        <canvas id="sg-imgprev" width="520" height="190"></canvas>
      </div>
      <button class="sg-btn sg-primary" id="sg-save">💾 Lưu chữ ký này</button>
    </div>
    <div class="card"><p class="card-title">3. Chữ ký đã lưu</p>
      <div id="sg-list" class="sg-list"></div>
      <div class="sg-hint">Bấm vào chữ ký để chọn, rồi bấm "Thêm vào trang".</div>
    </div>
  </div>
  <div class="sg-right">
    <div class="sg-bar">
      <button class="sg-btn" id="sg-prev">◀</button><span id="sg-pageinfo">0 / 0</span><button class="sg-btn" id="sg-next">▶</button>
      <button class="sg-btn" id="sg-zout">－</button><span id="sg-zinfo">100%</span><button class="sg-btn" id="sg-zin">＋</button>
      <button class="sg-btn sg-primary" id="sg-add">➕ Thêm vào trang</button>
      <button class="sg-btn" id="sg-all">📑 Nhân bản sang mọi trang</button>
      <button class="sg-btn sg-ok" id="sg-export">⬇️ Xuất PDF đã ký</button>
      <button class="sg-btn" id="sg-to-tools" style="background:#f59e0b; color:#fff;" title="Chuyển file đã ký sang Công cụ PDF để canh lề, đánh số trang, nén hoặc chèn watermark">⚡ Chuyển sang Công cụ PDF</button>
    </div>
    <div class="sg-stage" id="sg-stage"><div class="sg-empty">Mở một file PDF để bắt đầu ký</div></div>
  </div>
</div>`;

function mount() {
  const aboutTab = document.getElementById('tab-about');
  if (!aboutTab) return false;
  const sec = Object.assign(document.createElement('div'), { id: 'tab-sign', className: 'tab-content', innerHTML: HTML });
  aboutTab.parentNode.insertBefore(sec, aboutTab);
  return true;
}

// ---------- Vẽ chữ ký ----------
function setupDraw() {
  const cv = $('#sg-canvas'), g = cv.getContext('2d'); let drawing = false, last = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  cv.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); g.fillStyle = $('#sg-color').value; g.beginPath(); g.arc(last.x, last.y, $('#sg-width').value / 2, 0, 7); g.fill(); });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return; const p = pos(e);
    g.strokeStyle = $('#sg-color').value; g.lineWidth = +$('#sg-width').value; g.lineCap = g.lineJoin = 'round';
    g.beginPath(); g.moveTo(last.x, last.y); g.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2); g.lineTo(p.x, p.y); g.stroke(); last = p;
  });
  const end = () => { drawing = false; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  $('#sg-clear').onclick = () => g.clearRect(0, 0, cv.width, cv.height);
}
function refreshImgPreview() {
  if (!st.imgData) return; const pv = $('#sg-imgprev'), g = pv.getContext('2d');
  const c = imageToCanvas(st.imgData, $('#sg-rmbg').checked, +$('#sg-thr').value);
  g.clearRect(0, 0, pv.width, pv.height); const k = Math.min(pv.width / c.width, pv.height / c.height);
  g.drawImage(c, (pv.width - c.width * k) / 2, (pv.height - c.height * k) / 2, c.width * k, c.height * k);
  st.imgCanvas = c;
}
function setupSigMaker() {
  document.querySelectorAll('.sg-mode').forEach(b => b.onclick = () => {
    document.querySelectorAll('.sg-mode').forEach(x => x.classList.toggle('on', x === b));
    $('#sg-draw').hidden = b.dataset.m !== 'draw'; $('#sg-img').hidden = b.dataset.m !== 'img'; st.mode = b.dataset.m;
  });
  st.mode = 'draw'; setupDraw();
  $('#sg-pickimg').onclick = () => $('#sg-imgfile').click();
  $('#sg-imgfile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return; const img = new Image();
    img.onload = () => { st.imgData = img; refreshImgPreview(); }; img.src = URL.createObjectURL(f);
  };
  $('#sg-rmbg').onchange = $('#sg-thr').oninput = refreshImgPreview;
  $('#sg-save').onclick = () => {
    const src = st.mode === 'draw' ? $('#sg-canvas') : st.imgCanvas;
    if (!src) return window.toast?.('Hãy vẽ hoặc chọn ảnh chữ ký trước', 'error');
    const t = trimToDataUrl(src); if (!t) return window.toast?.('Chữ ký đang trống', 'error');
    const s = { id: 's' + Date.now(), url: t.url, ar: t.w / t.h }; st.sigs.unshift(s); st.active = s.id; saveSigs(); renderList();
    window.toast?.('Đã lưu chữ ký', 'success');
  };
}
function renderList() {
  const box = $('#sg-list'); box.innerHTML = '';
  if (!st.sigs.length) { box.innerHTML = '<div class="sg-hint">Chưa có chữ ký nào</div>'; return; }
  st.sigs.forEach(s => {
    const d = Object.assign(document.createElement('div'), { className: 'sg-thumb' + (s.id === st.active ? ' on' : '') });
    d.innerHTML = `<img src="${s.url}" alt="chữ ký"><button title="Xóa chữ ký">✕</button>`;
    d.onclick = () => { st.active = s.id; renderList(); };
    d.querySelector('button').onclick = (e) => { e.stopPropagation(); st.sigs = st.sigs.filter(x => x.id !== s.id); if (st.active === s.id) st.active = st.sigs[0]?.id || null; saveSigs(); renderList(); };
    box.appendChild(d);
  });
}

// ---------- Hiển thị trang & lớp chữ ký ----------
async function openPdf(file) {
  try {
    window.Progress?.show('Đang mở PDF...');
    const bytes = new Uint8Array(await file.arrayBuffer());
    st.pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    st.bytes = bytes; st.name = file.name.replace(/\.pdf$/i, ''); st.pages = st.pdf.numPages; st.cur = 1; st.ph = []; st.sel = null;
    $('#sg-fileinfo').textContent = `${file.name} · ${st.pages} trang`;
    await renderPage();
  } catch (e) { window.toast?.('Không mở được PDF: ' + (e.message || e), 'error'); }
  finally { window.Progress?.hide(); }
}
async function renderPage() {
  if (!st.pdf) return; const tk = ++st.token;
  const page = await st.pdf.getPage(st.cur), stage = $('#sg-stage');
  const base = page.getViewport({ scale: 1 }), fit = Math.min(1.6, Math.max(0.4, (stage.clientWidth - 40) / base.width));
  const scale = fit * st.zoom, vp = page.getViewport({ scale }), dpr = window.devicePixelRatio || 1;
  const holder = document.createElement('div'); holder.className = 'sg-page'; holder.style.width = vp.width + 'px'; holder.style.height = vp.height + 'px';
  const cv = document.createElement('canvas'); cv.width = vp.width * dpr; cv.height = vp.height * dpr; cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
  holder.appendChild(cv); holder.addEventListener('pointerdown', (e) => { if (e.target === holder || e.target === cv) { st.sel = null; drawItems(holder); } });
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
  if (tk !== st.token) return;
  stage.innerHTML = ''; stage.appendChild(holder); st.holder = holder; drawItems(holder);
  $('#sg-pageinfo').textContent = `${st.cur} / ${st.pages}`; $('#sg-zinfo').textContent = Math.round(st.zoom * 100) + '%';
}
function drawItems(holder) {
  holder.querySelectorAll('.sg-item').forEach(n => n.remove());
  const W = holder.clientWidth, H = holder.clientHeight;
  st.ph.filter(p => p.page === st.cur).forEach(p => {
    const sig = st.sigs.find(s => s.id === p.sigId) || p.snap; if (!sig) return;
    const w = p.fw * W, h = w / sig.ar, el = document.createElement('div');
    el.className = 'sg-item' + (st.sel === p.id ? ' sel' : ''); el.style.cssText = `left:${p.fx * W}px;top:${p.fy * H}px;width:${w}px;height:${h}px`;
    el.innerHTML = `<img src="${sig.url}" draggable="false"><span class="sg-del" title="Xóa">✕</span><span class="sg-rs"></span>`;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('sg-del')) { st.ph = st.ph.filter(x => x.id !== p.id); st.sel = null; return drawItems(holder); }
      e.stopPropagation(); st.sel = p.id; const resize = e.target.classList.contains('sg-rs');
      const sx = e.clientX, sy = e.clientY, ox = p.fx, oy = p.fy, ow = p.fw; el.setPointerCapture(e.pointerId);
      holder.querySelectorAll('.sg-item').forEach(n => n.classList.toggle('sel', n === el));
      const mv = (ev) => {
        const dx = (ev.clientX - sx) / W, dy = (ev.clientY - sy) / H;
        if (resize) p.fw = Math.max(0.04, Math.min(1 - p.fx, ow + dx)); else { p.fx = Math.max(0, Math.min(1 - p.fw, ox + dx)); p.fy = Math.max(0, Math.min(1, oy + dy)); }
        const ww = p.fw * W; el.style.left = p.fx * W + 'px'; el.style.top = p.fy * H + 'px'; el.style.width = ww + 'px'; el.style.height = ww / sig.ar + 'px';
      };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    holder.appendChild(el);
  });
}
function addToPage() {
  if (!st.pdf) return window.toast?.('Hãy mở file PDF trước', 'error');
  const sig = st.sigs.find(s => s.id === st.active); if (!sig) return window.toast?.('Hãy tạo hoặc chọn một chữ ký', 'error');
  const p = { id: uid++, page: st.cur, sigId: sig.id, snap: sig, fw: 0.25, fx: 0.55, fy: 0.8 };
  st.ph.push(p); st.sel = p.id; drawItems(st.holder);
}
function duplicateAll() {
  const p = st.ph.find(x => x.id === st.sel); if (!p) return window.toast?.('Bấm chọn một chữ ký trên trang trước', 'info');
  for (let i = 1; i <= st.pages; i++) if (i !== p.page && !st.ph.some(x => x.page === i && x.sigId === p.sigId)) st.ph.push({ ...p, id: uid++, page: i });
  window.toast?.(`Đã nhân bản sang ${st.pages} trang`, 'success'); drawItems(st.holder);
}

// ---------- Xuất PDF ----------
export async function exportSigned() {
  if (!st.pdf) return window.toast?.('Chưa có file PDF', 'error');
  if (!st.ph.length) return window.toast?.('Chưa đặt chữ ký nào lên trang', 'error');
  const { PDFDocument, degrees } = window.PDFLib;
  try {
    window.Progress?.show('Đang tạo PDF đã ký...', 5);
    const doc = await PDFDocument.load(st.bytes, { ignoreEncryption: true }), emb = {};
    let n = 0;
    for (const p of st.ph) {
      const sig = p.snap || st.sigs.find(s => s.id === p.sigId); if (!sig) continue;
      if (!emb[sig.id]) emb[sig.id] = await doc.embedPng(sig.url);
      const jp = await st.pdf.getPage(p.page), vp = jp.getViewport({ scale: 1 }), pg = doc.getPage(p.page - 1);
      const w = p.fw * vp.width, h = w / sig.ar;
      const [x, y] = vp.convertToPdfPoint(p.fx * vp.width, p.fy * vp.height + h);   // góc dưới-trái nhìn thấy được
      pg.drawImage(emb[sig.id], { x, y, width: w, height: h, rotate: degrees(vp.rotation) });
      window.Progress?.show('Đang tạo PDF đã ký...', 5 + 90 * (++n) / st.ph.length);
    }
    const out = await doc.save(), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'application/pdf' })); a.download = st.name + '-signed.pdf'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    window.toast?.('Đã xuất ' + a.download, 'success'); try { window.logAction?.('sign_pdf'); } catch (e) {}
  } catch (e) { window.toast?.('Lỗi xuất PDF: ' + (e.message || e), 'error'); }
  finally { window.Progress?.hide(); }
}

export async function exportAndSendToTools() {
  if (!st.pdf) return window.toast?.('Chưa có file PDF', 'error');
  if (!st.ph.length) return window.toast?.('Chưa đặt chữ ký nào lên trang', 'error');
  const { PDFDocument, degrees } = window.PDFLib;
  try {
    window.Progress?.show('Đang tạo PDF đã ký...', 5);
    const doc = await PDFDocument.load(st.bytes, { ignoreEncryption: true }), emb = {};
    let n = 0;
    for (const p of st.ph) {
      const sig = p.snap || st.sigs.find(s => s.id === p.sigId); if (!sig) continue;
      if (!emb[sig.id]) emb[sig.id] = await doc.embedPng(sig.url);
      const jp = await st.pdf.getPage(p.page), vp = jp.getViewport({ scale: 1 }), pg = doc.getPage(p.page - 1);
      const w = p.fw * vp.width, h = w / sig.ar;
      const [x, y] = vp.convertToPdfPoint(p.fx * vp.width, p.fy * vp.height + h);
      pg.drawImage(emb[sig.id], { x, y, width: w, height: h, rotate: degrees(vp.rotation) });
      window.Progress?.show('Đang tạo PDF đã ký...', 5 + 90 * (++n) / st.ph.length);
    }
    const out = await doc.save();
    const fileName = (st.name || 'tailieu') + '-signed.pdf';
    const blob = new Blob([out], { type: 'application/pdf' });
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (window.loadFileIntoToolsTab) {
      window.loadFileIntoToolsTab(file, fileName, 'margin');
      window.toast?.('Đã chuyển PDF đã ký sang Công cụ PDF! Bạn có thể canh lề, đánh số, nén...', 'success');
    } else {
      window.toast?.('Không tìm thấy tab Công cụ PDF', 'error');
    }
  } catch (e) { window.toast?.('Lỗi tạo PDF: ' + (e.message || e), 'error'); }
  finally { window.Progress?.hide(); }
}

export function initSign() {
  if (!mount()) return;
  loadSigs(); setupSigMaker(); renderList();
  $('#sg-open').onclick = () => $('#sg-pdf').click();
  $('#sg-pdf').onchange = (e) => { if (e.target.files[0]) openPdf(e.target.files[0]); e.target.value = ''; };
  $('#sg-prev').onclick = () => { if (st.cur > 1) { st.cur--; renderPage(); } };
  $('#sg-next').onclick = () => { if (st.cur < st.pages) { st.cur++; renderPage(); } };
  $('#sg-zin').onclick = () => { st.zoom = Math.min(3, st.zoom + 0.2); renderPage(); };
  $('#sg-zout').onclick = () => { st.zoom = Math.max(0.4, st.zoom - 0.2); renderPage(); };
  $('#sg-add').onclick = addToPage; $('#sg-all').onclick = duplicateAll; $('#sg-export').onclick = exportSigned;
  const toToolsBtn = $('#sg-to-tools');
  if (toToolsBtn) toToolsBtn.onclick = exportAndSendToTools;
  addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel && document.getElementById('tab-sign').classList.contains('active') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      st.ph = st.ph.filter(x => x.id !== st.sel); st.sel = null; drawItems(st.holder);
    }
  });
  // cho phép kéo thả PDF vào tab này (main.js xử lý chung qua input này)
  window.__signInput = $('#sg-pdf');
  window.openPdfInSign = openPdf;
  window.loadFileIntoSignTab = async function(fileOrBlob, name) {
    const file = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], name || 'tailieu.pdf', { type: 'application/pdf' });
    await openPdf(file);
    const signBtn = [...document.querySelectorAll('.tab-btn')].find(b => b.getAttribute('onclick')?.includes('tab-sign'));
    if (signBtn && window.switchTab) window.switchTab('tab-sign', signBtn);
    window.toast?.('Đã nạp file vào tab Ký tên', 'success');
  };
}
