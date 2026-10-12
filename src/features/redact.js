// Tính năng "Che thông tin": vẽ vùng che thủ công hoặc tự tìm (email, SĐT, CCCD, MST, từ khóa/regex).
// Các trang có vùng che được chuyển thành ảnh → dữ liệu bên dưới bị xóa thật, không chỉ bị đè khối đen.
import '../styles/redact.css';
import { $, addTab, toast, log, download } from './ui.js';

const st = { pdf: null, bytes: null, name: '', pages: 0, cur: 1, zoom: 1, rects: [], sel: null, token: 0 };
let uid = 1;

const PRESETS = {
  email: { label: 'Email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  phone: { label: 'Số điện thoại VN', re: /(?:\+?84|0)(?:[\s.-]?\d){9}/g },
  cccd: { label: 'CCCD / CMND (12 hoặc 9 số)', re: /\b(?:\d{12}|\d{9})\b/g },
  mst: { label: 'Mã số thuế (10 hoặc 13 số)', re: /\b\d{10}(?:-\d{3})?\b/g },
};

const HTML = `
<div class="rd-wrap">
  <div class="rd-left">
    <div class="card"><p class="card-title">1. Chọn file PDF</p>
      <input type="file" id="rd-pdf" accept="application/pdf" hidden>
      <button class="rd-btn rd-primary" id="rd-open">📂 Mở PDF</button><div class="rd-hint" id="rd-info">Chưa có file</div></div>
    <div class="card"><p class="card-title">2. Tự tìm thông tin nhạy cảm</p>
      <div id="rd-presets"></div>
      <input type="text" id="rd-custom" class="rd-input" placeholder="Từ khóa hoặc /regex/ (cách nhau bằng dấu ;)">
      <button class="rd-btn rd-primary" id="rd-find">🔍 Tìm &amp; đánh dấu mọi trang</button>
      <div class="rd-hint" id="rd-found"></div></div>
    <div class="card"><p class="card-title">3. Che thủ công</p>
      <div class="rd-hint">Kéo chuột trên trang để vẽ vùng che. Bấm vào vùng rồi bấm ✕ hoặc phím Delete để bỏ.</div>
      <button class="rd-btn" id="rd-clearpage">Bỏ hết vùng trang này</button> <button class="rd-btn" id="rd-clearall">Bỏ tất cả</button></div>
    <div class="card"><p class="card-title">4. Lịch sử vùng che <span id="rd-hcount" class="rd-badge"></span></p>
      <div id="rd-history" class="rd-history"><div class="rd-hint">Chưa có vùng che nào. Bấm vào một mục để nhảy tới vị trí đó.</div></div></div>
    <div class="card"><label class="rd-chk"><input type="checkbox" id="rd-meta" checked> Xóa metadata (tác giả, tiêu đề, phần mềm tạo...)</label>
      <div class="rd-warn">⚠️ Trang có vùng che sẽ thành ảnh: không còn chọn / tìm kiếm chữ được trên trang đó. Đây là cách chắc chắn xóa dữ liệu thật.</div>
      <button class="rd-btn rd-ok" id="rd-export">⬇️ Áp dụng &amp; xuất PDF</button><div class="rd-hint" id="rd-count"></div></div>
  </div>
  <div class="rd-right">
    <div class="rd-bar"><button class="rd-btn" id="rd-prev">◀</button><span id="rd-pageinfo">0 / 0</span><button class="rd-btn" id="rd-next">▶</button>
      <button class="rd-btn" id="rd-zout">－</button><span id="rd-zinfo">100%</span><button class="rd-btn" id="rd-zin">＋</button></div>
    <div class="rd-stage" id="rd-stage"><div class="rd-empty">Mở một file PDF để bắt đầu</div></div>
  </div>
</div>`;

async function openPdf(file) {
  try {
    window.Progress?.show('Đang mở PDF...');
    st.bytes = new Uint8Array(await file.arrayBuffer());
    st.pdf = await window.pdfjsLib.getDocument({ data: st.bytes.slice(0) }).promise;
    st.name = file.name.replace(/\.pdf$/i, ''); st.pages = st.pdf.numPages; st.cur = 1; st.rects = []; st.sel = null;
    $('#rd-info').textContent = `${file.name} · ${st.pages} trang`; $('#rd-found').textContent = '';
    await renderPage(); updateCount();
  } catch (e) { toast('Không mở được PDF: ' + (e.message || e), 'error'); } finally { window.Progress?.hide(); }
}
function updateCount() {
  const pages = new Set(st.rects.map((r) => r.page)).size;
  $('#rd-count').textContent = st.rects.length ? `${st.rects.length} vùng che trên ${pages} trang` : 'Chưa có vùng che nào';
  renderHistory();
}

// ---------- Lịch sử vùng che (bấm để nhảy tới vị trí) ----------
const mask = (t) => (t ? t.slice(0, 2) + '•••' : '');
function renderHistory() {
  const box = $('#rd-history'); if (!box) return;
  $('#rd-hcount').textContent = st.rects.length ? st.rects.length : '';
  if (!st.rects.length) { box.innerHTML = '<div class="rd-hint">Chưa có vùng che nào. Bấm vào một mục để nhảy tới vị trí đó.</div>'; return; }
  box.innerHTML = '';
  st.rects.forEach((r, i) => {
    const it = document.createElement('div'); it.className = 'rd-hitem' + (st.sel === r.id ? ' on' : ''); it.dataset.id = r.id;
    it.innerHTML = '<span class="rd-hnum"></span><span class="rd-hmain"></span><button title="Xóa vùng này">✕</button>';
    it.querySelector('.rd-hnum').textContent = '#' + (i + 1);
    it.querySelector('.rd-hmain').textContent = `Trang ${r.page} · ${r.label || 'Thủ công'}` + (r.snip ? ` · ${mask(r.snip)}` : '');
    it.onclick = () => gotoRect(r.id);
    it.querySelector('button').onclick = (e) => { e.stopPropagation(); st.rects = st.rects.filter((x) => x.id !== r.id); if (st.sel === r.id) st.sel = null; updateCount(); drawRects(); };
    box.appendChild(it);
  });
}
async function gotoRect(id) {
  const r = st.rects.find((x) => x.id === id); if (!r) return;
  st.sel = id;
  if (r.page !== st.cur) { st.cur = r.page; await renderPage(); } else drawRects();
  renderHistory();
  const el = st.holder?.querySelector(`.rd-rect[data-id="${id}"]`); if (!el) return;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  el.classList.remove('rd-flash'); void el.offsetWidth; el.classList.add('rd-flash');
}

async function renderPage() {
  if (!st.pdf) return; const tk = ++st.token;
  const page = await st.pdf.getPage(st.cur), stage = $('#rd-stage');
  const base = page.getViewport({ scale: 1 }), scale = Math.min(1.6, Math.max(0.4, (stage.clientWidth - 32) / base.width)) * st.zoom, vp = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1, holder = document.createElement('div'); holder.className = 'rd-page';
  holder.style.width = vp.width + 'px'; holder.style.height = vp.height + 'px';
  const cv = document.createElement('canvas'); cv.width = vp.width * dpr; cv.height = vp.height * dpr; cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
  holder.appendChild(cv);
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
  if (tk !== st.token) return;
  stage.innerHTML = ''; stage.appendChild(holder); st.holder = holder; attachDraw(holder); drawRects();
  $('#rd-pageinfo').textContent = `${st.cur} / ${st.pages}`; $('#rd-zinfo').textContent = Math.round(st.zoom * 100) + '%';
}

function drawRects() {
  const h = st.holder; if (!h) return; h.querySelectorAll('.rd-rect').forEach((n) => n.remove());
  const W = h.clientWidth, H = h.clientHeight;
  st.rects.filter((r) => r.page === st.cur).forEach((r) => {
    const el = document.createElement('div'); el.className = 'rd-rect' + (st.sel === r.id ? ' sel' : ''); el.dataset.id = r.id;
    el.style.cssText = `left:${r.x * W}px;top:${r.y * H}px;width:${r.w * W}px;height:${r.h * H}px`; el.innerHTML = '<span class="rd-x">✕</span>';
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target.classList.contains('rd-x')) { st.rects = st.rects.filter((x) => x.id !== r.id); st.sel = null; updateCount(); } else st.sel = r.id; drawRects(); renderHistory(); document.querySelector(`#rd-history .rd-hitem[data-id="${r.id}"]`)?.scrollIntoView({ block: 'nearest' }); });
    h.appendChild(el);
  });
}
function attachDraw(holder) {
  let start = null, prev = null;
  holder.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.rd-rect')) return; const b = holder.getBoundingClientRect(); start = { x: e.clientX - b.left, y: e.clientY - b.top };
    prev = Object.assign(document.createElement('div'), { className: 'rd-rect rd-prev' }); holder.appendChild(prev); holder.setPointerCapture(e.pointerId); st.sel = null;
  });
  holder.addEventListener('pointermove', (e) => {
    if (!start) return; const b = holder.getBoundingClientRect(), x = Math.max(0, Math.min(b.width, e.clientX - b.left)), y = Math.max(0, Math.min(b.height, e.clientY - b.top));
    prev.style.cssText = `left:${Math.min(start.x, x)}px;top:${Math.min(start.y, y)}px;width:${Math.abs(x - start.x)}px;height:${Math.abs(y - start.y)}px`;
  });
  const end = (e) => {
    if (!start) return; const b = holder.getBoundingClientRect(), x = Math.max(0, Math.min(b.width, e.clientX - b.left)), y = Math.max(0, Math.min(b.height, e.clientY - b.top));
    const w = Math.abs(x - start.x), h = Math.abs(y - start.y); prev.remove(); const s = start; start = prev = null;
    if (w > 4 && h > 4) { st.rects.push({ id: uid++, page: st.cur, label: 'Thủ công', x: Math.min(s.x, x) / b.width, y: Math.min(s.y, y) / b.height, w: w / b.width, h: h / b.height }); updateCount(); }
    drawRects();
  };
  holder.addEventListener('pointerup', end); holder.addEventListener('pointercancel', end);
}

// ---------- Tự tìm ----------
function buildMatchers() {
  const list = [];
  document.querySelectorAll('#rd-presets input:checked').forEach((c) => { const r = new RegExp(PRESETS[c.value].re.source, 'g'); r._label = PRESETS[c.value].label.split(' (')[0]; list.push(r); });
  ($('#rd-custom').value || '').split(';').map((s) => s.trim()).filter(Boolean).forEach((t) => {
    const m = t.match(/^\/(.+)\/([gimsu]*)$/);
    try { const r = m ? new RegExp(m[1], [...new Set((m[2] || '') + 'g')].join('')) : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); r._label = 'Từ khóa'; list.push(r); }
    catch (e) { toast('Regex không hợp lệ: ' + t, 'error'); }
  });
  return list;
}
async function findAll() {
  if (!st.pdf) return toast('Hãy mở file PDF trước', 'error');
  const res = buildMatchers(); if (!res.length) return toast('Chọn loại thông tin hoặc nhập từ khóa', 'info');
  let added = 0;
  try {
    for (let n = 1; n <= st.pages; n++) {
      window.Progress?.show('Đang tìm thông tin...', (n - 1) / st.pages * 100);
      const page = await st.pdf.getPage(n), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
      let text = ''; const map = [];                       // map[i] = {item, offset} cho ký tự thứ i
      let prev = null;
      for (const it of tc.items) {
        if (!it.str) continue;
        // Chèn xuống dòng giữa hai dòng chữ khác nhau để kết quả không dính sang dòng kế (vd: "...hachihi.vn" + "Phone")
        if (prev && (prev.hasEOL || Math.abs(prev.transform[5] - it.transform[5]) > 2)) { text += '\n'; map.push(null); }
        for (let k = 0; k < it.str.length; k++) map.push({ it, k }); text += it.str; prev = it;
      }
      for (const re of res) {
        re.lastIndex = 0; let m;
        while ((m = re.exec(text))) {
          if (!m[0]) { re.lastIndex++; continue; }
          const byItem = new Map();
          for (let i = m.index; i < m.index + m[0].length; i++) { if (!map[i]) continue; const { it, k } = map[i]; const o = byItem.get(it) || { a: k, b: k }; o.b = k; byItem.set(it, o); }
          for (const [it, o] of byItem) {
            const len = it.str.length, [, , , d, e, f] = it.transform, hgt = Math.abs(it.height || d) || 10;
            const x0 = e + it.width * o.a / len, x1 = e + it.width * (o.b + 1) / len;
            const p1 = vp.convertToViewportPoint(x0, f - hgt * 0.22), p2 = vp.convertToViewportPoint(x1, f + hgt * 0.95);
            const px = Math.min(p1[0], p2[0]), py = Math.min(p1[1], p2[1]), pw = Math.abs(p2[0] - p1[0]), ph = Math.abs(p2[1] - p1[1]);
            st.rects.push({ id: uid++, page: n, label: re._label, snip: m[0], x: Math.max(0, px - 1.5) / vp.width, y: Math.max(0, py - 1.5) / vp.height, w: (pw + 3) / vp.width, h: (ph + 3) / vp.height }); added++;
          }
        }
      }
    }
    $('#rd-found').textContent = added ? `Đã đánh dấu ${added} vùng — hãy xem lại từng trang trước khi xuất` : 'Không tìm thấy nội dung khớp (PDF dạng ảnh scan cần OCR trước)';
    updateCount(); drawRects(); if (added) toast(`Đã đánh dấu ${added} vùng`, 'success');
  } catch (e) { toast('Lỗi khi tìm: ' + (e.message || e), 'error'); } finally { window.Progress?.hide(); }
}

// ---------- Xuất ----------
async function exportPdf() {
  if (!st.rects.length) return toast('Chưa có vùng che nào', 'error');
  const { PDFDocument } = window.PDFLib, pages = [...new Set(st.rects.map((r) => r.page))].sort((a, b) => a - b);
  try {
    const doc = await PDFDocument.load(st.bytes, { ignoreEncryption: true }); let done = 0;
    for (const n of pages) {
      window.Progress?.show(`Đang che trang ${n}...`, done / pages.length * 100);
      const page = await st.pdf.getPage(n), vp1 = page.getViewport({ scale: 1 }), S = 2.5, vp = page.getViewport({ scale: S });
      const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      g.fillStyle = '#000'; st.rects.filter((r) => r.page === n).forEach((r) => g.fillRect(r.x * cv.width, r.y * cv.height, r.w * cv.width, r.h * cv.height));
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92)); const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const np = doc.insertPage(n - 1, [vp1.width, vp1.height]); np.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      doc.removePage(n);                                    // bỏ trang gốc (đã dời xuống vị trí n)
      done++;
    }
    if ($('#rd-meta').checked) { doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator(''); }
    download(await doc.save(), st.name + '-redacted.pdf'); log('redact_pdf'); toast(`Đã che ${st.rects.length} vùng trên ${pages.length} trang`, 'success');
  } catch (e) { toast('Lỗi xuất PDF: ' + (e.message || e), 'error'); } finally { window.Progress?.hide(); }
}

export function initRedact() {
  if (!addTab('tab-redact', '⬛ Che thông tin', HTML)) return;
  $('#rd-presets').innerHTML = Object.entries(PRESETS).map(([k, v]) => `<label class="rd-chk"><input type="checkbox" value="${k}"> ${v.label}</label>`).join('');
  $('#rd-open').onclick = () => $('#rd-pdf').click();
  $('#rd-pdf').onchange = (e) => { if (e.target.files[0]) openPdf(e.target.files[0]); e.target.value = ''; };
  $('#rd-find').onclick = findAll; $('#rd-export').onclick = exportPdf;
  $('#rd-clearpage').onclick = () => { st.rects = st.rects.filter((r) => r.page !== st.cur); updateCount(); drawRects(); };
  $('#rd-clearall').onclick = () => { st.rects = []; updateCount(); drawRects(); };
  $('#rd-prev').onclick = () => { if (st.cur > 1) { st.cur--; renderPage(); } };
  $('#rd-next').onclick = () => { if (st.cur < st.pages) { st.cur++; renderPage(); } };
  $('#rd-zin').onclick = () => { st.zoom = Math.min(3, st.zoom + 0.2); renderPage(); };
  $('#rd-zout').onclick = () => { st.zoom = Math.max(0.4, st.zoom - 0.2); renderPage(); };
  addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel && $('#tab-redact').classList.contains('active') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      st.rects = st.rects.filter((r) => r.id !== st.sel); st.sel = null; updateCount(); drawRects();
    }
  });
}
