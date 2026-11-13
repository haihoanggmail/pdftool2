// Lớp tương thích pdf.js (index.html + src/main.js): bổ sung destroy() và wasmUrl cho pdf.js >= 5, không đổi hành vi với bản cũ.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
let n = 0; const ok = (m) => { n++; console.log('ok  ', m); };

function load(codeText, fake) {
  const win = { pdfjsLib: fake, addEventListener() {} };
  new Function('window', 'document', 'console', 'URL', 'location', codeText)(win, { addEventListener() {}, baseURI: 'https://example.test/app/' }, console, URL, { href: 'https://example.test/app/' });
  return win.pdfjsLib;
}
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainCode = main.slice(main.indexOf('(function patchPdfJsEvalSecurity() {'), main.indexOf('})();', main.indexOf('(function patchPdfJsEvalSecurity() {')) + 5);
const hs = html.indexOf('(function() {\n  try {\n    if (window.pdfjsLib'), htmlCode = html.slice(hs, html.indexOf('})();', hs) + 5);
assert.ok(mainCode.length > 100 && htmlCode.length > 100);

(async () => {
  for (const [name, code] of [['src/main.js', mainCode], ['index.html', htmlCode]]) {
    // pdf.js >= 5: doc không có destroy(); task có destroy()
    let taskDestroyed = 0, seen = [];
    const fakeNew = { getDocument(src) { seen.push(src); const doc = { numPages: 2 }; const task = { promise: Promise.resolve(doc), destroy() { taskDestroyed++; return Promise.resolve(); } }; return task; } };
    const lib = load(code, fakeNew);
    const doc = await lib.getDocument({ data: new Uint8Array(1) }).promise;
    assert.equal(typeof doc.destroy, 'function', name + ': destroy phải được bổ sung');
    await doc.destroy(); assert.equal(taskDestroyed, 1, name + ': doc.destroy() phải gọi task.destroy()');
    assert.equal(seen[0].isEvalSupported, false); assert.equal(seen[0].wasmUrl, 'https://example.test/app/vendor/pdfjs/6.2.108/wasm/');
    ok(name + ': pdf.js mới -> có doc.destroy() và wasmUrl, vẫn ép isEvalSupported:false');

    // dạng gọi khác nhau đều nhận wasmUrl; wasmUrl do người gọi đặt được giữ nguyên
    lib.getDocument('https://x/y.pdf'); lib.getDocument(new Uint8Array(2)); lib.getDocument({ data: new Uint8Array(1), wasmUrl: 'custom/' });
    assert.ok(seen.slice(1, 3).every((s) => s.wasmUrl && s.isEvalSupported === false)); assert.equal(seen[3].wasmUrl, 'custom/');
    ok(name + ': URL, Uint8Array và wasmUrl tùy chỉnh đều được xử lý đúng');

    // pdf.js cũ (3.x): doc đã có destroy -> KHÔNG ghi đè
    let own = 0; const fakeOld = { getDocument() { const doc = { destroy() { own++; } }; return { promise: Promise.resolve(doc), destroy() { throw new Error('không được gọi'); } }; } };
    const lib2 = load(code, fakeOld); const d2 = await lib2.getDocument({ data: new Uint8Array(1) }).promise; d2.destroy();
    assert.equal(own, 1); ok(name + ': pdf.js cũ giữ nguyên destroy() gốc');

    // nạp tài liệu lỗi: promise bị từ chối vẫn đến tay người gọi, không có unhandled rejection do lớp tương thích
    const fakeErr = { getDocument() { return { promise: Promise.reject(new Error('hỏng file')), destroy() {} }; } };
    const lib3 = load(code, fakeErr); await assert.rejects(lib3.getDocument({ data: new Uint8Array(1) }).promise, /hỏng file/);
    ok(name + ': tài liệu lỗi vẫn báo lỗi đúng cho nơi gọi');

    // getDocument trả về giá trị lạ (không có promise) -> không ném
    const lib4 = load(code, { getDocument() { return { foo: 1 }; } }); assert.deepEqual(lib4.getDocument({ data: new Uint8Array(1) }), { foo: 1 });
    ok(name + ': giá trị trả về không có promise được bỏ qua an toàn');
  }
  console.log(`\n${n} kiểm thử đạt`);
})().catch((e) => { console.error(e); process.exit(1); });
