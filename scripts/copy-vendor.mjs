// Sao chép thư viện từ node_modules sang public/vendor (tự host, không phụ thuộc CDN)
import { cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

// pdf.js KHÔNG còn được chép ở đây. Từ pdf.js 5 trở đi gói npm chỉ có dạng ESM (.mjs), còn app nạp pdf.js bằng thẻ <script>
// thường (10-core.js cần biến toàn cục `pdfjsLib` ngay khi nạp). Vì vậy public/vendor/pdf.min.js, pdf.worker.min.js và
// public/vendor/pdfjs/<phiên bản>/wasm/ là file ĐÃ ĐÓNG GÓI SẴN, được commit vào repo. Tạo lại bằng:  npm run vendor:pdfjs
const PDFJS_VERSION = '6.2.108';
const files = [
  ['pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js'],
  ['@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'fontkit.umd.min.js'],
  ['jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['exceljs/dist/exceljs.min.js', 'exceljs.min.js'],
  ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
];
mkdirSync('public/vendor', { recursive: true });
for (const [from, to] of files) cpSync(`node_modules/${from}`, `public/vendor/${to}`);
console.log('Đã sao chép', files.length, 'thư viện vào public/vendor');

// Phiên bản nằm trong ĐƯỜNG DẪN (pdf.min.js?v=..., pdfjs/<phiên bản>/wasm/) vì vercel.json cho /vendor/* cache `immutable` 1 năm:
// nếu đổi nội dung mà giữ nguyên URL, người dùng cũ sẽ tiếp tục dùng bản cũ hoặc bị lệch phiên bản giữa pdf.js và worker.
// Chốt chặn: không để lẫn pdf.js cũ (có lỗ hổng CVE-2024-4367) hoặc lệch phiên bản giữa file chính, worker và wasm.
const need = ['public/vendor/pdf.min.js', 'public/vendor/pdf.worker.min.js', `public/vendor/pdfjs/${PDFJS_VERSION}/wasm/openjpeg.wasm`, `public/vendor/pdfjs/${PDFJS_VERSION}/wasm/jbig2.wasm`, `public/vendor/pdfjs/${PDFJS_VERSION}/wasm/qcms_bg.wasm`];
for (const f of need) if (!existsSync(f)) { console.error('THIẾU file pdf.js đã đóng gói:', f); process.exit(1); }
for (const f of need.slice(0, 2)) {
  if (!readFileSync(f, 'utf8').includes(PDFJS_VERSION)) { console.error(`${f} không phải pdf.js ${PDFJS_VERSION}. Chạy: npm run vendor:pdfjs`); process.exit(1); }
}
console.log('pdf.js', PDFJS_VERSION, 'đã đóng gói: OK');
