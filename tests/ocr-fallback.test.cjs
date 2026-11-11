// OCR: lượt 1 (PSM 3) đọc kém trên giấy tờ nền vân -> thử lại bằng PSM 11, chỉ nhận khi tốt hơn rõ rệt.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../public/legacy/50-d.js'), 'utf8');
let n = 0; const ok = m => { n++; console.log('ok  ', m); };

const a = src.indexOf("const OCR_PSM_AUTO = '3'");
const b = src.indexOf('TOOLS.ocr = {');
assert.ok(a > 0 && b > a, 'không tìm thấy khối helper OCR');
const H = new Function(src.slice(a, b) + '\nreturn { ocrConfidentWords, ocrNeedsRetry, ocrRetryIsBetter, OCR_RETRY_BELOW };')();

const mk = ws => ({ data: { blocks: [{ paragraphs: [{ lines: [{ words: ws.map(([t, c]) => ({ text: t, confidence: c })) }] }] }] } });
// đếm từ tin cậy: bỏ conf<70, bỏ từ 1 ký tự, bỏ từ rỗng
assert.equal(H.ocrConfidentWords(mk([['Nam', 90], ['a', 99], ['  ', 95], ['xx', 69], ['Hoa', 70]])), 2); ok('đếm từ tin cậy (>=70, >=2 ký tự)');
assert.equal(H.ocrConfidentWords(null), 0); assert.equal(H.ocrConfidentWords({}), 0); assert.equal(H.ocrConfidentWords({ data: {} }), 0); ok('đầu vào rỗng/lạ -> 0, không ném lỗi');

// số liệu thật đo trên tấm bằng (300 dpi: PSM3=24, PSM11=86; 200 dpi: 42 -> 71; 150 dpi: 65 -> 80; trang sạch 646 -> 646)
assert.ok(H.ocrNeedsRetry(24) && H.ocrRetryIsBetter(24, 86)); ok('bằng 300 dpi: thử lại và nhận lượt 2 (24 -> 86)');
assert.ok(H.ocrNeedsRetry(42) && H.ocrRetryIsBetter(42, 71)); ok('bằng 200 dpi: thử lại và nhận lượt 2 (42 -> 71)');
assert.ok(H.ocrNeedsRetry(65) && !H.ocrRetryIsBetter(65, 80)); ok('bằng 150 dpi: đã đủ tốt, giữ lượt 1 (65 vs 80)');
assert.ok(!H.ocrNeedsRetry(646)); ok('trang văn bản sạch (646 từ): không thử lại');
assert.ok(!H.ocrRetryIsBetter(0, 5) && !H.ocrRetryIsBetter(10, 12)); ok('chênh lệch nhỏ/trang trống: giữ lượt 1');

// nối dây trong run(): PSM tường minh, khôi phục trong finally, lỗi lượt 2 không làm hỏng lượt 1, giữ xử lý hủy
const run = src.slice(src.indexOf('TOOLS.ocr = {'));
assert.ok(run.includes('tessedit_pageseg_mode: OCR_PSM_AUTO')); ok('lượt 1 đặt PSM tường minh');
assert.ok(/finally \{\s*try \{ await wk\.setParameters\(\{ tessedit_pageseg_mode: OCR_PSM_AUTO/.test(run)); ok('luôn khôi phục PSM 3 trong finally');
assert.ok(run.includes("console.warn('OCR lượt 2 bị bỏ qua:'")); ok('lỗi lượt 2 chỉ cảnh báo, giữ kết quả lượt 1');
assert.ok(run.indexOf('OCR lượt 2 bị bỏ qua') < run.indexOf('cv.width = cv.height = 1;\n                texts.push')); ok('thử lại chạy trước khi giải phóng canvas');
console.log(`\n${n} kiểm thử đạt`);
