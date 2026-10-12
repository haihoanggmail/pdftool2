// Tính năng "Điền form PDF": đọc các trường AcroForm, nhập giá trị, xem trước, xuất (có thể làm phẳng).
import '../styles/form.css';
import { $, addTab, toast, log, download, embeddedFontBytes } from './ui.js';

const st = { bytes: null, name: '', fields: [], values: {}, pages: 0, cur: 1, pdf: null, timer: 0, token: 0 };

const HTML = `
<div class="fm-wrap">
  <div class="fm-left">
    <div class="card"><p class="card-title">1. Chọn PDF có form</p>
      <input type="file" id="fm-pdf" accept="application/pdf" hidden>
      <button class="fm-btn fm-primary" id="fm-open">📂 Mở PDF</button>
      <div class="fm-hint" id="fm-info">Chưa có file</div></div>
    <div class="card"><p class="card-title">2. Nhập thông tin</p>
      <input type="search" id="fm-search" placeholder="Tìm trường..." class="fm-search">
      <div id="fm-fields" class="fm-fields"><div class="fm-hint">Các trường form sẽ hiện ở đây</div></div></div>
    <div class="card"><label class="fm-chk"><input type="checkbox" id="fm-flat"> Làm phẳng (khóa nội dung, không sửa lại được)</label>
      <button class="fm-btn fm-ok" id="fm-export">⬇️ Xuất PDF đã điền</button></div>
  </div>
  <div class="fm-right">
    <div class="fm-bar"><button class="fm-btn" id="fm-prev">◀</button><span id="fm-pageinfo">0 / 0</span><button class="fm-btn" id="fm-next">▶</button>
      <button class="fm-btn" id="fm-refresh">🔄 Cập nhật xem trước</button></div>
    <div class="fm-stage" id="fm-stage"><div class="fm-empty">Mở PDF có form để bắt đầu</div></div>
  </div>
</div>`;

// Bản pdf-lib đã nén làm đổi tên class → dùng instanceof thay vì constructor.name
function typeName(f) {
  const L = window.PDFLib;
  for (const t of ['PDFTextField', 'PDFCheckBox', 'PDFRadioGroup', 'PDFDropdown', 'PDFOptionList']) if (f instanceof L[t]) return t;
  return '';
}

async function openPdf(file) {
  const { PDFDocument } = window.PDFLib;
  try {
    window.Progress?.show('Đang đọc form...');
    st.bytes = new Uint8Array(await file.arrayBuffer()); st.name = file.name.replace(/\.pdf$/i, '');
    const doc = await PDFDocument.load(st.bytes, { ignoreEncryption: true });
    const pages = doc.getPages(); st.pages = pages.length; st.cur = 1;
    const fields = doc.getForm().getFields(); st.fields = []; st.values = {};
    for (const f of fields) {
      const t = typeName(f); if (!['PDFTextField', 'PDFCheckBox', 'PDFRadioGroup', 'PDFDropdown', 'PDFOptionList'].includes(t)) continue;
      const w = f.acroField.getWidgets()[0]; let page = 0;
      if (w) { const ref = w.P(); page = pages.findIndex((p) => p.ref === ref) + 1; }
      const info = { name: f.getName(), type: t, page: page || 0 };
      if (t === 'PDFTextField') { info.multi = f.isMultiline(); st.values[info.name] = f.getText() || ''; }
      else if (t === 'PDFCheckBox') st.values[info.name] = f.isChecked();
      else if (t === 'PDFRadioGroup') { info.options = f.getOptions(); st.values[info.name] = f.getSelected() || ''; }
      else if (t === 'PDFDropdown') { info.options = f.getOptions(); st.values[info.name] = f.getSelected()[0] || ''; }
      else { info.options = f.getOptions(); info.multiSel = true; st.values[info.name] = f.getSelected(); }
      st.fields.push(info);
    }
    st.pdf = await window.pdfjsLib.getDocument({ data: st.bytes.slice(0) }).promise;
    $('#fm-info').textContent = `${file.name} · ${st.pages} trang · ${st.fields.length} trường`;
    renderFields();
    if (!st.fields.length) toast('PDF này không có trường form (AcroForm) để điền', 'info');
    await renderPage(st.bytes);
  } catch (e) { toast('Không mở được PDF: ' + (e.message || e), 'error'); }
  finally { window.Progress?.hide(); }
}

function renderFields() {
  const box = $('#fm-fields'), q = $('#fm-search').value.trim().toLowerCase(); box.innerHTML = '';
  const list = st.fields.filter((f) => !q || f.name.toLowerCase().includes(q));
  if (!list.length) { box.innerHTML = '<div class="fm-hint">Không có trường nào</div>'; return; }
  for (const f of list) {
    const row = document.createElement('div'); row.className = 'fm-row';
    const label = document.createElement('label'); label.innerHTML = `<span></span><i>${f.page ? 'tr.' + f.page : ''}</i>`; label.firstChild.textContent = f.name;
    row.appendChild(label); let inp;
    if (f.type === 'PDFTextField') { inp = document.createElement(f.multi ? 'textarea' : 'input'); inp.value = st.values[f.name]; if (f.multi) inp.rows = 3; inp.oninput = () => { st.values[f.name] = inp.value; queue(); }; }
    else if (f.type === 'PDFCheckBox') { inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!st.values[f.name]; inp.onchange = () => { st.values[f.name] = inp.checked; queue(); }; }
    else { inp = document.createElement('select'); if (f.multiSel) inp.multiple = true;
      if (!f.multiSel) inp.add(new Option('— không chọn —', ''));
      f.options.forEach((o) => { const op = new Option(o, o); op.selected = f.multiSel ? st.values[f.name].includes(o) : st.values[f.name] === o; inp.add(op); });
      inp.onchange = () => { st.values[f.name] = f.multiSel ? [...inp.selectedOptions].map((x) => x.value) : inp.value; queue(); }; }
    inp.addEventListener('focus', () => { if (f.page && f.page !== st.cur) { st.cur = f.page; renderPage(); } });
    row.appendChild(inp); box.appendChild(row);
  }
}

// Áp giá trị vào bản sao PDF, trả về bytes. flatten=true để làm phẳng.
async function buildFilled(flatten) {
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.load(st.bytes, { ignoreEncryption: true });
  const form = doc.getForm(), fb = embeddedFontBytes('roboto', 'regular'); let font = null;
  if (fb) { doc.registerFontkit(window.fontkit); font = await doc.embedFont(fb, { subset: true }); }
  const errs = [];
  for (const f of st.fields) {
    const v = st.values[f.name]; let fld;
    try {
      fld = form.getField(f.name);
      if (f.type === 'PDFTextField') fld.setText(v || undefined);
      else if (f.type === 'PDFCheckBox') v ? fld.check() : fld.uncheck();
      else if (f.type === 'PDFRadioGroup') { if (v) fld.select(v); }
      else if (f.type === 'PDFDropdown') { if (v) fld.select(v); else fld.clear(); }
      else { fld.clear(); if (v.length) fld.select(v); }
    } catch (e) { errs.push(f.name); }
  }
  try { font ? form.updateFieldAppearances(font) : form.updateFieldAppearances(); } catch (e) { errs.push('(giao diện trường)'); }
  if (flatten) form.flatten();
  if (errs.length) toast('Không điền được: ' + errs.slice(0, 3).join(', ') + (errs.length > 3 ? '…' : ''), 'error');
  return doc.save();
}

function queue() { clearTimeout(st.timer); st.timer = setTimeout(refresh, 900); }
async function refresh() {
  if (!st.bytes) return;
  try { const out = await buildFilled(false); await renderPage(out); } catch (e) { toast('Lỗi xem trước: ' + (e.message || e), 'error'); }
}
async function renderPage(bytes) {
  const tk = ++st.token;
  if (bytes) { st.pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes).slice(0) }).promise; }
  if (!st.pdf) return;
  const page = await st.pdf.getPage(st.cur), stage = $('#fm-stage');
  const base = page.getViewport({ scale: 1 }), scale = Math.min(1.6, Math.max(0.4, (stage.clientWidth - 32) / base.width)), vp = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1, cv = document.createElement('canvas');
  cv.width = vp.width * dpr; cv.height = vp.height * dpr; cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px'; cv.className = 'fm-page';
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, annotationMode: window.pdfjsLib.AnnotationMode?.ENABLE_FORMS ?? 2 }).promise;
  if (tk !== st.token) return;
  stage.innerHTML = ''; stage.appendChild(cv); $('#fm-pageinfo').textContent = `${st.cur} / ${st.pages}`;
}

async function exportPdf() {
  if (!st.bytes) return toast('Chưa có file PDF', 'error');
  try {
    window.Progress?.show('Đang tạo PDF...');
    const out = await buildFilled($('#fm-flat').checked); download(out, st.name + '-filled.pdf');
    log('fill_form'); toast('Đã xuất ' + st.name + '-filled.pdf', 'success');
  } catch (e) { toast('Lỗi xuất PDF: ' + (e.message || e), 'error'); } finally { window.Progress?.hide(); }
}

export function initForm() {
  if (!addTab('tab-form', '📝 Điền form', HTML)) return;
  $('#fm-open').onclick = () => $('#fm-pdf').click();
  $('#fm-pdf').onchange = (e) => { if (e.target.files[0]) openPdf(e.target.files[0]); e.target.value = ''; };
  $('#fm-search').oninput = renderFields; $('#fm-refresh').onclick = refresh; $('#fm-export').onclick = exportPdf;
  $('#fm-prev').onclick = () => { if (st.cur > 1) { st.cur--; renderPage(); } };
  $('#fm-next').onclick = () => { if (st.cur < st.pages) { st.cur++; renderPage(); } };
}
