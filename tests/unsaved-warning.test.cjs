// Cảnh báo chưa lưu: chỉ coi là "đã lưu" sau khi xuất THÀNH CÔNG; thao tác cả tài liệu cũng tính là chưa lưu.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../public/legacy/10-core.js'), 'utf8');
const a = src.indexOf('// ===== Cảnh báo dữ liệu chưa lưu'), b = src.indexOf('async function editorExportPDF(captureCb) {');
assert.ok(a > 0 && b > a);
const listeners = {};
const ctx = { window: { addEventListener: (t, f) => { listeners[t] = f; } }, console };
ctx.window.window = ctx.window; vm.createContext(ctx);
vm.runInContext('let editorPdfDataBytes=null, modifiedTexts=[], modifiedImages=[], editorShapes=[], editorSigs=[], addedTexts=[];\n' + src.slice(a, b) +
  '\nthis.api={dirty:()=>editorIsDirty(),open:()=>{editorPdfDataBytes=new ArrayBuffer(8);editorSavedSig=null;editorDocOpsDirty=false;},' +
  'edit:()=>modifiedTexts.push({page:1,text:"x"}),saveOk:()=>{editorSavedSig=editorEditsSig();editorDocOpsDirty=false;},docOp:()=>{editorDocOpsDirty=true;}};', ctx);
const api = ctx.api; let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };
assert.equal(api.dirty(), false); ok('chưa mở file: không cảnh báo');
api.open(); assert.equal(api.dirty(), false); ok('mở file xong, chưa sửa: không cảnh báo');
api.edit(); assert.equal(api.dirty(), true); ok('có chỉnh sửa: cảnh báo');
const ev = { preventDefault() { this.p = true; } }; listeners.beforeunload(ev); assert.equal(ev.p, true); ok('beforeunload chặn đóng tab khi chưa lưu');
// xuất thất bại: không gọi saveOk -> vẫn dirty
assert.equal(api.dirty(), true); ok('xuất thất bại: vẫn là chưa lưu');
api.saveOk(); assert.equal(api.dirty(), false); const ev2 = { preventDefault() { this.p = true; } }; listeners.beforeunload(ev2); assert.equal(ev2.p, undefined); ok('xuất thành công: hết cảnh báo');
api.docOp(); assert.equal(api.dirty(), true); ok('thao tác cả tài liệu (canh lề...) chưa xuất: cảnh báo');
api.saveOk(); api.edit(); assert.equal(api.dirty(), true); ok('sửa thêm sau khi lưu: lại cảnh báo');
console.log(`\n${n} kiểm thử đạt`);
