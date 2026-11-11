// ensurePdf (tab Ký tên): các lần vẽ trang chạy CÙNG LÚC chỉ được mở lại tài liệu pdf.js một lần, và lỗi không làm kẹt lần sau.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const sign = fs.readFileSync(path.join(__dirname, '../src/features/sign.js'), 'utf8');
const a = sign.indexOf('async function ensurePdf() {'), b = sign.indexOf('async function renderPage()', a);
assert.ok(a > 0 && b > a);
const make = (getDocument, st) => new Function('st', 'window', sign.slice(a, b) + '\nreturn ensurePdf;')(st, { pdfjsLib: { getDocument } });
const dead = () => ({ getPage: async () => { throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')"); }, destroy() {} });
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };

(async () => {
  { // 3 lần cùng lúc -> mở lại đúng 1 lần
    let opened = 0;
    const st = { bytes: new Uint8Array([1, 2, 3]), pdf: dead() };
    const ensure = make(() => { opened++; return { promise: new Promise((r) => setTimeout(() => r({ numPages: 4, getPage: async () => ({}), destroy() {} }), 15)) }; }, st);
    await Promise.all([ensure(), ensure(), ensure()]);
    assert.equal(opened, 1); assert.equal(st.pages, 4); assert.equal(st.ensuring, null);
    ok('3 lần gọi cùng lúc chỉ mở lại tài liệu 1 lần, không bỏ rơi bản nào');
  }
  { // mở lại lỗi: mọi lần gọi đang chờ đều nhận lỗi; cờ được xóa nên lần sau thử lại được
    let calls = 0;
    const st = { bytes: new Uint8Array([1]), pdf: dead() };
    const ensure = make(() => { calls++; return { promise: calls === 1 ? Promise.reject(new Error('hỏng')) : Promise.resolve({ numPages: 2, getPage: async () => ({}), destroy() {} }) }; }, st);
    const r = await Promise.allSettled([ensure(), ensure()]);
    assert.ok(r.every((x) => x.status === 'rejected')); assert.equal(st.ensuring, null);
    await ensure(); assert.equal(st.pages, 2);
    ok('mở lại lỗi: các lần gọi đang chờ cùng nhận lỗi, lần sau vẫn thử lại được');
  }
  { // không có bytes -> không làm gì
    let calls = 0; const st = { bytes: null, pdf: null };
    await make(() => { calls++; return { promise: Promise.resolve({}) }; }, st)();
    assert.equal(calls, 0); ok('chưa có file: không làm gì');
  }
  console.log(`\n${n} kiểm thử đạt`);
})().catch((e) => { console.error(e); process.exit(1); });
