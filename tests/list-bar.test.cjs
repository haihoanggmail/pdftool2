// Thanh danh sách file (tab Chuyển đổi/PDF): trạng thái đóng/mở tính THEO TỪNG công cụ, không bị đổi tab làm đóng nhầm.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../public/legacy/50-d.js'), 'utf8');
const a = src.indexOf('    let listOpen = true;'), b = src.indexOf('    async function updateToolPreview()');
const c = src.indexOf('    function setListOpen(open)'), d = src.indexOf("    document.addEventListener('click', e => {\n        const pb");
assert.ok(a > 0 && b > a && c > b && d > c);
let previews = 0;
const els = {}; const mk = () => ({ cls: new Set(), attrs: {}, textContent: '', classList: { toggle(k, f) { f ? this.s.add(k) : this.s.delete(k); }, s: null } });
['tl-list', 'tl-listbar', 'tl-list-status'].forEach((id) => { const e = mk(); e.classList.s = e.cls; els[id] = e; e.setAttribute = function (k, v) { this.attrs[k] = v; }; });
const ctx = { $: (id) => els[id], tool: 'A', updateToolPreview: () => { previews++; }, console };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b).replace('const barSt', 'var barSt').replace('let listOpen', 'var listOpen') + src.slice(c, d) + '\nthis.api={open:()=>listOpen, upd:(l)=>updateListBar(l), set:(t)=>{tool=t;}};', ctx);
const api = ctx.api; let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };
const file = (done) => ({ selected: true, outs: done ? [1] : [] });

api.upd([]); assert.equal(api.open(), true); ok('danh sách trống: mở sẵn');
api.upd([file(false), file(false), file(false)]); assert.equal(api.open(), false); ok('vừa có file đầu tiên: thu gọn nhường chỗ xem trước');
api.upd([file(true), file(true), file(true)]); assert.equal(api.open(), true); ok('xử lý xong thêm file: tự mở để thấy nút tải');
// đổi sang công cụ B (trống) rồi quay lại A (đã có 3 kết quả): KHÔNG được tự thu gọn
api.set('B'); api.upd([]); assert.equal(api.open(), true);
api.set('A'); api.upd([file(true), file(true), file(true)]); assert.equal(api.open(), true, 'quay lại công cụ A không được đóng danh sách kết quả');
ok('đổi tab qua công cụ trống rồi quay lại: danh sách kết quả vẫn mở');
// công cụ B có file riêng không làm sai trạng thái của A
api.set('B'); api.upd([file(false)]); assert.equal(api.open(), false);
api.set('A'); api.upd([file(true), file(true), file(true)]); assert.equal(api.open(), false); // trạng thái hiển thị là toàn cục, nhưng KHÔNG bị kích hoạt lại ngoài ý muốn
ok('mỗi công cụ có bộ đếm riêng');
console.log(`\n${n} kiểm thử đạt`);
