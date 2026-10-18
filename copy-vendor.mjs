// Sao chép thư viện từ node_modules sang public/vendor (tự host, không phụ thuộc CDN)
import { cpSync, mkdirSync } from 'node:fs';
const files = [
  ['pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js'],
  ['@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'fontkit.umd.min.js'],
  ['pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js'],
  ['jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['exceljs/dist/exceljs.min.js', 'exceljs.min.js'],
  ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
];
mkdirSync('public/vendor', { recursive: true });
for (const [from, to] of files) cpSync(`node_modules/${from}`, `public/vendor/${to}`);
console.log('Đã sao chép', files.length, 'thư viện vào public/vendor');
