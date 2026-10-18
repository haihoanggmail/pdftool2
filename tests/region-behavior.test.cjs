// Kiểm thử hành vi chọn vùng / kéo nhóm / Delete / nhích mũi tên bằng jsdom (chạy đúng mã trong 10-core.js)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.resolve(__dirname, '../public/legacy/10-core.js'), 'utf8');
const a = src.indexOf('// Chọn vùng an toàn: chỉ chọn đối tượng');
const b = src.indexOf('\nfunction editorCopySelection()');
const c = src.indexOf('function editorRegionNodes()');
const d = src.indexOf('(function bindEditorQuickActions()');
assert.ok(a > 0 && b > a && c > b && d > c, 'không tìm thấy các khối mã cần kiểm thử');
const regionCode = src.slice(a, b);
const quickFns = src.slice(c, d);

const dom = new JSDOM('<body><div id="tab-editor" class="active"><div id="editor-page-shell"><div id="editor-text-layer"></div></div></div><span id="editor-region-status"></span><button id="editor-clear-region-btn"></button></body>', { runScripts: 'outside-only' });
const w = dom.window;
// jsdom không có bố cục: cho offsetWidth/offsetHeight đọc từ data-w / data-h
Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { get() { return Number(this.dataset.w || 0); } });
Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { get() { return Number(this.dataset.h || 0); } });

w.eval(`
var editorCurrentTool = 'text', editorSel = null, editorPage = 1, editorScale = 1, editorSeq = 0, editorHistRestoring = false;
var editorPdfJsDoc = {}, addedTexts = [], modifiedTexts = [], modifiedImages = [];
var editorViewport = { transform: [1,0,0,1,0,0], convertToPdfPoint: (x, y) => [x, 1000 - y] };
var pdfjsLib = { Util: { transform: (a, b) => b } };
var calls = { mask: 0, save: [], hist: 0, toast: [] , rebuilt: 0 };
function maskOriginalPosition() { calls.mask++; }
function savePositionAndText(el, item, idx) { calls.save.push(idx); }
function updateModifiedItemFormatting(idx, sp) { modifiedTexts.push({ key: editorPage + '_' + idx, text: sp.textContent }); }
function recordHistory() { if (!editorHistRestoring) calls.hist++; }
function applySelHighlight() {}
function buildAddedTexts() { calls.rebuilt++; }
function addedK() { return 0.8; } function fontKeyOf() { return 'roboto'; }
window.toast = function (m) { calls.toast.push(m); };
`);
w.eval(regionCode);
w.eval(quickFns);

const doc = w.document, layer = doc.getElementById('editor-text-layer');
function mk(tag, attrs, left, top, wd, ht, text) {
  const el = doc.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  el.style.left = left + 'px'; el.style.top = top + 'px'; el.dataset.w = wd; el.dataset.h = ht;
  if (text) el.textContent = text;
  layer.appendChild(el); return el;
}
const inside   = mk('span', { 'data-tidx': '0' }, 20, 20, 40, 10, 'trong');
const clipped  = mk('span', { 'data-tidx': '1' }, 90, 20, 40, 10, 'bi cat');       // lọt ra ngoài mép phải
const outside  = mk('span', { 'data-tidx': '2' }, 300, 300, 40, 10, 'ngoai');
const added    = mk('span', { 'data-added-id': 'a1' }, 20, 50, 40, 10, 'chu them');
const imgBox   = mk('div',  { 'class': 'editor-img-box', 'data-img-key': '1_img0' }, 20, 70, 30, 20);
inside._item = { transform: [1,0,0,1,0,0] }; clipped._item = { transform: [1,0,0,1,0,0] };
w.eval("addedTexts.push({ id: 'a1', page: 1, text: 'chu them', x: 20, y: 950, fontSize: 10 });");
let commits = 0; imgBox._prepareForGroupMove = () => {}; imgBox._commitGroupMove = () => { commits++; };

let pid = 0;
function ptr(type, x, y, target, extra) {
  const ev = new w.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }, extra || {}));
  Object.defineProperty(ev, 'pointerId', { value: pid }); Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  (target || layer).dispatchEvent(ev); return ev;
}
const sel = () => Array.from(w.editorRegion.nodes());
const ev_ = x => JSON.parse(JSON.stringify(w.eval(x)));
let n = 0; const ok = m => { n++; console.log('ok  ', m); };

// 1) Kéo khung trên vùng trống: chỉ chọn đối tượng nằm TRỌN trong khung
pid = 1;
let ev = ptr('pointerdown', 5, 5, layer);
assert.equal(ev.defaultPrevented, true, 'pointerdown trên vùng trống phải bắt đầu khung chọn');
ptr('pointermove', 100, 100, layer);
ptr('pointerup', 110, 110, layer);
assert.deepEqual(sel().map(e => e.textContent || e.className), ['trong', 'chu them', 'editor-img-box region-selected'], 'chọn chữ gốc + chữ thêm + ảnh nằm trọn');
assert.ok(!sel().includes(clipped), 'đối tượng bị khung cắt không được chọn');
assert.ok(!sel().includes(outside), 'đối tượng ngoài khung không được chọn');
assert.ok(inside.classList.contains('region-selected') && !clipped.classList.contains('region-selected'));
assert.equal(doc.getElementById('editor-clear-region-btn').disabled, false);
ok('khung chọn: chọn đủ chữ gốc/chữ thêm/ảnh, bỏ qua đối tượng bị cắt');

// 2) Kéo một đối tượng đã chọn: cả nhóm di chuyển + lưu tọa độ mới
pid = 2;
ev = ptr('pointerdown', 30, 25, inside);
assert.equal(ev.defaultPrevented, true, 'pointerdown trên đối tượng đã chọn bắt đầu kéo nhóm');
ptr('pointermove', 50, 35, inside);
ptr('pointerup', 50, 35, inside);
assert.equal(inside.style.left, '40px'); assert.equal(inside.style.top, '30px');
assert.equal(added.style.left, '40px'); assert.equal(imgBox.style.left, '40px');
assert.equal(clipped.style.left, '90px', 'đối tượng không chọn đứng yên');
assert.deepEqual(ev_('calls.save'), [0], 'lưu vị trí chữ gốc');
assert.equal(commits, 1, 'lưu vị trí ảnh');
const ad = w.eval('addedTexts[0]'); assert.equal(ad.x, 40); assert.equal(ad.y, 1000 - (60 + 0.8 * 10), 'tọa độ chữ thêm cập nhật');
assert.ok(w.eval('calls.hist') >= 1, 'ghi lịch sử');
ok('kéo nhóm: di chuyển và lưu tọa độ cho chữ gốc, chữ thêm, ảnh');

// 3) Nhích bằng mũi tên: cả nhóm, chỉ ghi lịch sử 1 lần
const histBefore = w.eval('calls.hist');
assert.equal(w.editorNudgeSelection(5, -3), true);
assert.equal(inside.style.left, '45px'); assert.equal(inside.style.top, '27px');
assert.equal(w.eval('calls.hist'), histBefore + 1, 'cả nhóm chỉ ghi lịch sử một lần');
ok('nhích mũi tên theo nhóm');

// 4) Delete nhóm: chữ gốc -> rỗng, chữ thêm -> xóa, ảnh gốc -> bỏ qua kèm thông báo
assert.equal(w.editorDeleteSelection(), true);
assert.equal(inside.textContent, '', 'chữ gốc bị xóa nội dung');
assert.equal(w.eval('addedTexts.length'), 0, 'chữ thêm bị xóa');
assert.equal(w.eval('calls.rebuilt'), 1);
assert.ok(imgBox.isConnected, 'ảnh gốc không bị xóa');
assert.ok(ev_('calls.toast').some(m => /bản sao của ảnh/.test(m)), 'có thông báo cho ảnh gốc');
assert.equal(sel().length, 0, 'vùng chọn được dọn');
ok('Delete nhóm đúng từng loại đối tượng');

// 5) Esc: chỉ báo "Đã bỏ chọn" khi thực sự có vùng chọn
pid = 3;
w.editorRegion.set([clipped]);
w.eval('calls.toast.length = 0');
doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
assert.equal(sel().length, 0); assert.deepEqual(ev_('calls.toast'), ['Đã bỏ chọn vùng']);
doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
assert.deepEqual(ev_('calls.toast'), ['Đã bỏ chọn vùng'], 'Esc khi không có gì chọn không báo thêm');
ok('Esc bỏ chọn, không báo lặp');

// 6) Công cụ khác (vẽ) thì không bắt đầu khung chọn
w.eval("editorCurrentTool = 'rect'");
ev = ptr('pointerdown', 5, 5, layer);
assert.equal(ev.defaultPrevented, false, 'công cụ vẽ không bị chặn');
w.eval("editorCurrentTool = 'text'");
ok('không can thiệp khi đang dùng công cụ vẽ');

console.log('Region behavior tests passed (' + n + ').');
