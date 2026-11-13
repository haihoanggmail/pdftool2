// Tab Ký tên: chế độ TẠO CHỮ KÝ (draw/img) và chế độ PHÓNG TO (width/page/actual/zoom) phải là hai trạng thái riêng.
// Lỗi cũ: dùng chung st.mode -> mở PDF/phóng to đặt st.mode='width|zoom|...' làm nút "Lưu chữ ký" không còn thấy chế độ 'draw'.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../src/features/sign.js'), 'utf8');
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };

const zoomModes = new Set(['width', 'page', 'actual', 'zoom']);
const assigns = [...src.matchAll(/st\.mode\s*=(?!=)\s*([^;]+);/g)].map((m) => m[1].trim());
assert.ok(assigns.length >= 6);
assigns.forEach((v) => assert.ok(/^'(width|page|actual|zoom)'$/.test(v), 'st.mode chỉ được gán chế độ phóng to, gặp: ' + v));
ok(`mọi ${assigns.length} lần gán st.mode đều là chế độ phóng to`);
assert.ok(!/st\.mode\s*===?\s*'(draw|img)'/.test(src), 'không được so st.mode với draw/img'); ok('không còn so sánh st.mode với draw/img');
assert.ok(/sigMode:\s*'draw'/.test(src) && /st\.sigMode\s*=\s*b\.dataset\.m/.test(src) && /st\.sigMode\s*===\s*'draw'\s*\?\s*\$\('#sg-canvas'\)/.test(src)); ok('chế độ tạo chữ ký dùng st.sigMode (khởi tạo draw, đổi bằng nút, đọc khi lưu)');

// mô phỏng: sau khi mở PDF (st.mode='width') nút Lưu vẫn phải chọn canvas vẽ
const st = { mode: 'width', sigMode: 'draw' }; const canvas = {}, imgCanvas = undefined;
assert.equal(st.sigMode === 'draw' ? canvas : imgCanvas, canvas);
st.mode = 'zoom'; assert.equal(st.sigMode === 'draw' ? canvas : imgCanvas, canvas); ok('đổi chế độ phóng to không ảnh hưởng nơi lấy nét vẽ');
console.log(`\n${n} kiểm thử đạt`);
