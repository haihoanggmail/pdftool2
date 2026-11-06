// Kiểm thử độ "giống bản gốc" khi sửa chữ PDF: màu nền che chữ cũ, đoán font gần giống, căn đường cơ sở, nút chọn nền.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.resolve(__dirname, '../public/legacy/10-core.js'), 'utf8');
const iBg = src.indexOf('// Màu chiếm nhiều nhất trong mảng điểm ảnh RGBA');
const iSample = src.indexOf('function sampleTextColors(originalItem) {');
const iFont = src.indexOf('// Tên font thật trong PDF');
const iSetBg = src.indexOf('function setTextMaskBackground(');
const endMark = 'window.setTextMaskBackground = setTextMaskBackground;';
const iEnd = src.indexOf(endMark);
assert.ok(iBg > 0 && iSample > iBg && iFont > 0 && iSetBg > iFont && iEnd > iSetBg, 'không tìm thấy các khối mã cần kiểm thử');
const bgCode = src.slice(iBg, iSample);                 // dominantColorFromPixels, dominantBackgroundColor
const fontCode = src.slice(iFont, iSetBg);              // realFontName, guessFontKey, fixSpanBaseline, hint...
const setBgCode = src.slice(iSetBg, iEnd + endMark.length);

const dom = new JSDOM('<body><div id="editor-text-layer"></div></body>', { runScripts: 'outside-only' });
const w = dom.window;
w.eval(`
var editorPage = 1, editorSeq = 0, editorViewport = { transform: [1,0,0,1,0,0] };
var pdfjsLib = { Util: { transform: (a, b) => b } };
var modifiedTexts = [], hist = 0, toasts = [], masks = [];
function recordHistory() { hist++; }
function savePositionAndText(span, item, idx) { modifiedTexts.push({ key: editorPage + '_' + idx, bgColor: '#000000', preserveOriginalFormatting: true }); }
function maskOriginalPosition(idx) {
  const m = document.createElement('div'); m.className = 'original-mask'; m.setAttribute('data-index', idx);
  document.getElementById('editor-text-layer').appendChild(m);
}
function sampleTextColors(item) { return { color: '#000000', bg: item._autoBg || '#ffffff' }; }
function fontInfo(k) { return { label: k, styles: ['regular'] }; }
window.toast = function (m) { toasts.push(m); };
window.LOCAL_FONTS = {};
// _measureCtx giả: đo theo tên font (ascent/descent khác nhau)
var _measureCtx = { font: '', measureText() {
  const f = this.font;
  if (/Roboto/.test(f)) return { fontBoundingBoxAscent: 92.7, fontBoundingBoxDescent: 24.4 };
  if (/Tinos/.test(f))  return { fontBoundingBoxAscent: 89.1, fontBoundingBoxDescent: 21.6 };
  return { fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 0 };
} };
`);
w.eval(bgCode); w.eval(fontCode); w.eval(setBgCode);
const J = x => JSON.parse(JSON.stringify(x));
let n = 0; const ok = m => { n++; console.log('ok  ', m); };

// 1) Màu nền: nền trắng + nét chữ xám/anti-alias ở rìa -> phải ra TRẮNG, không ra xám
{
  const W = 40, H = 12, px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[i*4] = 255; px[i*4+1] = 255; px[i*4+2] = 255; px[i*4+3] = 255; }
  // vài điểm "nét chữ" xám đậm và anti-alias nhạt
  for (const i of [5, 6, 7, 45, 46, 90, 91, 92, 93]) { px[i*4] = px[i*4+1] = px[i*4+2] = 200; }
  for (const i of [100, 101, 102]) { px[i*4] = px[i*4+1] = px[i*4+2] = 20; }
  assert.equal(w.dominantColorFromPixels(px), '#ffffff');
  // Cách cũ (lấy 1 điểm tại vị trí trúng nét anti-alias) cho ra xám:
  const old = '#' + [px[5*4], px[5*4+1], px[5*4+2]].map(v => v.toString(16).padStart(2, '0')).join('');
  assert.equal(old, '#c8c8c8');
  ok('nền trắng giữ đúng #ffffff dù có nét chữ xám bên cạnh (cách cũ ra #c8c8c8)');
}
// 2) Nền màu kem (giấy ngả vàng) được giữ đúng
{
  const px = new Uint8ClampedArray(30 * 10 * 4);
  for (let i = 0; i < 300; i++) { px[i*4] = 250; px[i*4+1] = 244; px[i*4+2] = 224; px[i*4+3] = 255; }
  for (let i = 0; i < 40; i++) { px[i*4] = px[i*4+1] = px[i*4+2] = 30; }
  assert.equal(w.dominantColorFromPixels(px), '#faf4e0');
  ok('nền kem #faf4e0 được giữ nguyên');
}
// 3) Điểm ảnh trong suốt bị bỏ qua; mảng rỗng trả null
assert.equal(w.dominantColorFromPixels(new Uint8ClampedArray(16)), null);
ok('điểm ảnh trong suốt / mảng rỗng -> null (dùng màu mặc định)');

// 4) Đoán font theo tên thật
function guess(name) {
  w.window._editorPageObj = { commonObjs: { has: () => true, get: () => ({ name }) } };
  return w.guessFontKey({ fontName: 'g_d0_f1' });
}
assert.equal(guess('ABCDEF+TimesNewRomanPSMT'), 'tinos');
assert.equal(guess('LiberationSerif'), 'tinos');
assert.equal(guess('Courier'), 'cousine');
assert.equal(guess('DejaVuSansMono'), 'cousine');
assert.equal(guess('DejaVuSans'), 'roboto');
assert.equal(guess('Arial-BoldMT'), 'roboto');
assert.equal(guess('NotoSerif'), 'tinos');
assert.equal(guess('NotoSans'), 'roboto');
ok('đoán font: Times/Liberation Serif -> Tinos, Courier/Mono -> Cousine, còn lại -> Roboto');
// 4b) có font cùng tên trong máy -> dùng font đó
w.eval("window.LOCAL_FONTS = { 'DejaVu Sans': { regular: {} } };");
assert.equal(guess('ABCDEF+DejaVuSans'), 'local:DejaVu Sans');
w.eval('window.LOCAL_FONTS = {};');
ok('có font cùng tên trong máy -> chọn local:<tên font>');
// 4c) không có thông tin font -> Roboto
w.window._editorPageObj = null;
assert.equal(w.guessFontKey({ fontName: 'g_d0_f9' }), 'roboto');
ok('không đọc được tên font -> Roboto');

// 5) Căn đường cơ sở: baseline = top + 1em  =>  line-height = 2 - ascent + descent
{
  const sp = w.document.createElement('span');
  sp.setAttribute('data-tidx', '0'); sp.style.fontFamily = "'RobotoEmb', Roboto";
  w.fixSpanBaseline(sp);
  const lh = parseFloat(sp.style.lineHeight);
  assert.ok(Math.abs(lh - (2 - 0.927 + 0.244)) < 1e-3, 'line-height Roboto = ' + lh);
  // kiểm tra công thức: baseline trong hộp dòng = lh/2 + (asc - desc)/2 = 1
  assert.ok(Math.abs(lh / 2 + (0.927 - 0.244) / 2 - 1) < 1e-3);
  const sp2 = w.document.createElement('span');
  sp2.setAttribute('data-tidx', '1'); sp2.style.fontFamily = "'Tinos'";
  w.fixSpanBaseline(sp2);
  assert.ok(Math.abs(parseFloat(sp2.style.lineHeight) - (2 - 0.891 + 0.216)) < 1e-3);
  // font không đo được -> không đổi
  const sp3 = w.document.createElement('span'); sp3.setAttribute('data-tidx', '2'); sp3.style.fontFamily = 'Unknown';
  w.fixSpanBaseline(sp3); assert.equal(sp3.style.lineHeight, '');
  ok('căn đường cơ sở: line-height = 2 - ascent + descent cho từng font');
}

// 6) Nút chọn nền: tạo bản ghi nếu chưa có, cập nhật biến --mask-bg, "tự động" lấy lại màu từ trang
{
  const layer = w.document.getElementById('editor-text-layer');
  const sp = w.document.createElement('span');
  sp.setAttribute('data-tidx', '7'); sp._item = { transform: [1,0,0,1,0,0], _autoBg: '#fffef0' };
  layer.appendChild(sp);
  const used = w.setTextMaskBackground(7, sp, '#ff00ff');
  assert.equal(used, '#ff00ff');
  const m = J(w.eval('modifiedTexts'))[0]; assert.equal(m.bgColor, '#ff00ff');
  assert.equal(layer.querySelector('.original-mask[data-index="7"]').style.getPropertyValue('--mask-bg'), '#ff00ff');
  assert.ok(sp.classList.contains('modified'));
  const auto = w.setTextMaskBackground(7, sp, null);
  assert.equal(auto, '#fffef0');
  assert.equal(J(w.eval('modifiedTexts'))[0].bgColor, '#fffef0');
  assert.equal(layer.querySelector('.original-mask[data-index="7"]').style.getPropertyValue('--mask-bg'), '#fffef0');
  assert.equal(w.eval('modifiedTexts.length'), 1, 'không tạo bản ghi trùng');
  ok('nút nền: đặt màu tay, "tự động" lấy lại màu trang, không tạo bản ghi trùng');
}
console.log('Edit fidelity tests passed (' + n + ').');
