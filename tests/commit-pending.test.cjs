// Kiểm thử lỗi "gõ chữ rồi bấm Lưu nhưng file xuất ra vẫn như cũ":
// commitPendingTextEdits() phải chốt mọi ô chữ đang gõ dở, và editorExportPDF phải gọi nó trước khi dựng PDF.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../public/legacy/10-core.js'), 'utf8');
let n = 0; const ok = m => { n++; console.log('ok  ', m); };

// 1) Trích đúng hàm và chạy với DOM giả
const i0 = src.indexOf('function commitPendingTextEdits() {');
const endMark = 'window.commitPendingTextEdits = commitPendingTextEdits;';
const i1 = src.indexOf(endMark);
assert.ok(i0 > 0 && i1 > i0, 'không tìm thấy commitPendingTextEdits');
const code = src.slice(i0, i1 + endMark.length);

function run(inputs, hasLayer = true) {
  const window = {};
  const document = { getElementById: id => (id === 'editor-text-layer' && hasLayer) ? { querySelectorAll: sel => sel === '.editing-input' ? inputs : [] } : null };
  new Function('window', 'document', 'console', code)(window, document, console);   // chỉ nạp hàm
  return window.commitPendingTextEdits();                                           // gọi đúng 1 lần
}
{
  const calls = [];
  const cnt = run([{ _commit: () => calls.push('a') }, { _commit: () => calls.push('b') }]);
  assert.deepEqual(calls, ['a', 'b']); assert.equal(cnt, 2);
  ok('chốt tất cả ô chữ đang gõ dở (chữ gốc + chữ thêm mới)');
}
{
  const calls = [];
  const cnt = run([{ _commit() { throw new Error('boom'); } }, { _commit: () => calls.push('ok') }, {}]);
  assert.deepEqual(calls, ['ok']); assert.equal(cnt, 1);
  ok('một ô lỗi hoặc không có _commit không chặn các ô còn lại');
}
assert.equal(run([], false), 0); ok('không có lớp chữ thì trả 0, không lỗi');

// 2) Nối dây: cả hai trình sửa chữ phải xuất _commit, và export phải gọi chốt TRƯỚC khi dựng PDF
assert.equal((src.match(/input\._commit = (commit|saveChange);/g) || []).length, 2); ok('cả 2 trình sửa chữ đều gán input._commit');
const exp = src.indexOf('async function editorExportPDF(captureCb)');
const call = src.indexOf('commitPendingTextEdits();', exp);
const load = src.indexOf('PDFLib.PDFDocument.load(editorPdfDataBytes)', exp);
assert.ok(call > exp && call < load, 'phải chốt trước khi PDFDocument.load'); ok('editorExportPDF chốt chữ gõ dở trước khi dựng PDF');

// 3) Nút xuất khôi phục đúng nội dung gốc, từng hình vẽ có try/catch
assert.ok(src.includes('btn.innerHTML = btnOrigHtml')); ok('nút xuất khôi phục innerHTML gốc');
assert.ok(src.includes("console.error('Lỗi vẽ hình:'")); ok('hình vẽ lỗi được bắt riêng');
console.log(`\n${n} kiểm thử đạt`);
