// Margin Engine V2: lề phải đo ra đúng số nhập, kể cả khi GIẢM lề (nội dung phải được phóng to), mọi hướng xoay.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../public/legacy/50-d.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, a); return src.slice(i, j); };
const code = cut('    function pageGeo(page) {', '    function toUser(') + cut('    function applyPageMarginTransform(', '    TOOLS.margin = {');
const { pageGeo, applyPageMarginTransform } = new Function(code + '\nreturn { pageGeo, applyPageMarginTransform };')();
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.01, `${m}: ${a} != ${b}`);

function mockPage(W, H, R) {
  const p = { calls: [], mb: { x: 0, y: 0, width: W, height: H }, R };
  p.getMediaBox = () => p.mb; p.getRotation = () => ({ angle: p.R });
  p.setSize = (w, h) => { p.mb.width = w; p.mb.height = h; }; p.setMediaBox = () => {};
  p.scaleContent = (x) => { p.s = x; }; p.translateContent = (x, y) => { p.tx = x; p.ty = y; };
  return p;
}
const toUser = (g, X, Y) => g.R === 0 ? [X, Y] : g.R === 90 ? [g.Wu - Y, X] : g.R === 180 ? [g.Wu - X, g.Hu - Y] : [Y, g.Hu - X];
const toVisual = (R, Wu, Hu, x, y) => R === 0 ? [x, y] : R === 90 ? [y, Wu - x] : R === 180 ? [Wu - x, Hu - y] : [Hu - y, x];

// Chạy transform rồi tính hộp nội dung (tọa độ nhìn thấy) sau biến đổi
function run(Wu, Hu, R, box, margins, mode = 'scale', trim = true) {
  const p = mockPage(Wu, Hu, R), g = pageGeo(p);
  applyPageMarginTransform(p, g, { mL: margins[0], mR: margins[1], mT: margins[2], mB: margins[3], mode, align: 'center', trimWhitespace: trim }, trim ? box : null);
  const s = p.s || 1, tx = p.tx, ty = p.ty, nWu = p.mb.width, nHu = p.mb.height;
  const cs = [[box.left, box.bottom], [box.right, box.bottom], [box.left, box.top], [box.right, box.top]]
    .map(([X, Y]) => toUser(g, X, Y)).map(([x, y]) => toVisual(R, nWu, nHu, s * x + tx, s * y + ty));
  const sw = (R === 90 || R === 270);
  return { s, W: sw ? nHu : nWu, H: sw ? nWu : nHu, x0: Math.min(...cs.map(c => c[0])), x1: Math.max(...cs.map(c => c[0])), y0: Math.min(...cs.map(c => c[1])), y1: Math.max(...cs.map(c => c[1])) };
}
const mm = (v) => v * 72 / 25.4;
const W = 595.28, H = 841.89, box = { left: 100, right: 300, bottom: 100, top: 400, width: 200, height: 300 };

for (const R of [0, 90, 180, 270]) {
  const Wu = (R === 90 || R === 270) ? H : W, Hu = (R === 90 || R === 270) ? W : H;     // kích thước chưa xoay
  const vb = (R === 0 || R === 180) ? box : { left: 100, right: 400, bottom: 100, top: 300, width: 300, height: 200 };
  // 1) GIẢM lề xuống 2 mm: nội dung phải phình ra, chạm đúng lề
  const m2 = mm(2), r = run(Wu, Hu, R, vb, [m2, m2, m2, m2]);
  assert.ok(r.s > 1.5, `xoay ${R}: phải phóng to, s=${r.s}`);
  const fitsW = (r.x1 - r.x0) > r.W - 2 * m2 - 0.02, fitsH = (r.y1 - r.y0) > r.H - 2 * m2 - 0.02;
  assert.ok(fitsW || fitsH, `xoay ${R}: nội dung phải chạm một cặp lề`);
  assert.ok(r.x0 >= m2 - 0.01 && r.x1 <= r.W - m2 + 0.01 && r.y0 >= m2 - 0.01 && r.y1 <= r.H - m2 + 0.01, `xoay ${R}: không vượt lề 2mm`);
  // 2) lề lớn 50 mm: thu nhỏ, vẫn nằm trong lề
  const m50 = mm(50), q = run(Wu, Hu, R, vb, [m50, m50, m50, m50]);
  assert.ok(q.x0 >= m50 - 0.01 && q.x1 <= q.W - m50 + 0.01 && q.y0 >= m50 - 0.01 && q.y1 <= q.H - m50 + 0.01, `xoay ${R}: trong lề 50mm`);
  // 3) lề không đối xứng 2/2/20/20 mm
  const a = run(Wu, Hu, R, vb, [mm(2), mm(2), mm(20), mm(20)]);
  assert.ok(a.x0 >= mm(2) - 0.01 && a.x1 <= a.W - mm(2) + 0.01 && a.y0 >= mm(20) - 0.01 && a.y1 <= a.H - mm(20) + 0.01, `xoay ${R}: lề 2/2/20/20`);
}
ok('xoay 0/90/180/270: lề 2 mm phóng to nội dung và không vượt lề; lề 50 mm và 2/2/20/20 vẫn nằm trong vùng cho phép');

{ // tỷ lệ: một hệ số s duy nhất cho cả hai chiều (không méo) – kiểm bằng việc tỷ lệ hộp nội dung giữ nguyên
  const r = run(W, H, 0, box, [mm(10), mm(10), mm(10), mm(10)]);
  near((r.x1 - r.x0) / (r.y1 - r.y0), box.width / box.height, 'tỷ lệ');
  ok('giữ nguyên tỷ lệ nội dung (không méo)'); }
{ // chiều còn lại được căn giữa
  const r = run(W, H, 0, box, [mm(10), mm(10), mm(10), mm(10)]);
  near((r.x0 + r.x1) / 2, W / 2, 'căn giữa ngang'); ok('nội dung được căn giữa trong vùng lề'); }
{ // không có vùng nội dung (trang trắng / tắt "bỏ lề trắng cũ") -> chỉ được thu nhỏ, không phóng to cả trang
  const r = run(W, H, 0, box, [mm(2), mm(2), mm(2), mm(2)], 'scale', false);
  assert.ok(r.s <= 1.0001, 's=' + r.s); ok('không có vùng nội dung: không phóng to cả trang (tránh cắt mất nội dung)'); }
{ // phóng to có trần 6 lần
  const tiny = { left: 10, right: 20, bottom: 10, top: 20, width: 10, height: 10 };
  const r = run(W, H, 0, tiny, [mm(2), mm(2), mm(2), mm(2)]);
  assert.ok(r.s <= 6.0001); ok('hệ số phóng to tối đa 6 lần'); }
{ // chế độ mở rộng khổ giấy: nội dung giữ nguyên kích thước, lề = số nhập
  const r = run(W, H, 0, box, [mm(10), mm(10), mm(10), mm(10)], 'expand');
  near(r.s, 1, 's'); near(r.x0, mm(10), 'lề trái'); near(r.W - r.x1, mm(10), 'lề phải'); near(r.y0, mm(10), 'lề dưới'); near(r.H - r.y1, mm(10), 'lề trên');
  ok('chế độ mở rộng khổ: lề đo ra đúng 10 mm bốn phía'); }
console.log(`\n${n} kiểm thử đạt`);
