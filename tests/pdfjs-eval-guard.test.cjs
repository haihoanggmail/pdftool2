// Giảm thiểu CVE-2024-4367 (pdf.js < 4.2.67): mọi getDocument phải chạy với isEvalSupported:false.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('ok  ', m); };
const a = main.indexOf('(function patchPdfJsEvalSecurity() {'), b = main.indexOf('})();', a) + 5;
assert.ok(a > 0 && b > a);
const seen = [];
const win = { pdfjsLib: { getDocument(src) { seen.push(src); return { promise: Promise.resolve() }; }, other: 42 }, addEventListener() {} };
new Function('window', 'document', 'console', 'URL', main.slice(a, b))(win, { addEventListener() {} }, console, URL);
assert.equal(win.pdfjsLib.other, 42); assert.equal(win.pdfjsLib.__evalPatched, true);
win.pdfjsLib.getDocument({ data: new Uint8Array(3) }); win.pdfjsLib.getDocument(new Uint8Array(3));
win.pdfjsLib.getDocument('https://x/y.pdf'); win.pdfjsLib.getDocument({ data: new Uint8Array(1), isEvalSupported: true });
assert.equal(seen.length, 4); seen.forEach((s) => assert.equal(s.isEvalSupported, false));
ok('Proxy ép isEvalSupported:false cho object, Uint8Array, URL và cả khi code cố bật lại');
for (const f of fs.readdirSync(path.join(root, 'src/features')).filter((x) => x.endsWith('.js') && x !== 'editorWordRibbon.js')) {
  const t = fs.readFileSync(path.join(root, 'src/features', f), 'utf8');
  [...t.matchAll(/getDocument\(\{[^;]*?\}\)/g)].forEach((m) => assert.ok(m[0].includes('isEvalSupported: false'), f + ': ' + m[0].slice(0, 80)));
}
ok('các module trong src/features tự truyền isEvalSupported:false');
assert.ok(main.includes("document.addEventListener('DOMContentLoaded', applyPatch)") && main.includes("window.addEventListener('load', applyPatch)"));
ok('Proxy được cài lại ở DOMContentLoaded và load');
// pdf.js THỰC SỰ đóng gói trong public/vendor (không phải khai báo trong package.json): từ 4.2.67 mới có bản vá CVE-2024-4367
const vendored = (fs.readFileSync(path.join(root, 'scripts/copy-vendor.mjs'), 'utf8').match(/const PDFJS_VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
assert.equal(vendored.length, 3, 'không đọc được phiên bản pdf.js đóng gói');
assert.ok(vendored[0] > 4 || (vendored[0] === 4 && (vendored[1] > 2 || (vendored[1] === 2 && vendored[2] >= 67))), 'pdf.js đóng gói < 4.2.67 (còn lỗ hổng CVE-2024-4367)');
ok(`pdf.js đóng gói ${vendored.join('.')} đã bao gồm bản vá CVE-2024-4367 (biện pháp giảm thiểu vẫn giữ làm lớp bảo vệ bổ sung)`);
console.log(`\n${n} kiểm thử đạt`);
