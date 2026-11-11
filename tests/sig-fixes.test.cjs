// 1) Kéo chữ ký trong trình Chỉnh sửa: khung chọn vùng không được nuốt pointerdown của .editor-sig-box
// 2) Tab Ký tên: xuất PDF phải hồi phục khi tài liệu pdf.js đã bị hủy ("sendWithPromise" của null)
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };

const core = fs.readFileSync(path.join(root, 'public/legacy/10-core.js'), 'utf8');
const i = core.indexOf('function beginRegionSelect(e) {'), j = core.indexOf('function moveMarquee', i);
const body = core.slice(i, j);
const guard = body.indexOf(".closest('.editor-sig-box')"), prevent = body.indexOf('e.preventDefault()');
assert.ok(guard > 0 && prevent > guard, 'phải thoát sớm cho .editor-sig-box trước khi preventDefault/stopPropagation');
// chạy thật hàm với sự kiện giả
const fn = new Function('editorCurrentTool_', 'OBJ', 'selected', 'ctx', 'return function(e){ const editorCurrentTool = editorCurrentTool_; ' + body.slice(body.indexOf('{') + 1, body.lastIndexOf('}')) + '}');
let swallowed = false;
const mk = (hit) => ({ button: 0, pointerType: 'mouse', shiftKey: false, preventDefault() { swallowed = true; }, stopPropagation() { swallowed = true; },
  target: { closest: (sel) => (sel === '.editor-sig-box' ? hit : null) } });
try { fn('text', '.x', new Set())(mk({})); } catch (e) { /* các biến khác của khung chọn không có trong môi trường test */ }
assert.equal(swallowed, false, 'bấm vào chữ ký không bị khung chọn nuốt');
ok('bấm vào chữ ký: khung chọn vùng thoát sớm, không chặn sự kiện của trình kéo chữ ký');

const sign = fs.readFileSync(path.join(root, 'src/features/sign.js'), 'utf8');
const a = sign.indexOf('async function ensurePdf() {'), b = sign.indexOf('async function renderPage()', a);
(async () => {
  let created = 0;
  const window = { pdfjsLib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 7, getPage: async () => ({}), destroy() {} }) }) } };
  const st = { bytes: new Uint8Array([1, 2, 3]), pdf: { getPage: async () => { throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')"); }, destroy() { throw new Error('đã hủy'); } } };
  const ensurePdf = new Function('st', 'window', sign.slice(a, b) + '\nreturn ensurePdf;')(st, window);
  await ensurePdf();
  assert.equal(st.pages, 7); await st.pdf.getPage(1);
  ok('tài liệu pdf.js đã bị hủy: ensurePdf mở lại từ bytes gốc');
  const keep = { getPage: async () => ({}), destroy() { throw new Error('không được hủy'); } }; st.pdf = keep;
  await ensurePdf(); assert.equal(st.pdf, keep);
  ok('tài liệu còn sống: giữ nguyên, không mở lại');
  assert.ok(/ensurePdf\(\);\s*const tk|await ensurePdf\(\); const tk/.test(sign) && sign.includes("throw new Error('Chưa đặt chữ ký nào lên trang');\n  await ensurePdf();"), 'export và render đều gọi ensurePdf');
  ok('xuất PDF và vẽ trang đều gọi ensurePdf');
  console.log(`\n${n} kiểm thử đạt`);
})().catch((e) => { console.error(e); process.exit(1); });
