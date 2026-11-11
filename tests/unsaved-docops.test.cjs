// Thao tác làm đổi tài liệu nhưng nạp lại với preservePage=false (xóa trang, thêm trang trống) PHẢI vẫn bị coi là "chưa lưu".
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const core = fs.readFileSync(path.join(__dirname, '../public/legacy/10-core.js'), 'utf8');
const ribbon = fs.readFileSync(path.join(__dirname, '../src/features/editorWordRibbon.js'), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };

// 1) hành vi: sau khi "mở file" (editorLoadBytes reset cờ) rồi gọi editorMarkDocDirty -> dirty
const a = core.indexOf('// ===== Cảnh báo dữ liệu chưa lưu'), b = core.indexOf('async function editorExportPDF(captureCb) {');
assert.ok(a > 0 && b > a);
const ctx = { window: { addEventListener() {} }, console }; ctx.window.window = ctx.window; vm.createContext(ctx);
vm.runInContext('let editorPdfDataBytes=null, modifiedTexts=[], modifiedImages=[], editorShapes=[], editorSigs=[], addedTexts=[];\n' + core.slice(a, b) +
  '\nthis.api={dirty:()=>editorIsDirty(), load:()=>{editorPdfDataBytes=new ArrayBuffer(8);editorSavedSig=null;editorDocOpsDirty=false;}};', ctx);
assert.equal(typeof ctx.window.editorMarkDocDirty, 'function'); ok('có window.editorMarkDocDirty');
ctx.api.load(); assert.equal(ctx.api.dirty(), false);
ctx.window.editorMarkDocDirty(); assert.equal(ctx.api.dirty(), true); ok('nạp lại (preservePage=false) rồi đánh dấu -> chưa lưu');

// 2) nối dây: MỌI lời gọi editorLoadBytes(..., false) trong ribbon phải đánh dấu ngay sau đó
const lines = ribbon.split('\n'); let calls = 0;
lines.forEach((l, i) => {
  if (/editorLoadBytes\(.*,\s*false\)/.test(l)) {
    calls++;
    assert.ok(lines.slice(i + 1, i + 3).some((x) => x.includes('editorMarkDocDirty')), 'dòng ' + (i + 1) + ': thiếu editorMarkDocDirty sau editorLoadBytes(..., false)');
  }
});
assert.ok(calls >= 2, 'phải còn ít nhất 2 chỗ (xóa trang, thêm trang trống)');
ok(`${calls} thao tác dùng preservePage=false đều đánh dấu chưa lưu (xóa trang, thêm trang trống)`);
console.log(`\n${n} kiểm thử đạt`);
